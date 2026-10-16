import { FastifyReply, FastifyRequest } from 'fastify';
import { gitService } from './git.service';
import { securityService } from '../security/security.service';
import { CloneProjectPayload } from './git.model';

export class GitController {
  async checkUpdates(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    return gitService.checkUpdates(name);
  }

  async pull(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await gitService.pullAndRestart(name);
    await securityService.recordAudit('GIT_PULL_DEPLOY', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  }

  async activateDev(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await gitService.activateDevMode(name);
    await securityService.recordAudit(
      'DEV_MODE_ACTIVATE',
      `${name} (develop)`,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async deactivateDev(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await gitService.deactivateDevMode();
    await securityService.recordAudit('DEV_MODE_DEACTIVATE', name, request.ip, res.success ? 'ok' : 'error');
    return res;
  }

  async clone(request: FastifyRequest, _reply: FastifyReply) {
    const body = request.body as CloneProjectPayload;
    const res = await gitService.cloneProject(body);
    await securityService.recordAudit(
      'GIT_CLONE_PROJECT',
      body?.name || 'unknown',
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }
}

export const gitController = new GitController();
