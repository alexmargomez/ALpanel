import {
  HostService as SystemService,
  hostService,
} from '../../../../shared/infrastructure/services/host-metrics.service';
import {
  ContainerStatInfo,
  DatabaseConnectionInfo,
  ProjectInfo,
} from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { dockerodeRuntimeAdapter } from '../../infrastructure/adapters/dockerode-runtime.adapter';
import { gitCliAdapter } from '../../infrastructure/adapters/git-cli.adapter';
import { filesystemDiskAdapter } from '../../infrastructure/adapters/filesystem-disk.adapter';
import { ManageProjectDbUseCase } from './manage-project-db.use-case';
import { ManageProjectEnvUseCase } from './manage-project-env.use-case';
import { ManageContainerPowerUseCase } from './manage-container-power.use-case';
import { DeployGitProjectUseCase } from './deploy-git-project.use-case';
import { ListProjectsUseCase } from './list-projects.use-case';

export {
  ContainerStatInfo,
  DatabaseConnectionInfo,
  ProjectInfo,
};

/**
 * Fachada de Aplicación del Módulo `projects`
 * Orquesta los Casos de Uso (`application/use-cases/*`) y Adaptadores (`infrastructure/adapters/*`).
 */
export class ProjectsFacadeUseCase {
  private readonly projectsRoot: string;
  private readonly panelSelfDir: string;
  private readonly dbUseCase: ManageProjectDbUseCase;
  private readonly envUseCase: ManageProjectEnvUseCase;
  private readonly powerUseCase: ManageContainerPowerUseCase;
  private readonly deployUseCase: DeployGitProjectUseCase;
  private readonly listUseCase: ListProjectsUseCase;

  constructor(systemService: SystemService) {
    this.projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects';
    this.panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel';

    const invalidateAll = (projectDir?: string) =>
      this.invalidateProjectCache(projectDir);

    this.dbUseCase = new ManageProjectDbUseCase(
      dockerodeRuntimeAdapter,
      this.panelSelfDir
    );
    this.envUseCase = new ManageProjectEnvUseCase(
      this.projectsRoot,
      this.panelSelfDir,
      invalidateAll
    );
    this.powerUseCase = new ManageContainerPowerUseCase(
      dockerodeRuntimeAdapter,
      this.projectsRoot,
      this.panelSelfDir,
      invalidateAll
    );
    this.deployUseCase = new DeployGitProjectUseCase(
      gitCliAdapter,
      dockerodeRuntimeAdapter,
      this.projectsRoot,
      this.panelSelfDir,
      invalidateAll
    );
    this.listUseCase = new ListProjectsUseCase(
      systemService,
      dockerodeRuntimeAdapter,
      gitCliAdapter,
      filesystemDiskAdapter,
      this.dbUseCase,
      this.projectsRoot,
      this.panelSelfDir
    );
  }

  invalidateProjectCache(projectDir?: string): void {
    gitCliAdapter.invalidateCache(projectDir);
    filesystemDiskAdapter.invalidateCache(projectDir);
    dockerodeRuntimeAdapter.invalidateCache();
  }

  getProjectsRoot(): string {
    return this.projectsRoot;
  }

  isSelfPanel(name: string): boolean {
    return ProjectNameVO.isSelfPanel(name, this.panelSelfDir);
  }

  async ensureAlpanelContainerNames(): Promise<void> {
    return dockerodeRuntimeAdapter.ensureAlpanelContainerNames();
  }

  async listProjects(): Promise<ProjectInfo[]> {
    return this.listUseCase.execute();
  }

  async extractDatabaseInfo(
    projectDir: string,
    containers: ContainerStatInfo[],
    envDict: Record<string, string>,
    publicIp: string
  ): Promise<DatabaseConnectionInfo> {
    return this.dbUseCase.extractDatabaseInfo(
      projectDir,
      containers,
      envDict,
      publicIp
    );
  }

  async dumpDatabaseSql(
    projectName: string
  ): Promise<{ filename: string; sql: string }> {
    const projects = await this.listProjects();
    return this.dbUseCase.dumpDatabaseSql(projectName, projects);
  }

  async checkProjectUpdates(projectName: string) {
    return this.deployUseCase.checkProjectUpdates(projectName);
  }

  async gitPullAndRestart(projectName: string) {
    return this.deployUseCase.gitPullAndRestart(projectName);
  }

  async cloneNewProject(payload: {
    name: string;
    repoUrl: string;
    branch?: string;
    envContent?: string;
    autoStart?: boolean;
  }) {
    return this.deployUseCase.cloneNewProject(payload);
  }

  async restartProject(projectName: string, containerName?: string) {
    return this.powerUseCase.restartProject(projectName, containerName);
  }

  async startProject(projectName: string) {
    return this.powerUseCase.startProject(projectName);
  }

  async stopProject(projectName: string) {
    return this.powerUseCase.stopProject(projectName);
  }

  async rebuildProject(
    projectName: string,
    containerName?: string,
    serviceName?: string
  ) {
    return this.powerUseCase.rebuildProject(
      projectName,
      containerName,
      serviceName
    );
  }

  async rebuildDestroyProject(
    projectName: string,
    containerName?: string,
    serviceName?: string
  ) {
    return this.powerUseCase.rebuildDestroyProject(
      projectName,
      containerName,
      serviceName
    );
  }

  async deleteProject(projectName: string) {
    return this.powerUseCase.deleteProject(projectName);
  }

  async clearProjectCache(projectName: string) {
    return this.powerUseCase.clearProjectCache(projectName, () =>
      this.listProjects()
    );
  }

  async getContainerLogs(containerName: string, tail = 150) {
    return this.powerUseCase.getContainerLogs(containerName, tail);
  }

  getEnvFileContent(projectName: string) {
    return this.envUseCase.getEnvFileContent(projectName);
  }

  async saveEnvFileContent(
    projectName: string,
    content: string,
    restartAfter = true
  ) {
    return this.envUseCase.saveEnvFileContent(
      projectName,
      content,
      restartAfter,
      (name) => this.restartProject(name)
    );
  }
}

export const projectsFacadeUseCase = new ProjectsFacadeUseCase(hostService);
export const projectsService = projectsFacadeUseCase;
export { ProjectsFacadeUseCase as ProjectsService };
