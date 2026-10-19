import fs from 'fs';
import os from 'os';
import path from 'path';
import Docker from 'dockerode';
import {
  ContainerRuntimePort,
  InspectedContainerConfig,
  LiveContainerMetrics,
} from '../../../src/modules/projects/application/ports/container-runtime.port';
import { GitRepositoryPort } from '../../../src/modules/projects/application/ports/git-repository.port';
import { ManageProjectEnvUseCase } from '../../../src/modules/projects/application/use-cases/manage-project-env.use-case';
import { ManageProjectDbUseCase } from '../../../src/modules/projects/application/use-cases/manage-project-db.use-case';
import {
  ManageContainerPowerUseCase,
  extractComposeContainerNames,
  getCleanComposeEnv,
} from '../../../src/modules/projects/application/use-cases/manage-container-power.use-case';
import { ToggleDevModeUseCase } from '../../../src/modules/projects/application/use-cases/toggle-dev-mode.use-case';
import { ListProjectsUseCase } from '../../../src/modules/projects/application/use-cases/list-projects.use-case';
import { FilesystemDiskAdapter } from '../../../src/modules/projects/infrastructure/adapters/filesystem-disk.adapter';
import { DockerodeRuntimeAdapter } from '../../../src/modules/projects/infrastructure/adapters/dockerode-runtime.adapter';
import { ContainerStatInfo } from '../../../src/modules/projects/domain/entities/project.entity';

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
    expect(runtime.detectRole('db', 'mariadb:10.11')).toBe('database');
    expect(runtime.detectRole('cache', 'redis:7-alpine')).toBe('database');
    expect(runtime.detectRole('alpanel_caddy', 'caddy:2-alpine')).toBe('proxy');
    expect(runtime.detectRole('web_front', 'node:20-vite')).toBe('frontend');
    expect(runtime.detectRole('api_server', 'node:20-alpine')).toBe('backend');
  });

  it('ManageProjectEnvUseCase lee .env.example como fallback y guarda .env con permisos 0600', async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-env-'));
    const projDir = path.join(tmpBase, 'mi_proyecto');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, '.env.example'), 'PORT=4000\n', 'utf-8');

    const onInvalidate = jest.fn();
    const useCase = new ManageProjectEnvUseCase(
      tmpBase,
      path.join(tmpBase, 'alpanel'),
      onInvalidate
    );

    try {
      const initial = useCase.getEnvFileContent('mi_proyecto');
      expect(initial.exists).toBe(false);
      expect(initial.content).toBe('PORT=4000\n');

      const restartMock = jest
        .fn()
        .mockResolvedValue({ success: true, output: 'Reiniciado mock' });

      const saveRes = await useCase.saveEnvFileContent(
        'mi_proyecto',
        'PORT=5000\nDB_HOST=db\n',
        true,
        restartMock
      );

      expect(saveRes.success).toBe(true);
      expect(restartMock).toHaveBeenCalledWith('mi_proyecto');
      expect(onInvalidate).toHaveBeenCalledWith(path.resolve(projDir));

      const afterSave = useCase.getEnvFileContent('mi_proyecto');
      expect(afterSave.exists).toBe(true);
      expect(afterSave.content).toBe('PORT=5000\nDB_HOST=db\n');

      const mode = fs.statSync(path.join(projDir, '.env')).mode & 0o777;
      expect(mode).toBe(0o600);
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
    expect(noDb.hasDatabase).toBe(false);
    expect(noDb.status).toBe('none');

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

    expect(mariaDb.hasDatabase).toBe(true);
    expect(mariaDb.database).toBe('hc_clinica');
    expect(mariaDb.username).toBe('hc_user');
    expect(mariaDb.port).toBe('3307');
    expect(mariaDb.connectionUrl).toBe(
      'mysql://hc_user:secret_password@203.0.113.10:3307/hc_clinica'
    );
    expect(mariaDb.cliCommand).toMatch(/mysql -h 203\.0\.113\.10 -P 3307/);
  });

  it('ManageContainerPowerUseCase impide detener el contenedor principal de ALpanel por seguridad', async () => {
    const runtime = new InMemoryContainerRuntimeMock();
    const powerUseCase = new ManageContainerPowerUseCase(
      runtime,
      '/opt/projects',
      '/opt/alpanel'
    );

    const stopRes = await powerUseCase.stopProject('alpanel');
    expect(stopRes.success).toBe(false);
    expect(stopRes.output).toMatch(/no puedes detener ALpanel/i);
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

      expect(devModeUseCase.resolveDevSubdomain()).toBe(
        'develop.integraweb.com.co'
      );

      const defaultState = devModeUseCase.getDevModeState();
      expect(defaultState.active).toBe(false);
      expect(defaultState.domain).toBe('develop.integraweb.com.co');
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
    fs.writeFileSync(
      path.join(appDir, 'docker-compose.yml'),
      'version: "3"',
      'utf-8'
    );

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
    jest.spyOn(diskAdapter, 'getDirectoryDiskSize').mockResolvedValue(4096);

    const dbUseCase = new ManageProjectDbUseCase(runtime, panelSelfDir);
    const devModeUseCase = new ToggleDevModeUseCase(
      runtime,
      projectsRoot,
      panelSelfDir
    );
    const hostServiceMock: any = {
      getPublicIp: jest.fn().mockResolvedValue('198.51.100.25'),
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
      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('alpanel');
      expect(projects[1].name).toBe('zeta_crm');
      expect(projects[1].status).toBe('running');
      expect(projects[1].stack).toContain('Python / Django');
      expect(projects[1].containers).toHaveLength(1);
      expect(projects[1].resources.cpuPercent).toBe(12.5);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('FilesystemDiskAdapter.detectStack detecta PHP / Laravel y React en subcarpetas personalizadas (ej. API_REST y Frontend)', () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-stack-'));
    const apiRestDir = path.join(tmpProj, 'API_REST');
    const frontendDir = path.join(tmpProj, 'Frontend');
    fs.mkdirSync(apiRestDir, { recursive: true });
    fs.mkdirSync(frontendDir, { recursive: true });

    fs.writeFileSync(path.join(apiRestDir, 'artisan'), '#!/usr/bin/env php', 'utf-8');
    fs.writeFileSync(
      path.join(apiRestDir, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '^5.0.0' } }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(frontendDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }),
      'utf-8'
    );

    const diskAdapter = new FilesystemDiskAdapter();
    try {
      const stacks = diskAdapter.detectStack(tmpProj, [
        {
          id: 'db1',
          name: 'factupos-mariadb',
          serviceName: 'db',
          image: 'mariadb:11.4',
          state: 'running',
          status: 'Up',
          cpuPercent: 0,
          memoryBytes: 0,
          memoryLimitBytes: 0,
          memoryPercent: 0,
          ports: [],
          role: 'database',
        },
      ]);

      expect(stacks).toEqual(['PHP / Laravel', 'React', 'MariaDB']);
    } finally {
      fs.rmSync(tmpProj, { recursive: true, force: true });
    }
  });

  it('getCleanComposeEnv aísla las variables DB_HOST de ALpanel y soporta variables MARIADB_*', async () => {
    const prevDbHost = process.env.DB_HOST;
    process.env.DB_HOST = 'panel_db';
    try {
      const cleanEnv = getCleanComposeEnv('/opt/projects/Factupos');
      expect(cleanEnv.DB_HOST).toBeUndefined();
      expect(cleanEnv.COMPOSE_PROJECT_NAME).toBe('factupos');

      const runtime = new InMemoryContainerRuntimeMock();
      runtime.inspectedConfigs.set('factupos_db_id', {
        env: {
          MARIADB_DATABASE: 'factupos',
          MARIADB_USER: 'factupos_user',
          MARIADB_PASSWORD: 'factupos_pass',
          MARIADB_ROOT_PASSWORD: 'root_factupos_pass',
        },
        externalPort: '3307',
        internalPort: '3306',
      });

      const dbUseCase = new ManageProjectDbUseCase(runtime, '/opt/alpanel');
      const info = await dbUseCase.extractDatabaseInfo(
        '/opt/projects/Factupos',
        [
          {
            id: 'factupos_db_id',
            name: 'factupos-mariadb',
            serviceName: 'db',
            image: 'mariadb:11.4',
            state: 'running',
            status: 'Up',
            cpuPercent: 0,
            memoryBytes: 0,
            memoryLimitBytes: 0,
            memoryPercent: 0,
            ports: [],
            role: 'database',
          },
        ],
        { DB_HOST: 'db' },
        '51.222.81.132'
      );

      expect(info.database).toBe('factupos');
      expect(info.username).toBe('factupos_user');
      expect(info.password).toBe('factupos_pass');
      expect(info.rootPassword).toBe('root_factupos_pass');
      expect(info.internalHost).toBe('db');
    } finally {
      if (prevDbHost === undefined) delete process.env.DB_HOST;
      else process.env.DB_HOST = prevDbHost;
    }
  });

  it('extractComposeContainerNames extrae container_name del docker-compose.yml y excluye contenedores protegidos de ALpanel', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-compose-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'docker-compose.yml'),
        [
          'services:',
          '  db:',
          '    image: postgres:15-alpine',
          '    container_name: zapatoqueando-db',
          '  app:',
          '    image: zapatoqueando-server:latest',
          '    container_name: "zapatoqueando-server"',
          '  panel:',
          '    image: alpanel',
          '    container_name: alpanel_server',
        ].join('\n'),
        'utf-8'
      );

      const names = extractComposeContainerNames(tmpDir);
      expect(names).toEqual(['zapatoqueando-db', 'zapatoqueando-server']);
      expect(names).not.toContain('alpanel_server');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

