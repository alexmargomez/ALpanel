import { DomainException } from '../../../../shared/domain/exceptions/domain.exception';

export class DomainNameVO {
  public readonly value: string;

  constructor(raw: string) {
    const clean = (raw || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
      throw new DomainException('Formato de dominio inválido.', 400);
    }
    this.value = clean;
  }
}
