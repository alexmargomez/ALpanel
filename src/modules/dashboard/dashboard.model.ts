import { HostMetrics } from '../../services/host.service';
import { ProjectInfo } from '../projects/projects.model';

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
