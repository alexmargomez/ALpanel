import { InvalidUsernameException } from '../exceptions/user.exception';

export class UsernameVO {
  public readonly value: string;

  constructor(raw: string) {
    const clean = (raw || '').trim().toLowerCase();
    if (!clean || clean.length < 3 || !/^[a-z0-9._-]+$/.test(clean)) {
      throw new InvalidUsernameException();
    }
    this.value = clean;
  }
}
