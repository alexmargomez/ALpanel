import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ContainerStatInfo } from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';

const execAsync = promisify(exec);

export class FilesystemDiskAdapter {
  private diskSizeCache = new Map<
    string,
    { size: number; expiresAt: number; refreshing?: boolean }
  >();

  invalidateCache(projectDir?: string): void {
    if (projectDir) {
      this.diskSizeCache.delete(projectDir);
    } else {
      this.diskSizeCache.clear();
    }
  }

  async getDirectoryDiskSize(projectDir: string): Promise<number> {
    const now = Date.now();
    const cached = this.diskSizeCache.get(projectDir);
    if (cached && cached.expiresAt > now) {
      return cached.size;
    }
    if (cached) {
      if (!cached.refreshing) {
        cached.refreshing = true;
        execAsync(`du -sb "${projectDir}" | awk '{print $1}'`, { timeout: 4000 })
          .then(({ stdout }) => {
            const size = parseInt(stdout.trim(), 10) || 0;
            this.diskSizeCache.set(projectDir, {
              size,
              expiresAt: Date.now() + 60_000,
            });
          })
          .catch(() => {
            cached.refreshing = false;
          });
      }
      return cached.size;
    }
    try {
      const { stdout } = await execAsync(
        `du -sb "${projectDir}" | awk '{print $1}'`,
        { timeout: 4000 }
      );
      const size = parseInt(stdout.trim(), 10) || 0;
      this.diskSizeCache.set(projectDir, { size, expiresAt: now + 60_000 });
      return size;
    } catch {
      return 0;
    }
  }

  parseEnvDictionary(projectDir: string): Record<string, string> {
    const envPath = path.join(projectDir, '.env');
    const examplePath = path.join(projectDir, '.env.example');
    let result: Record<string, string> = {};
    try {
      if (fs.existsSync(examplePath)) {
        result = {
          ...result,
          ...dotenv.parse(fs.readFileSync(examplePath, 'utf-8')),
        };
      }
      if (fs.existsSync(envPath)) {
        result = { ...result, ...dotenv.parse(fs.readFileSync(envPath, 'utf-8')) };
      }
    } catch {
      // Ignore parse errors
    }
    return result;
  }

  extractDomains(
    projectDir: string,
    envDict: Record<string, string>,
    panelSelfDir: string
  ): string[] {
    const domains = new Set<string>();
    if (
      envDict.CADDY_DOMAIN &&
      envDict.CADDY_DOMAIN !== 'localhost' &&
      envDict.CADDY_DOMAIN !== 'tu_dominio.com'
    ) {
      domains.add(envDict.CADDY_DOMAIN.trim());
    }
    if (envDict.APP_URL) {
      try {
        const u = new URL(envDict.APP_URL);
        if (u.hostname && u.hostname !== 'localhost') domains.add(u.hostname);
      } catch {}
    }
    if (envDict.ALLOWED_HOSTS) {
      envDict.ALLOWED_HOSTS.split(',').forEach((h) => {
        const clean = h.trim();
        if (
          clean &&
          clean !== 'localhost' &&
          clean !== '127.0.0.1' &&
          !/^\d+\.\d+\.\d+\.\d+$/.test(clean) &&
          clean !== 'tu_ip_o_dominio'
        ) {
          domains.add(clean);
        }
      });
    }
    try {
      const dataDir =
        process.env.PANEL_DATA_DIR || path.join(process.cwd(), 'data');
      const domainsFile = path.join(dataDir, 'domains.json');
      if (fs.existsSync(domainsFile)) {
        const routes = JSON.parse(fs.readFileSync(domainsFile, 'utf-8'));
        const projBase = path.basename(projectDir).toLowerCase();
        const isSelf = ProjectNameVO.isSelfPanel(projBase, panelSelfDir);
        if (Array.isArray(routes)) {
          for (const r of routes) {
            const routeProj = String(r?.projectName || '').toLowerCase();
            if (
              r?.domain &&
              (routeProj === projBase ||
                (isSelf && ProjectNameVO.isSelfPanel(routeProj, panelSelfDir)))
            ) {
              domains.add(String(r.domain).trim());
            }
          }
        }
      }
    } catch {}
    return Array.from(domains);
  }

