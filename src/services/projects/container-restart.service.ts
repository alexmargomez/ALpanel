import { projectsService } from '../../modules/projects/projects.service';

/**
 * Servicio Técnico del Módulo `projects` (`projects.restart_cache`)
 * Permite reiniciar contenedores y limpiar la caché de aplicación de un proyecto.
 */
export class ContainerRestartService {
  async restart(projectName: string, containerName?: string) {
    return projectsService.restartProject(projectName, containerName);
  }

  async clearCache(projectName: string) {
    return projectsService.clearProjectCache(projectName);
  }
}

export const containerRestartService = new ContainerRestartService();
