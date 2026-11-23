import {
  hashProvekoArgon2id,
  verifyProvekoArgon2id,
} from '../../src/shared/infrastructure/services/argon2id.util';
import { ManageProjectDbUseCase } from '../../src/modules/projects/application/use-cases/manage-project-db.use-case';

describe('Argon2id (RFC 9106) & PostgreSQL Internal Port 5432 Resolution', () => {
  it('genera hash argon2id idéntico bit a bit a golang.org/x/crypto/argon2.IDKey y verifica credenciales', () => {
    const fixedSalt = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
    const hash = hashProvekoArgon2id('AdminPlataforma2026*', fixedSalt);

    expect(hash).toBe(
      'argon2id$000102030405060708090a0b0c0d0e0f$d471d4a0cb8169de9ff7d55ede34602efd96814dc50e3846a118a9ea7652fdd1'
    );
    expect(verifyProvekoArgon2id('AdminPlataforma2026*', hash)).toBe(true);
    expect(verifyProvekoArgon2id('ClaveIncorrecta123*', hash)).toBe(false);
    expect(verifyProvekoArgon2id('AdminPlataforma2026*', 'invalido')).toBe(false);
  });

  it('ManageProjectDbUseCase asigna internalPort 5432 (nunca 3306) en contenedores PostgreSQL sin puertos publicados al host', async () => {
    const runtimeMock: any = {
      inspectContainerConfig: jest.fn().mockResolvedValue({
        env: {
          POSTGRES_DB: 'control_plane_db',
          POSTGRES_USER: 'postgres',
          POSTGRES_PASSWORD: 'secret',
        },
        externalPort: '',
        internalPort: '3306', // Simula fallback legado antes de normalización
      }),
    };

    const dbUseCase = new ManageProjectDbUseCase(runtimeMock);
    const info = await dbUseCase.extractDatabaseInfo(
      '/tmp/non-existent-proveko',
      [
        {
          id: 'abc123456789',
          name: 'proveko_db',
          serviceName: 'db',
          image: 'postgres:16-alpine',
          state: 'stopped',
          status: 'Exited',
          cpuPercent: 0,
          memoryBytes: 0,
          memoryLimitBytes: 0,
          memoryPercent: 0,
          ports: [],
          role: 'database',
        },
      ],
      {},
      '127.0.0.1'
    );

    expect(info.hasDatabase).toBe(true);
    expect(info.internalPort).toBe('5432');
    expect(info.port).toBe('5432');
    expect(info.cliCommand).toContain('-p 5432');
  });
});
