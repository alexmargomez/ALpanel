import { projectsService } from '../modules/projects/projects.service';

export class ProjectDbService {
  async dumpDatabaseSql(projectName: string): Promise<{ filename: string; sql: string }> {
    return projectsService.dumpDatabaseSql(projectName);
  }
}

export const projectDbService = new ProjectDbService();
