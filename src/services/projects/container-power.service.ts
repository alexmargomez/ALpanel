import { projectsService } from '../../modules/projects/projects.service';

/**
 * Servicio Técnico del Módulo `projects` (`projects.stop_rebuild`)
 * Permite detener (Stop), iniciar (Start) y reconstruir (Rebuild) los contenedores de un proyecto.
 */
export class ContainerPowerService {
  async start(projectName: string) {
    return projectsService.startProject(projectName);
  }

  async stop(projectName: string) {
    return projectsService.stopProject(projectName);
  }

  async rebuild(projectName: string) {
    return projectsService.rebuildProject(projectName);
  }
}

export const containerPowerService = new ContainerPowerService();
