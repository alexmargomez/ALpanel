import { projectsService } from '../modules/projects/projects.service';
import { domainsService } from '../modules/domains/domains.service';
import { CloneProjectPayload } from '../modules/git/git.model';

export class GitDeployService {
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

export const gitDeployService = new GitDeployService();