  private inspectDirStack(dir: string, stacks: Set<string>): void {
    const hasArtisan = fs.existsSync(path.join(dir, 'artisan'));
    const hasSymfony = fs.existsSync(path.join(dir, 'symfony'));
    const composerPath = path.join(dir, 'composer.json');

    if (hasArtisan) {
      stacks.add('PHP / Laravel');
    } else if (hasSymfony) {
      stacks.add('PHP / Symfony');
    } else if (fs.existsSync(composerPath)) {
      try {
        const comp = JSON.parse(fs.readFileSync(composerPath, 'utf-8'));
        const reqs = { ...(comp.require || {}), ...(comp['require-dev'] || {}) };
        if (reqs['laravel/framework']) {
          stacks.add('PHP / Laravel');
        } else if (
          Object.keys(reqs).some((k) => k.startsWith('symfony/'))
        ) {
          stacks.add('PHP / Symfony');
        } else {
          stacks.add('PHP');
        }
      } catch {
        stacks.add('PHP');
      }
    }

    if (fs.existsSync(path.join(dir, 'manage.py'))) {
      stacks.add('Python / Django');
    } else if (fs.existsSync(path.join(dir, 'requirements.txt'))) {
      try {
        const reqTxt = fs
          .readFileSync(path.join(dir, 'requirements.txt'), 'utf-8')
          .toLowerCase();
        if (reqTxt.includes('fastapi')) stacks.add('Python / FastAPI');
        else if (reqTxt.includes('django')) stacks.add('Python / Django');
        else stacks.add('Python');
      } catch {
        stacks.add('Python');
      }
    }

    if (
      fs.existsSync(path.join(dir, 'pom.xml')) ||
      fs.existsSync(path.join(dir, 'build.gradle'))
    ) {
      stacks.add('Java / Spring');
    }

    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
        let detectedJsFramework = false;
        if (deps.next) {
          stacks.add('Next.js');
          detectedJsFramework = true;
        }
        if (deps.react) {
          stacks.add('React');
          detectedJsFramework = true;
        }
        if (deps.vue) {
          stacks.add('Vue 3');
          detectedJsFramework = true;
        }
        if (deps['@angular/core']) {
          stacks.add('Angular');
          detectedJsFramework = true;
        }
        if (deps.fastify || deps.express || deps['@nestjs/core']) {
          stacks.add('Node.js');
          detectedJsFramework = true;
        }
        if (!detectedJsFramework && !hasArtisan) {
          stacks.add('Node.js');
        }
      } catch {
        if (!hasArtisan) stacks.add('Node.js');
      }
    }
  }

  detectStack(projectDir: string, containers: ContainerStatInfo[]): string[] {
    const stacks = new Set<string>();
    const ignoredDirs = new Set([
      'node_modules',
      'vendor',
      'dist',
      'build',
      'public',
      'storage',
      'coverage',
      'data',
      'tests',
      'test',
    ]);

    try {
      this.inspectDirStack(projectDir, stacks);

      const entries = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.name.startsWith('.') ||
          ignoredDirs.has(entry.name.toLowerCase())
        ) {
          continue;
        }
        this.inspectDirStack(path.join(projectDir, entry.name), stacks);
      }
    } catch {
      // Ignore fs errors
    }

    for (const c of containers) {
      const img = c.image.toLowerCase();
      if (img.includes('mysql')) stacks.add('MySQL');
      if (img.includes('mariadb')) stacks.add('MariaDB');
      if (img.includes('postgres')) stacks.add('PostgreSQL');
      if (img.includes('caddy')) stacks.add('Caddy SSL');
      if (img.includes('redis')) stacks.add('Redis');
    }

    if (stacks.size === 0) {
      stacks.add('Docker Project');
    }
    return Array.from(stacks);
  }
}

export const filesystemDiskAdapter = new FilesystemDiskAdapter();
