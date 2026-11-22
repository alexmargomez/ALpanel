import { ResourceGuardService, LiveMemorySnapshot } from '../../src/shared/infrastructure/services/resource-guard.service';
import { InsufficientServerMemoryException } from '../../src/modules/projects/domain/exceptions/project.exception';

describe('ResourceGuardService — Pre-Flight RAM Guard & Live OOM Watchdog', () => {
  it('permite operaciones cuando existe suficiente memoria disponible en el VPS', () => {
    const guard = new ResourceGuardService(() => ({
      totalMb: 3800,
      availableMb: 2100,
      usedMb: 1700,
      usagePercent: 45,
      swapTotalMb: 0,
      swapFreeMb: 0,
    }));

    const snap = guard.assertMemoryAvailableForOperation({
      operation: 'clonar y desplegar',
      targetProject: 'Proveko',
      requiresBuild: true,
      additionalContainersCount: 6,
    });

    expect(snap.availableMb).toBe(2100);
  });

  it('bloquea preventivamente y lanza InsufficientServerMemoryException (507) cuando la RAM libre no alcanza para los contenedores solicitados', () => {
    const guard = new ResourceGuardService(() => ({
      totalMb: 3800,
      availableMb: 520,
      usedMb: 3280,
      usagePercent: 86,
      swapTotalMb: 0,
      swapFreeMb: 0,
    }));

    expect(() =>
      guard.assertMemoryAvailableForOperation({
        operation: 'desplegar 15 microservicios',
        targetProject: 'Proveko',
        requiresBuild: true,
        additionalContainersCount: 15,
      })
    ).toThrow(InsufficientServerMemoryException);

    try {
      guard.assertMemoryAvailableForOperation({
        operation: 'desplegar 15 microservicios',
        targetProject: 'Proveko',
        requiresBuild: true,
        additionalContainersCount: 15,
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(InsufficientServerMemoryException);
      expect(err.statusCode).toBe(507);
      expect(err.message).toContain('RAM Guard');
    }
  });

  it('mata el árbol de subprocesos en caliente y lanza InsufficientServerMemoryException cuando la RAM cae bajo el umbral crítico durante un build', async () => {
    let currentAvailableMb = 1600;
    const guard = new ResourceGuardService((): LiveMemorySnapshot => {
      const used = 3800 - currentAvailableMb;
      return {
        totalMb: 3800,
        availableMb: currentAvailableMb,
        usedMb: used,
        usagePercent: Math.round((used / 3800) * 100),
        swapTotalMb: 0,
        swapFreeMb: 0,
      };
    });

    // Simular caída brusca de RAM a los 300ms de iniciar un comando largo (sleep 10)
    setTimeout(() => {
      currentAvailableMb = 180;
    }, 300);

    const start = Date.now();
    await expect(
      guard.execWithMemoryWatchdog('echo "Compilando..." && sleep 10', {
        operation: 'docker compose build',
        targetProject: 'Proveko',
        timeout: 15000,
      })
    ).rejects.toThrow(InsufficientServerMemoryException);

    const elapsed = Date.now() - start;
    // Debe abortar en ~400-1000ms sin esperar los 10 segundos del comando
    expect(elapsed).toBeLessThan(3500);
  });
});
