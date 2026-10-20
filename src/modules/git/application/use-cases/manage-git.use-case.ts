import { projectsFacadeUseCase } from '../../../projects/application/use-cases/projects-facade.use-case';
import { CloneProjectPayload } from '../../domain/entities/git-clone.entity';

export class ManageGitUseCase {
  async checkUpdates(projectName: string) {
    return projectsFacadeUseCase.checkProjectUpdates(projectName);
  }

  async pullAndRestart(projectName: string) {
    return projectsFacadeUseCase.gitPullAndRestart(projectName);
  }

  async cloneProject(payload: CloneProjectPayload) {
    return projectsFacadeUseCase.cloneNewProject(payload);
  }
}

export const manageGitUseCase = new ManageGitUseCase();
