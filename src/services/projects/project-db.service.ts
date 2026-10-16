import { projectsService } from '../../modules/projects/projects.service';

/**
 * Servicio Técnico del Módulo `projects` (`projects.db_view` y `projects.db_backup`)
 * Permite consultar credenciales SQL de los contenedores de base de datos y descargar respaldos .SQL.
 */
export class ProjectDbService {
  async dumpDatabaseSql(projectName: string): Promise<{ filename: string; sql: string }> {
    return projectsService.dumpDatabaseSql(projectName);
  }
}

export const projectDbService = new ProjectDbService();
