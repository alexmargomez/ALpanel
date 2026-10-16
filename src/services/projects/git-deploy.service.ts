import { projectsService } from '../../modules/projects/projects.service';

/**
 * Servicio Técnico del Módulo `projects` (`projects.git_pull`)
 * Permite verificar commits pendientes y ejecutar `Git Pull & Restart` (rama `main`) con Rollback automático.
 */
export class GitDeployService {
  async checkRemoteUpdates(projectName: string) {
    return projectsService.checkProjectUpdates(projectName);
  }

  async pullAndRestartProduction(projectName: string) {
    return projectsService.gitPullAndRestart(projectName);
  }
}

export const gitDeployService = new GitDeployService();
