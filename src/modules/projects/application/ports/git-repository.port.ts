import { ProjectInfo } from '../../domain/entities/project.entity';

export interface GitRepositoryPort {
  getGitInfo(projectDir: string): Promise<ProjectInfo['git']>;
  checkRemoteUpdates(projectDir: string): Promise<{
    success: boolean;
    behindCount: number;
    output: string;
  }>;
  invalidateCache(projectDir?: string): void;
}
