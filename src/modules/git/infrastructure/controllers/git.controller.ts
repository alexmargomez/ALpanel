import { FastifyReply, FastifyRequest } from 'fastify';
import { manageGitUseCase } from '../../application/use-cases/manage-git.use-case';
import { manageAuditLogsUseCase } from '../../../security/application/use-cases/manage-audit-logs.use-case';
import { CloneProjectPayload } from '../../domain/entities/git-clone.entity';

export class GitController {
  async checkUpdates(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    return manageGitUseCase.checkUpdates(name);
  }

  async pull(request: FastifyRequest, _reply: FastifyReply) {
    const { name } = request.params as { name: string };
    const res = await manageGitUseCase.pullAndRestart(name);
    await manageAuditLogsUseCase.recordAudit(
      'GIT_PULL_DEPLOY',
      name,
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }

  async clone(request: FastifyRequest, _reply: FastifyReply) {
    const body = request.body as CloneProjectPayload;
    const res = await manageGitUseCase.cloneProject(body);
    await manageAuditLogsUseCase.recordAudit(
      'GIT_CLONE_PROJECT',
      body?.name || 'unknown',
      request.ip,
      res.success ? 'ok' : 'error'
    );
    return res;
  }
}

export const gitController = new GitController();
