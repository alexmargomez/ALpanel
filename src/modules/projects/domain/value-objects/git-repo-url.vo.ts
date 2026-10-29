import { DomainException } from '../../../../shared/domain/exceptions/domain.exception';

/**
 * Value Object que valida URLs de repositorios Git (HTTPS / SSH) y ramas,
 * bloqueando metacaracteres de shell ($, `, ;, |, &, <, >) para prevenir Command Injection.
 */
export class GitRepoUrlVO {
  public readonly value: string;

  private static readonly ALLOWED_PROTOCOL = /^(https?:\/\/|git@|ssh:\/\/)/i;
  private static readonly SHELL_METACHARS = /[;$`|&<>()\n\r\t\0'"\\ ]/;

  constructor(rawUrl: string) {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed || !GitRepoUrlVO.ALLOWED_PROTOCOL.test(trimmed)) {
      throw new DomainException('URL de repositorio Git inválida. Use HTTPS o SSH.', 400);
    }
    if (GitRepoUrlVO.SHELL_METACHARS.test(trimmed)) {
      throw new DomainException(
        'La URL del repositorio contiene caracteres no permitidos o intento de inyección de comandos.',
        400
      );
    }
    this.value = trimmed;
  }

  public static sanitizeBranch(rawBranch?: string): string {
    if (!rawBranch || !rawBranch.trim()) {
      return '';
    }
    const clean = rawBranch.trim();
    if (!/^[a-zA-Z0-9._/-]{1,100}$/.test(clean) || clean.startsWith('-')) {
      throw new DomainException('Nombre de rama Git inválido.', 400);
    }
    return clean;
  }
}
