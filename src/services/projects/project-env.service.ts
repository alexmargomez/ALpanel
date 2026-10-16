import { projectsService } from '../../modules/projects/projects.service';

/**
 * Servicio Técnico del Módulo `projects` (`projects.env_view` y `projects.env_edit`)
 * Permite leer y guardar el archivo .env de cualquier proyecto alojado.
 */
export class ProjectEnvService {
  async getEnv(projectName: string) {
    return projectsService.getEnvFileContent(projectName);
  }

  async saveEnv(projectName: string, content: string, restart = true) {
    return projectsService.saveEnvFileContent(projectName, content, restart);
  }
}

export const projectEnvService = new ProjectEnvService();
