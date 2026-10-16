import { projectsService } from '../modules/projects/projects.service';

export class EnvService {
  getEnvFileContent(projectName: string) {
    return projectsService.getEnvFileContent(projectName);
  }

  async saveEnvFileContent(projectName: string, content: string, restart = true) {
    return projectsService.saveEnvFileContent(projectName, content, restart);
  }
}

export const envService = new EnvService();
