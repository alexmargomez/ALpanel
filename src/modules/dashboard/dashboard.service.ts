import { hostService } from '../../services/host.service';
import { projectsService } from '../projects/projects.service';
import { domainsService } from '../domains/domains.service';
import { DashboardOverviewDto } from './dashboard.model';

export class DashboardService {
  async getOverview(): Promise<DashboardOverviewDto> {
    const [host, projects, routes] = await Promise.all([
      hostService.getHostMetrics(),
      projectsService.listProjects(),
      domainsService.listRoutes(),
    ]);

    const runningProjects = projects.filter((p) => p.status === 'running').length;
    const totalContainers = projects.reduce((acc, p) => acc + p.containers.length, 0);

    return {
      host,
      projectsRoot: projectsService.getProjectsRoot(),
      projects,
      summary: {
        totalProjects: projects.length,
        runningProjects,
        totalContainers,
        activeDomains: routes.length,
      },
    };
  }

  async getHostMetrics() {
    return hostService.getHostMetrics();
  }

  async pruneCache() {
    return hostService.pruneDockerCache();
  }
}

export const dashboardService = new DashboardService();
