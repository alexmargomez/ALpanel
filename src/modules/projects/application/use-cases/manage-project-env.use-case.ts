import fs from 'fs';
import path from 'path';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';

export class ManageProjectEnvUseCase {
  constructor(
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel',
    private readonly onInvalidateCache?: (projectDir: string) => void
  ) {}

  getEnvFileContent(projectName: string): { content: string; exists: boolean } {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const envPath = path.join(projectDir, '.env');
    const examplePath = path.join(projectDir, '.env.example');
    if (fs.existsSync(envPath)) {
      return { content: fs.readFileSync(envPath, 'utf-8'), exists: true };
    }
    if (fs.existsSync(examplePath)) {
      return { content: fs.readFileSync(examplePath, 'utf-8'), exists: false };
    }
    return { content: '# Variables de entorno (.env)\n', exists: false };
  }

  async saveEnvFileContent(
    projectName: string,
    content: string,
    restartAfter = true,
    restartFn?: (name: string) => Promise<{ success: boolean; output: string }>
  ): Promise<{ success: boolean; output: string }> {
    const projectDir = new ProjectNameVO(projectName).resolvePath(
      this.projectsRoot,
      this.panelSelfDir
    );
    const envPath = path.join(projectDir, '.env');
    const tmpPath = `${envPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, envPath);
    if (this.onInvalidateCache) {
      this.onInvalidateCache(projectDir);
    }

    if (restartAfter && restartFn) {
      return restartFn(projectName);
    }
    return {
      success: true,
      output: 'Archivo .env guardado de forma atómica correctamente (permisos 0600).',
    };
  }
}
