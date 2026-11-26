import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { HostService } from '../../../../shared/infrastructure/services/host-metrics.service';
import {
  ContainerStatInfo,
  ProjectInfo,
} from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { FilesystemDiskAdapter } from '../../infrastructure/adapters/filesystem-disk.adapter';
import { ContainerRuntimePort } from '../ports/container-runtime.port';
import { GitRepositoryPort } from '../ports/git-repository.port';
import { ManageProjectDbUseCase } from './manage-project-db.use-case';
import { manageProjectMicroservicesUseCase } from './manage-project-microservices.use-case';
import { manageProjectWorkspaceUseCase } from './manage-project-workspace.use-case';

export class ListProjectsUseCase {
  constructor(
    private readonly systemService: HostService,
    private readonly runtime: ContainerRuntimePort,
    private readonly gitAdapter: GitRepositoryPort,
    private readonly diskAdapter: FilesystemDiskAdapter,
    private readonly dbUseCase: ManageProjectDbUseCase,
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
  ) {}

  async execute(): Promise<ProjectInfo[]> {
    const [publicIp, allContainers] = await Promise.all([
      this.systemService.getPublicIp(),
      this.runtime.listAllContainers(),
    ]);

    const projectDirs = new Map<string, string>();
    if (fs.existsSync(this.panelSelfDir)) {
      const selfBase = path.basename(this.panelSelfDir).toLowerCase();
      projectDirs.set(selfBase, path.resolve(this.panelSelfDir));
    }

    if (fs.existsSync(this.projectsRoot)) {
      const entries = fs.readdirSync(this.projectsRoot, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const fullPath = path.join(this.projectsRoot, entry.name);
        const hasProjectMarkers =
          fs.existsSync(path.join(fullPath, '.alpanel-project.json')) ||
          fs.existsSync(path.join(fullPath, 'docker-compose.yml')) ||
          fs.existsSync(path.join(fullPath, 'docker-compose.yaml')) ||
          fs.existsSync(path.join(fullPath, 'Dockerfile')) ||
          fs.existsSync(path.join(fullPath, '.git')) ||
          fs.existsSync(path.join(fullPath, 'package.json')) ||
          fs.existsSync(path.join(fullPath, 'manage.py')) ||
          fs.existsSync(path.join(fullPath, 'composer.json')) ||
          fs.existsSync(path.join(fullPath, 'pom.xml'));
        if (hasProjectMarkers) {
          projectDirs.set(entry.name.toLowerCase(), fullPath);
        }
      }
    }

    const containersByProject = new Map<string, Docker.ContainerInfo[]>();
    for (const c of allContainers) {
      const composeProject = (
        c.Labels?.['com.docker.compose.project'] || ''
      ).toLowerCase();
      const composeWorkingDir =
        c.Labels?.['com.docker.compose.project.working_dir'] || '';
      const rawName = (c.Names?.[0] || '').replace(/^\//, '');

      let matchedKey = composeProject;
      if (composeWorkingDir) {
        const dirBase = path.basename(composeWorkingDir).toLowerCase();
        if (!projectDirs.has(dirBase) && fs.existsSync(composeWorkingDir)) {
          projectDirs.set(dirBase, composeWorkingDir);
        }
        matchedKey = dirBase;
      } else if (!matchedKey) {
        for (const key of projectDirs.keys()) {
          if (rawName.toLowerCase().startsWith(key)) {
            matchedKey = key;
            break;
          }
        }
      }

      if (matchedKey) {
        const list = containersByProject.get(matchedKey) || [];
        list.push(c);
        containersByProject.set(matchedKey, list);
      }
    }

    const results: ProjectInfo[] = await Promise.all(
      Array.from(projectDirs.entries()).map(async ([key, projectDir]) => {
        const displayName = path.basename(projectDir);
        const rawContainers = containersByProject.get(key) || [];

        const preMicroservices =
          manageProjectMicroservicesUseCase.detectMicroservicesInDirectory(
            projectDir,
            []
          );
        const composeServiceMap = new Map<
          string,
          {
            port: string;
            category: string;
            domainCode: string;
          }
        >();
        for (const item of [
          ...preMicroservices.coreServices,
          ...preMicroservices.microservices,
        ]) {
          composeServiceMap.set(item.serviceName.toLowerCase(), {
            port: item.port !== '-' ? item.port : '',
            category: item.category,
            domainCode: item.domainCode,
          });
        }

        const containerStats: ContainerStatInfo[] = rawContainers.map((c) => {
          const isRunning = c.State === 'running';
          const live = this.runtime.getContainerLiveStats(c.Id, isRunning);
          const name = (c.Names?.[0] || '').replace(/^\//, '');
          const serviceName =
            c.Labels?.['com.docker.compose.service'] || name;
          const sLower = serviceName.toLowerCase();
          const composeMeta = composeServiceMap.get(sLower);

          const publishedPorts = (c.Ports || [])
            .filter((p) => p.PublicPort)
            .map((p) => `${p.PublicPort}->${p.PrivatePort}/${p.Type}`);

          const privateOnlyPorts = (c.Ports || [])
            .filter((p) => !p.PublicPort && p.PrivatePort)
            .map((p) => `${p.PrivatePort}/${p.Type || 'tcp'} (interno)`);

          let internalPort = '';
          const firstWithPrivate = (c.Ports || []).find((p) => p.PrivatePort);
          if (firstWithPrivate?.PrivatePort) {
            internalPort = String(firstWithPrivate.PrivatePort);
          } else if (composeMeta?.port) {
            internalPort = composeMeta.port;
          }

          const combinedPorts = [...publishedPorts];
          if (combinedPorts.length === 0) {
            if (privateOnlyPorts.length > 0) {
              combinedPorts.push(...privateOnlyPorts);
            } else if (internalPort) {
              combinedPorts.push(`${internalPort}/tcp (interno)`);
            }
          }

          const baseRole = this.runtime.detectRole(serviceName, c.Image);
          const isGateway =
            preMicroservices.isMicroservicesArchitecture &&
            baseRole !== 'database' &&
            (composeMeta?.category === 'gateway' ||
              sLower === 'core' ||
              sLower === 'gateway' ||
              sLower === 'api-gateway' ||
              sLower === 'control-plane');

          let suggestedPathPrefix: string | undefined;
          if (
            preMicroservices.isMicroservicesArchitecture &&
            !isGateway &&
            baseRole !== 'database' &&
            baseRole !== 'proxy'
          ) {
            const cleanSlug = (
              composeMeta?.domainCode ||
              sLower.replace(/^(ms|srv|svc|micro)[_-]/i, '')
            ).toLowerCase();
            suggestedPathPrefix = `/api/${cleanSlug}/*`;
          }

          return {
            id: c.Id.slice(0, 12),
            name,
            serviceName,
            image: c.Image,
            state: c.State,
            status: c.Status,
            cpuPercent: live.cpuPercent,
            memoryBytes: live.memoryBytes,
            memoryLimitBytes: live.memoryLimitBytes,
            memoryPercent: live.memoryPercent,
            ports: Array.from(new Set(combinedPorts)),
            internalPort: internalPort || undefined,
            isGateway,
            suggestedPathPrefix,
            role: isGateway ? 'gateway' : baseRole,
          };
        });

        // Ordenar contenedores: Gateway/Core primero, Frontend después, Microservicios/Backend y DB al final
        containerStats.sort((a, b) => {
          const rank = (x: ContainerStatInfo) => {
            if (x.isGateway || x.role === 'gateway') return 0;
            if (x.role === 'frontend') return 1;
            if (x.role === 'backend') return 2;
            if (x.role === 'database') return 3;
            return 4;
          };
          return rank(a) - rank(b) || a.name.localeCompare(b.name);
        });

        const microservices =
          manageProjectMicroservicesUseCase.detectMicroservicesInDirectory(
            projectDir,
            containerStats
          );

        const runningCount = containerStats.filter(
          (c) => c.state === 'running'
        ).length;
        const expectedRunningTarget = microservices.isMicroservicesArchitecture
          ? microservices.coreServices.length +
            microservices.enabledMicroservicesCount
          : containerStats.length;

        const status: ProjectInfo['status'] =
          containerStats.length === 0 || runningCount === 0
            ? 'stopped'
            : runningCount >= expectedRunningTarget && expectedRunningTarget > 0
            ? 'running'
            : 'partial';

        const totalCpu =
          Math.round(
            containerStats.reduce((acc, c) => acc + c.cpuPercent, 0) * 10
          ) / 10;
        const totalMem = containerStats.reduce(
          (acc, c) => acc + c.memoryBytes,
          0
        );

        const envDict = this.diskAdapter.parseEnvDictionary(projectDir);
        const domains = this.diskAdapter.extractDomains(
          projectDir,
          envDict,
          this.panelSelfDir
        );

        const [git, diskBytes, database] = await Promise.all([
          this.gitAdapter.getGitInfo(projectDir),
          this.diskAdapter.getDirectoryDiskSize(projectDir),
          this.dbUseCase.extractDatabaseInfo(
            projectDir,
            containerStats,
            envDict,
            publicIp
          ),
        ]);

        const stackList = this.diskAdapter.detectStack(
          projectDir,
          containerStats
        );
        if (
          microservices.isMicroservicesArchitecture &&
          !stackList.includes('Microservices')
        ) {
          stackList.unshift('Microservices');
        }

        const workspaceManifest =
          manageProjectWorkspaceUseCase.readManifest(projectDir);

        return {
          name: displayName,
          path: projectDir,
          serverId: workspaceManifest?.serverId || 'local',
          serverName: workspaceManifest?.serverName || 'Nodo Central (Local)',
          isolatedNetwork: workspaceManifest?.isolatedNetwork,
          linkedUpstreams: workspaceManifest?.linkedUpstreams || [],
          stack: stackList,
          status,
          domains,
          git,
          resources: {
            cpuPercent: totalCpu,
            memoryBytes: totalMem,
            diskBytes,
          },
          containers: containerStats,
          hasEnvFile:
            fs.existsSync(path.join(projectDir, '.env')) ||
            fs.existsSync(path.join(projectDir, '.env.example')),
          hasComposeFile:
            fs.existsSync(path.join(projectDir, 'docker-compose.yml')) ||
            fs.existsSync(path.join(projectDir, 'docker-compose.yaml')),
          database,
          microservices,
        };
      })
    );

    return results.sort((a, b) => {
      const aSelf = ProjectNameVO.isSelfPanel(a.name, this.panelSelfDir);
      const bSelf = ProjectNameVO.isSelfPanel(b.name, this.panelSelfDir);
      if (aSelf && !bSelf) return -1;
      if (!aSelf && bSelf) return 1;
      return a.name.localeCompare(b.name);
    });
  }
}
