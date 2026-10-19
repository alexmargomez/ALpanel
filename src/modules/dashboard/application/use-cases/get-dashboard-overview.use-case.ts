import { hostService } from '../../../../shared/infrastructure/services/host-metrics.service';
import { projectsFacadeUseCase } from '../../../projects/application/use-cases/projects-facade.use-case';
import { manageDomainsUseCase } from '../../../domains/application/use-cases/manage-domains.use-case';
import { DashboardOverviewDto } from '../../domain/entities/dashboard-overview.entity';

export class GetDashboardOverviewUseCase {
  async getOverview(): Promise<DashboardOverviewDto> {
    const [host, projects, routes] = await Promise.all([
      hostService.getHostMetrics(),
      projectsFacadeUseCase.listProjects(),
      manageDomainsUseCase.listRoutes(),
    ]);

    const runningProjects = projects.filter(
      (p) => p.status === 'running'
    ).length;
    const totalContainers = projects.reduce(
      (acc, p) => acc + p.containers.length,
      0
    );

    return {
      host,
      projectsRoot: projectsFacadeUseCase.getProjectsRoot(),
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

export const getDashboardOverviewUseCase = new GetDashboardOverviewUseCase();
