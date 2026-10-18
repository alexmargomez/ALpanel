import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CryptoService } from '../crypto.service';

describe('CryptoService (scrypt password hashing & verification)', () => {
  const cryptoService = new CryptoService();

  it('genera un hash con formato salt:derivedKey y longitud válida', () => {
    const hash = cryptoService.hashPassword('MiClaveSegura2026!');
    const parts = hash.split(':');
    assert.equal(parts.length, 2);
    assert.equal(parts[0].length, 32);
    assert.equal(parts[1].length, 128);
  });

  it('genera hashes distintos para la misma contraseña cuando el salt es aleatorio', () => {
    const hash1 = cryptoService.hashPassword('misma_clave');
    const hash2 = cryptoService.hashPassword('misma_clave');
    assert.notEqual(hash1, hash2);
  });

  it('genera el mismo hash cuando se provee un salt explícito', () => {
    const fixedSalt = '0123456789abcdef0123456789abcdef';
    const hash1 = cryptoService.hashPassword('clave_fija', fixedSalt);
    const hash2 = cryptoService.hashPassword('clave_fija', fixedSalt);
    assert.equal(hash1, hash2);
  });

  it('verifica exitosamente una contraseña correcta contra su hash', () => {
    const hash = cryptoService.hashPassword('AdminPanel#2026');
    assert.equal(cryptoService.verifyPasswordHash('AdminPanel#2026', hash), true);
  });

  it('rechaza contraseñas incorrectas o hashes manipulados/malformados', () => {
    const hash = cryptoService.hashPassword('AdminPanel#2026');
    assert.equal(cryptoService.verifyPasswordHash('OtraClave', hash), false);
    assert.equal(cryptoService.verifyPasswordHash('AdminPanel#2026', ''), false);
    assert.equal(
      cryptoService.verifyPasswordHash('AdminPanel#2026', 'sin_dos_puntos'),
      false
    );
    assert.equal(
      cryptoService.verifyPasswordHash('AdminPanel#2026', 'salt:abcd'),
      false
    );
  });
});
