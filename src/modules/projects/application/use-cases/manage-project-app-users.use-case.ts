import {
  AppUserRecord,
  AppUsersOverview,
  ProjectUsersService,
  projectUsersService,
} from '../../../../services/projects/project-users.service';

export { AppUserRecord, AppUsersOverview };

export class ManageProjectAppUsersUseCase {
  constructor(private readonly service: ProjectUsersService = projectUsersService) {}

  async getProjectUsers(projectName: string): Promise<AppUsersOverview> {
    return this.service.getProjectUsers(projectName);
  }

  async saveProjectUser(
    projectName: string,
    payload: {
      id?: string;
      username: string;
      email?: string;
      role?: string;
      password?: string;
      isActive?: boolean;
    }
  ): Promise<{ success: boolean; message: string }> {
    return this.service.saveProjectUser(projectName, payload);
  }

  async deleteProjectUser(
    projectName: string,
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    return this.service.deleteProjectUser(projectName, userId);
  }
}

export const manageProjectAppUsersUseCase = new ManageProjectAppUsersUseCase();
