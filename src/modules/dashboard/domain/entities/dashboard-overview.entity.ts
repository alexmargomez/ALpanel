import { HostMetrics } from '../../../../shared/infrastructure/services/host-metrics.service';
import { ProjectInfo } from '../../../projects/domain/entities/project.entity';

export interface DashboardSummary {
  totalProjects: number;
  runningProjects: number;
  totalContainers: number;
  activeDomains: number;
}

export interface DashboardOverviewDto {
  host: HostMetrics;
  projectsRoot: string;
  projects: ProjectInfo[];
  summary: DashboardSummary;
}
