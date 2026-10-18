import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';
import { HostService } from '../../../../services/host.service';
import {
  ContainerStatInfo,
  ProjectInfo,
} from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';
import { FilesystemDiskAdapter } from '../../infrastructure/adapters/filesystem-disk.adapter';
import { ContainerRuntimePort } from '../ports/container-runtime.port';
import { GitRepositoryPort } from '../ports/git-repository.port';
import { ManageProjectDbUseCase } from './manage-project-db.use-case';
import { ToggleDevModeUseCase } from './toggle-dev-mode.use-case';

export class ListProjectsUseCase {
  constructor(
    private readonly systemService: HostService,
    private readonly runtime: ContainerRuntimePort,
    private readonly gitAdapter: GitRepositoryPort,
    private readonly diskAdapter: FilesystemDiskAdapter,
    private readonly dbUseCase: ManageProjectDbUseCase,
    private readonly devModeUseCase: ToggleDevModeUseCase,
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

    const devState = this.devModeUseCase.getDevModeState();
    const defaultDevDomain = this.devModeUseCase.resolveDevSubdomain();
    const devContainerRunning = allContainers.some(
      (c) =>
        (c.Names?.[0] || '').replace(/^\//, '') === 'alpanel_dev_app' &&
        c.State === 'running'
    );

    const containersByProject = new Map<string, Docker.ContainerInfo[]>();
    for (const c of allContainers) {
      const composeProject = (
        c.Labels?.['com.docker.compose.project'] || ''
      ).toLowerCase();
      const composeWorkingDir =
        c.Labels?.['com.docker.compose.project.working_dir'] || '';
      const rawName = (c.Names?.[0] || '').replace(/^\//, '');

      if (rawName === 'alpanel_dev_app') continue;

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

        const containerStats: ContainerStatInfo[] = rawContainers.map((c) => {
          const isRunning = c.State === 'running';
          const live = this.runtime.getContainerLiveStats(c.Id, isRunning);
          const name = (c.Names?.[0] || '').replace(/^\//, '');
          const serviceName =
            c.Labels?.['com.docker.compose.service'] || name;
          const ports = (c.Ports || [])
            .filter((p) => p.PublicPort)
            .map((p) => `${p.PublicPort}->${p.PrivatePort}/${p.Type}`);

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
            ports: Array.from(new Set(ports)),
            role: this.runtime.detectRole(serviceName, c.Image),
          };
        });

        const runningCount = containerStats.filter(
          (c) => c.state === 'running'
        ).length;
        const status: ProjectInfo['status'] =
          containerStats.length === 0 || runningCount === 0
            ? 'stopped'
            : runningCount === containerStats.length
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
        const domains = this.diskAdapter
          .extractDomains(projectDir, envDict, this.panelSelfDir)
          .filter((d) => !d.startsWith('develop.'));

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

        const isThisDevActive =
          devState.active &&
          Boolean(devState.projectName) &&
          (devState.projectName!.toLowerCase() === displayName.toLowerCase() ||
            (ProjectNameVO.isSelfPanel(displayName, this.panelSelfDir) &&
              ProjectNameVO.isSelfPanel(
                devState.projectName!,
                this.panelSelfDir
              )));

        return {
          name: displayName,
          path: projectDir,
          stack: this.diskAdapter.detectStack(projectDir, containerStats),
          status,
          domains,
          git,
          devMode: {
            isActive: isThisDevActive,
            branch: 'develop',
            domain: devState.domain || defaultDevDomain,
            commitHash: isThisDevActive ? devState.commitHash : '-',
            commitMessage: isThisDevActive ? devState.commitMessage : '-',
            containerName: 'alpanel_dev_app',
            status:
              isThisDevActive && devContainerRunning ? 'running' : 'stopped',
          },
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
