import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { SystemService } from './modules/system/system.service';
import { ProjectsService } from './modules/projects/projects.service';
import { ProxyService } from './modules/proxy/proxy.service';
import { DbService } from './modules/database/db.service';

dotenv.config();

const PORT = Number(process.env.PANEL_PORT || 9000);
const JWT_SECRET = process.env.PANEL_JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Rate limiter memory store against brute-force login attacks
const loginAttempts = new Map<string, { count: number; lockUntil: number }>();

const dbService = new DbService();

interface AuditEntry {
  timestamp: string;
  action: string;
  target: string;
  ip: string;
  status: 'ok' | 'error';
}
const auditLogs: AuditEntry[] = [];
function recordAudit(action: string, target: string, ip: string, status: 'ok' | 'error' = 'ok') {
  auditLogs.unshift({
    timestamp: new Date().toISOString(),
    action,
    target,
    ip,
    status,
  });
  if (auditLogs.length > 100) auditLogs.pop();
  dbService.insertAuditLog(action, target, ip, status).catch(() => null);
}

async function bootstrap() {
  await dbService.init();

  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true, credentials: true });
  await app.register(fastifyJwt, { secret: JWT_SECRET });

  // Security headers inspired by Bolt Panel
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
  });

  const systemService = new SystemService();
  const projectsService = new ProjectsService(systemService);
  const proxyService = new ProxyService();

  // Sincronizar red global de Caddy al iniciar
  proxyService.reloadCaddy().catch(() => null);

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'No autorizado. Inicia sesión nuevamente.' });
    }
  };

  // --- AUTH ENDPOINTS (MySQL + scrypt hash + Brute-Force Rate Limiting) ---
  app.post('/api/auth/login', async (request, reply) => {
    const ip = request.ip || 'unknown';
    const now = Date.now();
    const record = loginAttempts.get(ip);

    if (record && record.lockUntil > now) {
      const waitSec = Math.ceil((record.lockUntil - now) / 1000);
      return reply.code(429).send({
        error: `Demasiados intentos fallidos. Intenta de nuevo en ${waitSec} segundos.`,
      });
    }

    const body = request.body as { username?: string; password?: string };
    const authRes = await dbService.verifyUserCredentials(body?.username || '', body?.password || '');

    if (authRes.valid && authRes.user) {
      loginAttempts.delete(ip);
      recordAudit('AUTH_LOGIN_DB', authRes.user.username, ip, 'ok');
      const token = app.jwt.sign(
        { id: authRes.user.id, username: authRes.user.username, role: authRes.user.role },
        { expiresIn: '24h' }
      );
      return { token, username: authRes.user.username };
    }

    const attempts = (record?.count || 0) + 1;
    const lockUntil = attempts >= 5 ? now + 10 * 60 * 1000 : 0; // 10 min ban after 5 fails
    loginAttempts.set(ip, { count: attempts, lockUntil });
    recordAudit('AUTH_FAILED', body?.username || 'unknown', ip, 'error');

    return reply.code(401).send({ error: 'Usuario o contraseña incorrectos' });
  });

  app.get('/api/auth/me', { preHandler: [authenticate] }, async (request) => {
    return { user: request.user };
  });

  app.get('/api/users', { preHandler: [authenticate] }, async () => {
    const [users, roles] = await Promise.all([dbService.listUsers(), dbService.listRoles()]);
    return { users, roles };
  });

  app.post('/api/users', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as { username?: string; fullName?: string; password?: string; roleId?: number };
    try {
      const created = await dbService.createUser({
        username: body?.username || '',
        fullName: body?.fullName || '',
        password: body?.password || '',
        roleId: body?.roleId ? Number(body.roleId) : undefined,
      });
      recordAudit('USER_CREATE', `${created.username} (${created.role})`, request.ip, 'ok');
      return { success: true, user: created };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.put('/api/users/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { username?: string; fullName?: string; password?: string; roleId?: number };
    try {
      const updated = await dbService.updateUser(Number(id), {
        username: body?.username || '',
        fullName: body?.fullName || '',
        password: body?.password,
        roleId: body?.roleId ? Number(body.roleId) : undefined,
      });
      recordAudit('USER_UPDATE', `${updated.username} (${updated.role})`, request.ip, 'ok');
      return { success: true, user: updated };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.delete('/api/users/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await dbService.deleteUser(Number(id));
      recordAudit('USER_DELETE', `id:${id}`, request.ip, 'ok');
      return { success: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.get('/api/roles', { preHandler: [authenticate] }, async () => {
    return { roles: await dbService.listRoles() };
  });

  app.post('/api/roles', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as { code?: string; name?: string; description?: string };
    try {
      const created = await dbService.createRole({
        code: body?.code || '',
        name: body?.name || '',
        description: body?.description || '',
      });
      recordAudit('ROLE_CREATE', `${created.code} (${created.name})`, request.ip, 'ok');
      return { success: true, role: created };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.put('/api/roles/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { code?: string; name?: string; description?: string };
    try {
      const updated = await dbService.updateRole(Number(id), {
        code: body?.code || '',
        name: body?.name || '',
        description: body?.description || '',
      });
      recordAudit('ROLE_UPDATE', `${updated.code} (${updated.name})`, request.ip, 'ok');
      return { success: true, role: updated };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.delete('/api/roles/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await dbService.deleteRole(Number(id));
      recordAudit('ROLE_DELETE', `id:${id}`, request.ip, 'ok');
      return { success: true };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.post('/api/users/password', { preHandler: [authenticate] }, async (request, reply) => {
    const body = request.body as { newPassword?: string };
    const user = request.user as { username: string };
    try {
      await dbService.changePassword(user.username, body?.newPassword || '');
      recordAudit('USER_PASSWORD_CHANGE', user.username, request.ip, 'ok');
      return { success: true, message: 'Contraseña actualizada con hash scrypt en MariaDB.' };
    } catch (e: any) {
      return reply.code(400).send({ error: e.message });
    }
  });

  app.get('/api/audit', { preHandler: [authenticate] }, async () => {
    const dbLogs = await dbService.getAuditLogs(150);
    if (dbLogs.length > 0) {
      return {
        logs: dbLogs.map((l) => ({
          timestamp: l.time,
          action: l.action,
          target: l.target,
          ip: l.ip,
          status: l.status,
        })),
      };
    }
    return { logs: auditLogs };
  });

  // --- SYSTEM METRICS & PRUNE ---
  app.get('/api/system/metrics', { preHandler: [authenticate] }, async () => {
    return systemService.getHostMetrics();
  });

  app.post('/api/system/prune', { preHandler: [authenticate] }, async (request) => {
    const res = await systemService.pruneDockerCache();
    recordAudit('DOCKER_PRUNE', 'server', request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  // --- PROJECTS ENDPOINTS ---
  app.get('/api/projects', { preHandler: [authenticate] }, async () => {
    const [host, projects] = await Promise.all([
      systemService.getHostMetrics(),
      projectsService.listProjects(),
    ]);
    return {
      host,
      projectsRoot: projectsService.getProjectsRoot(),
      projects,
    };
  });

  app.post('/api/projects/:name/check-updates', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    return projectsService.checkProjectUpdates(name);
  });

  app.post('/api/projects/:name/pull', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const res = await projectsService.gitPullAndRestart(name);
    recordAudit('GIT_PULL_DEPLOY', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.post('/api/projects/:name/restart', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const body = (request.body || {}) as { containerName?: string };
    const res = await projectsService.restartProject(name, body.containerName);
    recordAudit('DOCKER_RESTART', body.containerName ? `${name}/${body.containerName}` : name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.post('/api/projects/:name/start', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const res = await projectsService.startProject(name);
    recordAudit('DOCKER_START', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.post('/api/projects/:name/stop', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const res = await projectsService.stopProject(name);
    recordAudit('DOCKER_STOP', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.post('/api/projects/:name/rebuild', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const res = await projectsService.rebuildProject(name);
    recordAudit('DOCKER_REBUILD', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.post('/api/projects/:name/clear-cache', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const res = await projectsService.clearProjectCache(name);
    recordAudit('CLEAR_CACHE', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.post('/api/projects/:name/dev-activate', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const res = await projectsService.activateDevMode(name, proxyService);
    recordAudit('DEV_MODE_ACTIVATE', `${name} (develop)`, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.post('/api/projects/:name/dev-deactivate', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const res = await projectsService.deactivateDevMode(proxyService);
    recordAudit('DEV_MODE_DEACTIVATE', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.get('/api/projects/:name/db-dump', { preHandler: [authenticate] }, async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      const { filename, sql } = await projectsService.dumpDatabaseSql(name);
      recordAudit('DB_EXPORT_SQL', name, request.ip, 'ok');
      reply.header('Content-Type', 'application/sql');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(sql);
    } catch (error: any) {
      recordAudit('DB_EXPORT_SQL', name, request.ip, 'error');
      return reply.code(400).send({ error: error?.message || 'Error exportando base de datos' });
    }
  });

  app.get('/api/projects/:name/logs', { preHandler: [authenticate] }, async (request) => {
    const { container, tail } = request.query as { container: string; tail?: string };
    const logs = await projectsService.getContainerLogs(container, Number(tail || 150));
    return { logs };
  });

  app.get('/api/projects/:name/env', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    return projectsService.getEnvFileContent(name);
  });

  app.post('/api/projects/:name/env', { preHandler: [authenticate] }, async (request) => {
    const { name } = request.params as { name: string };
    const body = request.body as { content: string; restart?: boolean };
    const res = await projectsService.saveEnvFileContent(name, body.content || '', body.restart !== false);
    recordAudit('ENV_UPDATE', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  app.post('/api/projects/clone', { preHandler: [authenticate] }, async (request) => {
    const body = request.body as {
      name: string;
      repoUrl: string;
      branch?: string;
      envContent?: string;
      autoStart?: boolean;
    };
    const res = await projectsService.cloneNewProject(body);
    recordAudit('GIT_CLONE_PROJECT', body.name, request.ip, res.success ? 'ok' : 'error');
    return res;
  });

  // --- PROXY / DOMAINS ENDPOINTS ---
  app.get('/api/domains', { preHandler: [authenticate] }, async () => {
    return {
      routes: proxyService.listRoutes(),
      caddyfile: proxyService.generateCaddyfile(),
    };
  });

  app.post('/api/domains', { preHandler: [authenticate] }, async (request) => {
    const body = request.body as any;
    const saved = proxyService.saveRoute(body);
    const reload = await proxyService.reloadCaddy();
    recordAudit('DOMAIN_SAVE', saved.domain, request.ip, 'ok');
    return { route: saved, reload };
  });

  app.delete('/api/domains/:id', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    proxyService.deleteRoute(id);
    const reload = await proxyService.reloadCaddy();
    recordAudit('DOMAIN_DELETE', id, request.ip, 'ok');
    return { success: true, reload };
  });

  // --- SERVE SPA FRONTEND ---
  const publicDir = path.join(__dirname, '..', 'public');
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Endpoint no encontrado' });
    } else {
      reply.sendFile('index.html');
    }
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 ALpanel activo en http://0.0.0.0:${PORT}`);

  // --- WEBSOCKET REALTIME STREAM ---
  const io = new SocketIOServer(app.server, {
    cors: { origin: '*' },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      app.jwt.verify(token);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  let metricsInterval: NodeJS.Timeout | null = null;

  io.on('connection', (socket) => {
    if (!metricsInterval) {
      metricsInterval = setInterval(async () => {
        if (io.engine.clientsCount === 0) return;
        try {
          const [host, projects] = await Promise.all([
            systemService.getHostMetrics(),
            projectsService.listProjects(),
          ]);
          io.emit('dashboard:update', { host, projects });
        } catch {
          // Ignore transient docker errors
        }
      }, 4000);
    }

    socket.on('disconnect', () => {
      if (io.engine.clientsCount === 0 && metricsInterval) {
        clearInterval(metricsInterval);
        metricsInterval = null;
      }
    });
  });
}

bootstrap().catch((err) => {
  console.error('Error fatal iniciando ALpanel:', err);
  process.exit(1);
});
