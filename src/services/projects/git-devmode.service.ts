import { projectsService } from '../../modules/projects/projects.service';
import { domainsService } from '../../modules/domains/domains.service';

/**
 * Servicio Técnico del Módulo `projects` (`projects.dev_mode`)
 * Permite activar o desactivar el Modo Desarrollador aislado en la rama `develop`.
 */
export class GitDevModeService {
  getState() {
    return projectsService.getDevModeState();
  }

  async activate(projectName: string) {
    return projectsService.activateDevMode(projectName, domainsService);
  }

  async deactivate() {
    return projectsService.deactivateDevMode(domainsService);
  }
}

export const gitDevModeService = new GitDevModeService();
