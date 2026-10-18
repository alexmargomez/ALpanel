import { CryptoService } from '../../src/shared/infrastructure/services/crypto.service';

describe('CryptoService (scrypt password hashing & verification)', () => {
  const cryptoService = new CryptoService();

  it('genera un hash con formato salt:derivedKey y longitud válida', () => {
    const hash = cryptoService.hashPassword('MiClaveSegura2026!');
    const parts = hash.split(':');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(32);
    expect(parts[1]).toHaveLength(128);
  });

  it('genera hashes distintos para la misma contraseña cuando el salt es aleatorio', () => {
    const hash1 = cryptoService.hashPassword('misma_clave');
    const hash2 = cryptoService.hashPassword('misma_clave');
    expect(hash1).not.toBe(hash2);
  });

  it('genera el mismo hash cuando se provee un salt explícito', () => {
    const fixedSalt = '0123456789abcdef0123456789abcdef';
    const hash1 = cryptoService.hashPassword('clave_fija', fixedSalt);
    const hash2 = cryptoService.hashPassword('clave_fija', fixedSalt);
    expect(hash1).toBe(hash2);
  });

  it('verifica exitosamente una contraseña correcta contra su hash', () => {
    const hash = cryptoService.hashPassword('AdminPanel#2026');
    expect(cryptoService.verifyPasswordHash('AdminPanel#2026', hash)).toBe(true);
  });

  it('rechaza contraseñas incorrectas o hashes manipulados/malformados', () => {
    const hash = cryptoService.hashPassword('AdminPanel#2026');
    expect(cryptoService.verifyPasswordHash('OtraClave', hash)).toBe(false);
    expect(cryptoService.verifyPasswordHash('AdminPanel#2026', '')).toBe(false);
    expect(
      cryptoService.verifyPasswordHash('AdminPanel#2026', 'sin_dos_puntos')
    ).toBe(false);
    expect(cryptoService.verifyPasswordHash('AdminPanel#2026', 'salt:abcd')).toBe(
      false
    );
  });
});
