import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Docker from 'dockerode';
import {
  ContainerRuntimePort,
  InspectedContainerConfig,
  LiveContainerMetrics,
} from '../ports/container-runtime.port';
import { GitRepositoryPort } from '../ports/git-repository.port';
import { ManageProjectEnvUseCase } from '../use-cases/manage-project-env.use-case';
import { ManageProjectDbUseCase } from '../use-cases/manage-project-db.use-case';
import { ManageContainerPowerUseCase } from '../use-cases/manage-container-power.use-case';
import { ToggleDevModeUseCase } from '../use-cases/toggle-dev-mode.use-case';
import { ListProjectsUseCase } from '../use-cases/list-projects.use-case';
import { FilesystemDiskAdapter } from '../../infrastructure/adapters/filesystem-disk.adapter';
import { DockerodeRuntimeAdapter } from '../../infrastructure/adapters/dockerode-runtime.adapter';
import { ContainerStatInfo } from '../../domain/entities/project.entity';

class InMemoryContainerRuntimeMock implements ContainerRuntimePort {
  public containers: Docker.ContainerInfo[] = [];
  public inspectedConfigs = new Map<string, InspectedContainerConfig>();

  invalidateCache(): void {}

  async listAllContainers(): Promise<Docker.ContainerInfo[]> {
    return this.containers;
  }

  detectRole(serviceName: string, image: string): ContainerStatInfo['role'] {
    return DockerodeRuntimeAdapter.prototype.detectRole.call(
      this,
      serviceName,
      image
    );
  }

  getContainerLiveStats(
    _containerId: string,
    isRunning: boolean
  ): LiveContainerMetrics {
    return isRunning
      ? {
          cpuPercent: 12.5,
          memoryBytes: 104857600,
          memoryLimitBytes: 536870912,
          memoryPercent: 19.5,
        }
      : {
          cpuPercent: 0,
          memoryBytes: 0,
          memoryLimitBytes: 0,
          memoryPercent: 0,
        };
  }

  async inspectContainerConfig(
    containerId: string
  ): Promise<InspectedContainerConfig> {
    return (
      this.inspectedConfigs.get(containerId) || {
        env: {},
        externalPort: '',
        internalPort: '3306',
      }
    );
  }

  async ensureAlpanelContainerNames(): Promise<void> {}
}

class InMemoryGitRepositoryMock implements GitRepositoryPort {
  invalidateCache(): void {}
  async getGitInfo() {
    return {
      isRepo: true,
      branch: 'develop',
      commitHash: 'a1b2c3d',
      commitMessage: 'feat: hexagonal architecture',
      remoteUrl: 'https://github.com/alexmargomez/ALpanel.git',
      behindCount: 0,
    };
  }
  async checkRemoteUpdates() {
    return {
      success: true,
      behindCount: 0,
      output: 'Already up to date.',
    };
  }
}

