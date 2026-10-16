import { projectsService } from '../../modules/projects/projects.service';

/**
 * Servicio Técnico del Módulo `git` (`git.clone`)
 * Permite clonar un nuevo repositorio Git dentro de PROJECTS_ROOT y desplegar su stack Docker.
 */
export class GitCloneService {
  async cloneNewProject(params: {
    name: string;
    repoUrl: string;
    branch?: string;
    envContent?: string;
    autoStart?: boolean;
  }) {
    return projectsService.cloneNewProject(params);
  }
}

export const gitCloneService = new GitCloneService();
