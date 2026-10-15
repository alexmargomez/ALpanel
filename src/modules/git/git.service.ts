import { projectsService } from '../projects/projects.service';
import { domainsService } from '../domains/domains.service';
import { CloneProjectPayload } from './git.model';

export class GitService {
  async checkUpdates(projectName: string) {
    return projectsService.checkProjectUpdates(projectName);
  }

  async pullAndRestart(projectName: string) {
    return projectsService.gitPullAndRestart(projectName);
  }

  async activateDevMode(projectName: string) {
    return projectsService.activateDevMode(projectName, domainsService);
  }

  async deactivateDevMode() {
    return projectsService.deactivateDevMode(domainsService);
  }

  async cloneProject(payload: CloneProjectPayload) {
    return projectsService.cloneNewProject(payload);
  }
}

export const gitService = new GitService();
