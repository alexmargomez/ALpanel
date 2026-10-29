import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { GitRepositoryPort } from '../../application/ports/git-repository.port';
import { ProjectInfo } from '../../domain/entities/project.entity';

const execAsync = promisify(exec);

export class GitCliAdapter implements GitRepositoryPort {
  private gitInfoCache = new Map<
    string,
    { data: ProjectInfo['git']; expiresAt: number }
  >();

  constructor(panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel') {
    const gitDir = path.join(panelSelfDir, '.git');
    if (fs.existsSync(gitDir)) {
      exec(
        `chmod -R u+rwX,go+rX "${gitDir}" 2>/dev/null && find "${path.join(gitDir, 'hooks')}" -type f -exec chmod a-wx {} + 2>/dev/null || true`,
        () => {}
      );
    }
  }

  invalidateCache(projectDir?: string): void {
    if (projectDir) {
      this.gitInfoCache.delete(projectDir);
    } else {
      this.gitInfoCache.clear();
    }
  }

  async ensureSharedGitPermissions(projectDir: string): Promise<void> {
    const gitDir = path.join(projectDir, '.git');
    if (fs.existsSync(gitDir)) {
      await execAsync(
        `chmod -R u+rwX,go+rX "${gitDir}" 2>/dev/null && find "${path.join(gitDir, 'hooks')}" -type f -exec chmod a-wx {} + 2>/dev/null || true`
      ).catch(() => null);
    }
  }

  async getGitInfo(projectDir: string): Promise<ProjectInfo['git']> {
    const now = Date.now();
    const cached = this.gitInfoCache.get(projectDir);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const gitDir = path.join(projectDir, '.git');
    if (!fs.existsSync(gitDir)) {
      const noRepo: ProjectInfo['git'] = {
        isRepo: false,
        branch: '-',
        commitHash: '-',
        commitMessage: 'Sin repositorio Git inicializado',
        remoteUrl: '',
        behindCount: 0,
      };
      this.gitInfoCache.set(projectDir, {
        data: noRepo,
        expiresAt: now + 30_000,
      });
      return noRepo;
    }

    try {
      const [branchRes, logRes, remoteRes, behindRes] = await Promise.all([
        execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir }).catch(
          () => ({ stdout: 'main' })
        ),
        execAsync('git log -n 1 --pretty=format:"%h|%s"', {
          cwd: projectDir,
        }).catch(() => ({ stdout: '-|-' })),
        execAsync('git config --get remote.origin.url', {
          cwd: projectDir,
        }).catch(() => ({ stdout: '' })),
        execAsync('git rev-list HEAD..@{u} --count', { cwd: projectDir }).catch(
          () => ({ stdout: '0' })
        ),
      ]);
      const [hash, ...msgParts] = logRes.stdout.trim().split('|');
      const data: ProjectInfo['git'] = {
        isRepo: true,
        branch: branchRes.stdout.trim() || 'main',
        commitHash: hash || '-',
        commitMessage: msgParts.join('|') || '-',
        remoteUrl: remoteRes.stdout.trim(),
        behindCount: parseInt(behindRes.stdout.trim(), 10) || 0,
      };
      this.gitInfoCache.set(projectDir, { data, expiresAt: now + 15_000 });
      return data;
    } catch {
      return {
        isRepo: true,
        branch: 'main',
        commitHash: '-',
        commitMessage: '-',
        remoteUrl: '',
        behindCount: 0,
      };
    }
  }

  async checkRemoteUpdates(projectDir: string): Promise<{
    success: boolean;
    behindCount: number;
    output: string;
  }> {
    try {
      await execAsync('git fetch --quiet', { cwd: projectDir, timeout: 20000 });
      await this.ensureSharedGitPermissions(projectDir);
      this.invalidateCache(projectDir);
      const { stdout } = await execAsync('git rev-list HEAD..@{u} --count', {
        cwd: projectDir,
      });
      const behindCount = parseInt(stdout.trim(), 10) || 0;
      return {
        success: true,
        behindCount,
        output:
          behindCount > 0
            ? `Hay ${behindCount} commit(s) nuevos listos para descargar.`
            : 'El proyecto está al día con el repositorio remoto.',
      };
    } catch (error: any) {
      return {
        success: false,
        behindCount: 0,
        output:
          error?.stderr ||
          error?.message ||
          'No se pudo verificar el estado remoto.',
      };
    }
  }
}

export const gitCliAdapter = new GitCliAdapter();
