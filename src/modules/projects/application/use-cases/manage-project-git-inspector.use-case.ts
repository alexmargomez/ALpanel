import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';

const execAsync = promisify(exec);

export interface GitChangedFileItem {
  code: string;
  statusLabel: string;
  path: string;
}

export interface GitCommitHistoryItem {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  dateIso: string;
  relativeDate: string;
  subject: string;
  filesChanged: string[];
}

export interface ProjectGitInspectorOverview {
  isRepo: boolean;
  currentBranch: string;
  remoteUrl: string;
  aheadCount: number;
  behindCount: number;
  isDirty: boolean;
  changedFiles: GitChangedFileItem[];
  commits: GitCommitHistoryItem[];
  branches: string[];
}

function mapPorcelainStatus(code: string): string {
  const c = code.trim();
  if (c === '??') return 'Nuevo (Sin seguimiento)';
  if (c.includes('M')) return 'Modificado';
  if (c.includes('A')) return 'Agregado';
  if (c.includes('D')) return 'Eliminado';
  if (c.includes('R')) return 'Renombrado';
  if (c.includes('U')) return 'Conflicto';
  return c || 'Cambio';
}

export class ManageProjectGitInspectorUseCase {
  constructor(
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
  ) {}

  async inspect(
    projectName: string,
    limit = 25
  ): Promise<ProjectGitInspectorOverview> {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const gitDir = path.join(projectDir, '.git');
    if (!fs.existsSync(projectDir) || !fs.existsSync(gitDir)) {
      return {
        isRepo: false,
        currentBranch: '-',
        remoteUrl: '',
        aheadCount: 0,
        behindCount: 0,
        isDirty: false,
        changedFiles: [],
        commits: [],
        branches: [],
      };
    }

    const safeLimit = Math.max(5, Math.min(80, Math.floor(limit)));
    const git = (args: string) =>
      execAsync(`git -c safe.directory='*' -c core.hooksPath=/dev/null ${args}`, {
        cwd: projectDir,
        timeout: 12000,
        maxBuffer: 4 * 1024 * 1024,
      })
        .then((r) => r.stdout.trim())
        .catch(() => '');

    const [
      currentBranch,
      remoteUrl,
      porcelainOut,
      branchesOut,
      aheadBehindOut,
      logOut,
    ] = await Promise.all([
      git('rev-parse --abbrev-ref HEAD'),
      git('remote get-url origin'),
      git('status --porcelain'),
      git('branch --format="%(refname:short)"'),
      git('rev-list --left-right --count HEAD...@{u}'),
      git(
        `log -n ${safeLimit} --pretty=format:"__COMMIT__%H||%h||%an||%ae||%aI||%ar||%s" --name-only`
      ),
    ]);

    const changedFiles: GitChangedFileItem[] = [];
    if (porcelainOut) {
      for (const rawLine of porcelainOut.split('\n')) {
        if (!rawLine.trim()) continue;
        const code = rawLine.slice(0, 2);
        const filePath = rawLine.slice(3).trim();
        if (filePath) {
          changedFiles.push({
            code: code.trim() || 'M',
            statusLabel: mapPorcelainStatus(code),
            path: filePath,
          });
        }
      }
    }

    let aheadCount = 0;
    let behindCount = 0;
    if (aheadBehindOut) {
      const parts = aheadBehindOut.split(/\s+/);
      aheadCount = Number(parts[0]) || 0;
      behindCount = Number(parts[1]) || 0;
    }

    const commits: GitCommitHistoryItem[] = [];
    if (logOut) {
      const chunks = logOut.split('__COMMIT__').filter(Boolean);
      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        const header = lines[0] || '';
        const [hash, shortHash, authorName, authorEmail, dateIso, relativeDate, subject] =
          header.split('||');
        if (!hash) continue;
        const filesChanged = lines
          .slice(1)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 25);

        commits.push({
          hash: hash.trim(),
          shortHash: (shortHash || hash.slice(0, 7)).trim(),
          authorName: (authorName || 'Desconocido').trim(),
          authorEmail: (authorEmail || '').trim(),
          dateIso: (dateIso || '').trim(),
          relativeDate: (relativeDate || '').trim(),
          subject: (subject || '(Sin mensaje)').trim(),
          filesChanged,
        });
      }
    }

    const branches = branchesOut
      ? branchesOut
          .split('\n')
          .map((b) => b.trim())
          .filter(Boolean)
      : currentBranch
      ? [currentBranch]
      : [];

    return {
      isRepo: true,
      currentBranch: currentBranch || 'main',
      remoteUrl: remoteUrl.replace(/https:\/\/[^@]+@/i, 'https://'),
      aheadCount,
      behindCount,
      isDirty: changedFiles.length > 0,
      changedFiles,
      commits,
      branches,
    };
  }

  async getFileDiff(projectName: string, filePath: string): Promise<string> {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const cleanRel = String(filePath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const resolved = path.resolve(projectDir, cleanRel);
    if (!resolved.startsWith(path.resolve(projectDir) + path.sep)) {
      throw new Error('⛔ Ruta de archivo inválida para git diff.');
    }

    try {
      const { stdout } = await execAsync(
        `git -c safe.directory='*' diff -- "${cleanRel.replace(/"/g, '\\"')}"`,
        { cwd: projectDir, timeout: 10000, maxBuffer: 2 * 1024 * 1024 }
      );
      if (stdout.trim()) return stdout;

      const { stdout: cachedOut } = await execAsync(
        `git -c safe.directory='*' diff --cached -- "${cleanRel.replace(/"/g, '\\"')}"`,
        { cwd: projectDir, timeout: 10000, maxBuffer: 2 * 1024 * 1024 }
      );
      if (cachedOut.trim()) return cachedOut;

      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        const preview = fs.readFileSync(resolved, 'utf-8').slice(0, 40000);
        return `--- /dev/null\n+++ b/${cleanRel}\n${preview
          .split('\n')
          .map((l) => `+${l}`)
          .join('\n')}`;
      }
      return 'Sin diferencias pendientes para este archivo.';
    } catch (err: any) {
      return err?.stderr || err?.message || 'No se pudo obtener el diff.';
    }
  }
}

export const manageProjectGitInspectorUseCase =
  new ManageProjectGitInspectorUseCase();
