import { projectsService } from '../../modules/projects/projects.service';

/**
 * Servicio Técnico del Módulo `projects` (`projects.logs`)
 * Permite consultar la consola de logs en tiempo real de cualquier contenedor.
 */
export class ContainerLogsService {
  async getLogs(containerName: string, tail = 150): Promise<string> {
    return projectsService.getContainerLogs(containerName, tail);
  }
}

export const containerLogsService = new ContainerLogsService();
