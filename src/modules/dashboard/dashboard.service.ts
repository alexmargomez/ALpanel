import { systemService } from '../system/system.service';
import { projectsService } from '../projects/projects.service';
import { domainsService } from '../domains/domains.service';
import { DashboardOverviewDto } from './dashboard.model';

export class DashboardService {
  async getOverview(): Promise<DashboardOverviewDto> {
    const [host, projects, routes] = await Promise.all([
      systemService.getHostMetrics(),
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

  async pruneCache() {
    return systemService.pruneDockerCache();
  }
}

export const dashboardService = new DashboardService();
