import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';

const execAsync = promisify(exec);

export interface ProjectFileTreeEntry {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  updatedAt: string;
  extension: string;
}

export interface ProjectFileReadResult {
  relativePath: string;
  content: string;
  sizeBytes: number;
  isBinary: boolean;
  hasBackup: boolean;
  updatedAt: string;
}

const MAX_EDITABLE_BYTES = 2 * 1024 * 1024; // 2 MB

export class ManageProjectFilesUseCase {
  constructor(
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
  ) {}

  private resolveSafeTarget(
    projectName: string,
    relativePath = ''
  ): { projectRoot: string; targetPath: string; cleanRelative: string } {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const projectRoot = path.resolve(projectDir);
    if (!fs.existsSync(projectRoot)) {
      throw new Error(`El proyecto "${projectName}" no existe en disco.`);
    }

    const cleanRelative = String(relativePath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');

    const targetPath = path.resolve(projectRoot, cleanRelative);
    if (
      targetPath !== projectRoot &&
      !targetPath.startsWith(projectRoot + path.sep)
    ) {
      throw new Error(
        '⛔ Acceso denegado: la ruta solicitada intenta salir del directorio aislado del proyecto.'
      );
    }

    return { projectRoot, targetPath, cleanRelative };
  }

  private getBackupPath(projectRoot: string, cleanRelative: string): string {
    const safeKey = cleanRelative.replace(/[^a-zA-Z0-9._-]/g, '__');
    return path.join(projectRoot, '.alpanel-backups', `${safeKey}.bak`);
  }

  listDirectory(
    projectName: string,
    relativePath = ''
  ): {
    currentPath: string;
    parentPath: string | null;
    entries: ProjectFileTreeEntry[];
  } {
    const { projectRoot, targetPath, cleanRelative } = this.resolveSafeTarget(
      projectName,
      relativePath
    );

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
      throw new Error('El directorio solicitado no existe.');
    }

    const rawEntries = fs.readdirSync(targetPath, { withFileTypes: true });
    const entries: ProjectFileTreeEntry[] = [];

    for (const dirent of rawEntries) {
      if (dirent.name === '.alpanel-backups') continue;
      const full = path.join(targetPath, dirent.name);
      const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
      let sizeBytes = 0;
      let updatedAt = '';
      try {
        const st = fs.statSync(full);
        sizeBytes = st.size;
        updatedAt = st.mtime.toISOString();
      } catch {
        // ignore broken symlink
      }

      entries.push({
        name: dirent.name,
        relativePath: rel,
        type: dirent.isDirectory() ? 'directory' : 'file',
        sizeBytes,
        updatedAt,
        extension: dirent.isDirectory()
          ? ''
          : path.extname(dirent.name).replace(/^\./, '').toLowerCase(),
      });
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    let parentPath: string | null = null;
    if (cleanRelative) {
      const parent = path.dirname(cleanRelative).replace(/\\/g, '/');
      parentPath = parent === '.' ? '' : parent;
    }

    return {
      currentPath: cleanRelative,
      parentPath,
      entries,
    };
  }

  readFile(projectName: string, relativePath: string): ProjectFileReadResult {
    const { projectRoot, targetPath, cleanRelative } = this.resolveSafeTarget(
      projectName,
      relativePath
    );
    if (!cleanRelative || !fs.existsSync(targetPath)) {
      throw new Error('El archivo solicitado no existe.');
    }
    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      throw new Error('La ruta seleccionada corresponde a una carpeta, no a un archivo.');
    }

    const backupPath = this.getBackupPath(projectRoot, cleanRelative);
    const hasBackup = fs.existsSync(backupPath);

    if (stat.size > MAX_EDITABLE_BYTES) {
      return {
        relativePath: cleanRelative,
        content: '',
        sizeBytes: stat.size,
        isBinary: true,
        hasBackup,
        updatedAt: stat.mtime.toISOString(),
      };
    }

    const buf = fs.readFileSync(targetPath);
    const sample = buf.subarray(0, Math.min(buf.length, 4096));
    let isBinary = false;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) {
        isBinary = true;
        break;
      }
    }

    return {
      relativePath: cleanRelative,
      content: isBinary ? '' : buf.toString('utf-8'),
      sizeBytes: stat.size,
      isBinary,
      hasBackup,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  async writeFile(
    projectName: string,
    relativePath: string,
    content: string
  ): Promise<{
    success: boolean;
    relativePath: string;
    hasBackup: boolean;
    validationWarning?: string;
  }> {
    const { projectRoot, targetPath, cleanRelative } = this.resolveSafeTarget(
      projectName,
      relativePath
    );
    if (!cleanRelative) {
      throw new Error('Debes indicar la ruta del archivo a guardar.');
    }
    if (cleanRelative.startsWith('.git/')) {
      throw new Error('⛔ No se permite modificar archivos internos de .git directamente.');
    }

    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const backupPath = this.getBackupPath(projectRoot, cleanRelative);
    let hasBackup = false;
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
      const backupDir = path.dirname(backupPath);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      fs.copyFileSync(targetPath, backupPath);
      hasBackup = true;
    }

    const isEnv = path.basename(targetPath).startsWith('.env');
    fs.writeFileSync(targetPath, content, {
      encoding: 'utf-8',
      mode: isEnv ? 0o600 : 0o644,
    });

    let validationWarning: string | undefined;
    const baseName = path.basename(targetPath).toLowerCase();
    if (baseName === 'docker-compose.yml' || baseName === 'docker-compose.yaml') {
      try {
        await execAsync('docker compose config -q', {
          cwd: projectRoot,
          timeout: 8000,
        });
      } catch (err: any) {
        validationWarning =
          err?.stderr?.trim() ||
          err?.message ||
          'Advertencia: docker compose reportó un error de sintaxis YAML.';
      }
    }

    return {
      success: true,
      relativePath: cleanRelative,
      hasBackup,
      validationWarning,
    };
  }

  restoreBackup(
    projectName: string,
    relativePath: string
  ): { success: boolean; content: string } {
    const { projectRoot, targetPath, cleanRelative } = this.resolveSafeTarget(
      projectName,
      relativePath
    );
    const backupPath = this.getBackupPath(projectRoot, cleanRelative);
    if (!fs.existsSync(backupPath)) {
      throw new Error('No existe un respaldo previo disponible para este archivo.');
    }
    const previousContent = fs.readFileSync(backupPath, 'utf-8');
    fs.writeFileSync(targetPath, previousContent, 'utf-8');
    return { success: true, content: previousContent };
  }

  createEntry(
    projectName: string,
    relativePath: string,
    kind: 'file' | 'directory'
  ): { success: boolean; relativePath: string } {
    const { targetPath, cleanRelative } = this.resolveSafeTarget(
      projectName,
      relativePath
    );
    if (!cleanRelative) {
      throw new Error('El nombre de archivo o carpeta es obligatorio.');
    }
    if (fs.existsSync(targetPath)) {
      throw new Error(`Ya existe un elemento en "${cleanRelative}".`);
    }

    if (kind === 'directory') {
      fs.mkdirSync(targetPath, { recursive: true });
    } else {
      const parent = path.dirname(targetPath);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.writeFileSync(targetPath, '', 'utf-8');
    }

    return { success: true, relativePath: cleanRelative };
  }

  deleteEntry(
    projectName: string,
    relativePath: string
  ): { success: boolean } {
    const { projectRoot, targetPath, cleanRelative } = this.resolveSafeTarget(
      projectName,
      relativePath
    );
    if (!cleanRelative || targetPath === projectRoot || cleanRelative === '.git') {
      throw new Error('⛔ No está permitido eliminar la raíz del proyecto ni el directorio .git.');
    }
    if (!fs.existsSync(targetPath)) {
      throw new Error('El archivo o carpeta indicado no existe.');
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
    return { success: true };
  }
}

export const manageProjectFilesUseCase = new ManageProjectFilesUseCase();
