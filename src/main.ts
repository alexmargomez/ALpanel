import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import dotenv from 'dotenv';

import { initDatabase } from './shared/infrastructure/database/prisma.service';
import { registerApiRoutes } from './shared/infrastructure/http/routes/api.routes';
import { hostService } from './shared/infrastructure/services/host-metrics.service';
import { projectsFacadeUseCase } from './modules/projects/application/use-cases/projects-facade.use-case';
import { manageDomainsUseCase } from './modules/domains/application/use-cases/manage-domains.use-case';

dotenv.config();

const PORT = Number(process.env.PANEL_PORT || 9000);
const JWT_SECRET =
  process.env.PANEL_JWT_SECRET ||
  'alpanel_super_secret_jwt_key_change_in_prod_2026';

async function bootstrap() {
  // 0. Asegurar nombres limpios de contenedores propios (alpanel_server, alpanel_db, alpanel_caddy)
  await projectsFacadeUseCase.ensureAlpanelContainerNames().catch(() => null);

  // 1. Inicializar Prisma ORM + MariaDB 11 (Esquema, Módulos, Roles, Matriz RBAC y superadmin)
  await initDatabase();

  // 2. Sincronizar rutas de dominios desde MariaDB hacia el archivo Caddyfile
  await manageDomainsUseCase.reloadCaddy().catch(() => null);

  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true, credentials: true });
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, { secret: JWT_SECRET });

  // 3. Registrar Enrutador Maestro de Módulos Hexagonales (Domain / Application / Infrastructure)
  await registerApiRoutes(app);

  // 4. Servir Vistas y Activos Modulares del Frontend
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
  console.log(
    `🚀 ALpanel (Arquitectura Hexagonal + Prisma ORM) activo en http://0.0.0.0:${PORT}`
  );

  // 5. Canal WebSocket de Telemetría en Tiempo Real
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
  let isBroadcasting = false;

  io.on('connection', (socket) => {
    Promise.all([
      hostService.getHostMetrics(),
      projectsFacadeUseCase.listProjects(),
    ])
      .then(([host, projects]) => {
        socket.emit('dashboard:update', { host, projects });
      })
      .catch(() => null);

    if (!metricsInterval) {
      metricsInterval = setInterval(async () => {
        if (io.engine.clientsCount === 0 || isBroadcasting) return;
        isBroadcasting = true;
        try {
          const [host, projects] = await Promise.all([
            hostService.getHostMetrics(),
            projectsFacadeUseCase.listProjects(),
          ]);
          io.emit('dashboard:update', { host, projects });
        } catch {
          // Ignorar errores transitorios de Docker
        } finally {
          isBroadcasting = false;
        }
      }, 1500);
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
