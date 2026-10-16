import crypto from 'crypto';

export class CryptoService {
  hashPassword(password: string, salt?: string): string {
    const useSalt = salt || crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, useSalt, 64).toString('hex');
    return `${useSalt}:${derived}`;
  }

  verifyPasswordHash(password: string, storedHash: string): boolean {
    const [salt, key] = (storedHash || '').split(':');
    if (!salt || !key) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(key, 'hex');
    if (derived.length !== keyBuf.length) return false;
    return crypto.timingSafeEqual(derived, keyBuf);
  }
}

export const cryptoService = new CryptoService();