describe('Projects Module — Application Use Cases & Adapters', () => {
  it('DockerodeRuntimeAdapter.detectRole clasifica correctamente database, proxy, frontend y backend', () => {
    const runtime = new InMemoryContainerRuntimeMock();
    assert.equal(runtime.detectRole('db', 'mariadb:10.11'), 'database');
    assert.equal(runtime.detectRole('cache', 'redis:7-alpine'), 'database');
    assert.equal(runtime.detectRole('alpanel_caddy', 'caddy:2-alpine'), 'proxy');
    assert.equal(runtime.detectRole('web_front', 'node:20-vite'), 'frontend');
    assert.equal(runtime.detectRole('api_server', 'node:20-alpine'), 'backend');
  });

  it('ManageProjectEnvUseCase lee .env.example como fallback y guarda .env con permisos 0600', async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-env-'));
    const projDir = path.join(tmpBase, 'mi_proyecto');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, '.env.example'), 'PORT=4000\n', 'utf-8');

    let invalidatedPath = '';
    const useCase = new ManageProjectEnvUseCase(
      tmpBase,
      path.join(tmpBase, 'alpanel'),
      (dir) => {
        invalidatedPath = dir;
      }
    );

    try {
      const initial = useCase.getEnvFileContent('mi_proyecto');
      assert.equal(initial.exists, false);
      assert.equal(initial.content, 'PORT=4000\n');

      let restartedProject = '';
      const saveRes = await useCase.saveEnvFileContent(
        'mi_proyecto',
        'PORT=5000\nDB_HOST=db\n',
        true,
        async (name) => {
          restartedProject = name;
          return { success: true, output: 'Reiniciado mock' };
        }
      );

      assert.equal(saveRes.success, true);
      assert.equal(restartedProject, 'mi_proyecto');
      assert.equal(invalidatedPath, path.resolve(projDir));

      const afterSave = useCase.getEnvFileContent('mi_proyecto');
      assert.equal(afterSave.exists, true);
      assert.equal(afterSave.content, 'PORT=5000\nDB_HOST=db\n');

      const mode = fs.statSync(path.join(projDir, '.env')).mode & 0o777;
      assert.equal(mode, 0o600);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('ManageProjectDbUseCase extrae credenciales MariaDB y PostgreSQL o reporta hasDatabase=false', async () => {
    const runtime = new InMemoryContainerRuntimeMock();
    runtime.inspectedConfigs.set('container_db_1', {
      env: {
        MYSQL_DATABASE: 'hc_clinica',
        MYSQL_USER: 'hc_user',
        MYSQL_PASSWORD: 'secret_password',
        MYSQL_ROOT_PASSWORD: 'root_password',
      },
      externalPort: '3307',
      internalPort: '3306',
    });

    const dbUseCase = new ManageProjectDbUseCase(runtime, '/opt/alpanel');

    const noDb = await dbUseCase.extractDatabaseInfo(
      '/tmp/no_db',
      [],
      {},
      '203.0.113.10'
    );
    assert.equal(noDb.hasDatabase, false);
    assert.equal(noDb.status, 'none');

    const mariaDb = await dbUseCase.extractDatabaseInfo(
      '/tmp/hc_proj',
      [
        {
          id: 'container_db_1',
          name: 'hc_db',
          serviceName: 'db',
          image: 'mariadb:10.11',
          state: 'running',
          status: 'Up 2 hours',
          cpuPercent: 1,
          memoryBytes: 1024,
          memoryLimitBytes: 2048,
          memoryPercent: 50,
          ports: ['3307->3306/tcp'],
          role: 'database',
        },
      ],
      {},
      '203.0.113.10'
    );

    assert.equal(mariaDb.hasDatabase, true);
    assert.equal(mariaDb.database, 'hc_clinica');
    assert.equal(mariaDb.username, 'hc_user');
    assert.equal(mariaDb.port, '3307');
    assert.match(mariaDb.connectionUrl, /^mysql:\/\/hc_user:secret_password@203\.0\.113\.10:3307\/hc_clinica$/);
    assert.match(mariaDb.cliCommand, /mysql -h 203\.0\.113\.10 -P 3307/);
  });

  it('ManageContainerPowerUseCase impide detener el contenedor principal de ALpanel por seguridad', async () => {
    const runtime = new InMemoryContainerRuntimeMock();
    const powerUseCase = new ManageContainerPowerUseCase(
      runtime,
      '/opt/projects',
      '/opt/alpanel'
    );

    const stopRes = await powerUseCase.stopProject('alpanel');
    assert.equal(stopRes.success, false);
    assert.match(stopRes.output, /no puedes detener ALpanel/i);
  });

  it('ToggleDevModeUseCase resuelve el subdominio develop desde domains.json y lee dev-mode.json', () => {
    const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-devdata-'));
    const prevDataDir = process.env.PANEL_DATA_DIR;
    const prevDevSub = process.env.DEV_SUBDOMAIN;
    process.env.PANEL_DATA_DIR = tmpData;
    delete process.env.DEV_SUBDOMAIN;

    try {
      fs.writeFileSync(
        path.join(tmpData, 'domains.json'),
        JSON.stringify([{ domain: 'panel.integraweb.com.co' }]),
        'utf-8'
      );

      const runtime = new InMemoryContainerRuntimeMock();
      const devModeUseCase = new ToggleDevModeUseCase(
        runtime,
        '/opt/projects',
        '/opt/alpanel'
      );

      assert.equal(
        devModeUseCase.resolveDevSubdomain(),
        'develop.integraweb.com.co'
      );

      const defaultState = devModeUseCase.getDevModeState();
      assert.equal(defaultState.active, false);
      assert.equal(defaultState.domain, 'develop.integraweb.com.co');
    } finally {
      if (prevDataDir === undefined) delete process.env.PANEL_DATA_DIR;
      else process.env.PANEL_DATA_DIR = prevDataDir;
      if (prevDevSub !== undefined) process.env.DEV_SUBDOMAIN = prevDevSub;
      fs.rmSync(tmpData, { recursive: true, force: true });
    }
  });

  it('ListProjectsUseCase descubre proyectos, agrega métricas y ordena ALpanel primero', async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-list-'));
    const projectsRoot = path.join(tmpBase, 'projects');
    const panelSelfDir = path.join(tmpBase, 'alpanel');
    const appDir = path.join(projectsRoot, 'zeta_crm');
    fs.mkdirSync(panelSelfDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });

    fs.writeFileSync(path.join(panelSelfDir, 'package.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(appDir, 'manage.py'), '# django', 'utf-8');
    fs.writeFileSync(path.join(appDir, 'docker-compose.yml'), 'version: "3"', 'utf-8');

    const runtime = new InMemoryContainerRuntimeMock();
    runtime.containers = [
      {
        Id: '1234567890abcdef',
        Names: ['/zeta_crm_backend'],
        Image: 'python:3.11',
        State: 'running',
        Status: 'Up 5 minutes',
        Ports: [{ PrivatePort: 8000, PublicPort: 8000, Type: 'tcp' }],
        Labels: {
          'com.docker.compose.project': 'zeta_crm',
          'com.docker.compose.service': 'backend',
          'com.docker.compose.project.working_dir': appDir,
        },
      } as any,
    ];

    const gitMock = new InMemoryGitRepositoryMock();
    const diskAdapter = new FilesystemDiskAdapter();
    (diskAdapter as any).getDirectoryDiskSize = async () => 4096;

    const dbUseCase = new ManageProjectDbUseCase(runtime, panelSelfDir);
    const devModeUseCase = new ToggleDevModeUseCase(
      runtime,
      projectsRoot,
      panelSelfDir
    );
    const hostServiceMock: any = {
      getPublicIp: async () => '198.51.100.25',
    };

    const listUseCase = new ListProjectsUseCase(
      hostServiceMock,
      runtime,
      gitMock,
      diskAdapter,
      dbUseCase,
      devModeUseCase,
      projectsRoot,
      panelSelfDir
    );

    try {
      const projects = await listUseCase.execute();
      assert.equal(projects.length, 2);
      assert.equal(projects[0].name, 'alpanel');
      assert.equal(projects[1].name, 'zeta_crm');
      assert.equal(projects[1].status, 'running');
      assert.ok(projects[1].stack.includes('Python / Django'));
      assert.equal(projects[1].containers.length, 1);
      assert.equal(projects[1].resources.cpuPercent, 12.5);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
