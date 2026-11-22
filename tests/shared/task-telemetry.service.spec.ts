import { taskTelemetryService } from '../../src/shared/infrastructure/services/task-telemetry.service';

describe('TaskTelemetryService', () => {
  const emitMock = jest.fn();

  beforeEach(() => {
    emitMock.mockReset();
    taskTelemetryService.bindSocketServer({
      emit: emitMock,
    } as any);
  });

  it('propagates request taskId via AsyncLocalStorage and emits timestamped step milestones', async () => {
    await new Promise<void>((resolve) => {
      taskTelemetryService.enterRequestContext({
        taskId: 'task_clone_101',
        projectName: 'Proveko',
      });

      const returned = taskTelemetryService.emitTaskStep(
        '==> [Paso 1/3] Clonando repositorio https://github.com/alexmargomez/Proveko.git...',
        'Clonando repositorio Git'
      );

      expect(returned).toContain('[Paso 1/3] Clonando repositorio');
      expect(emitMock).toHaveBeenCalledWith(
        'task:stream',
        expect.objectContaining({
          taskId: 'task_clone_101',
          isError: false,
          phase: 'Clonando repositorio Git',
          chunk: expect.stringMatching(
            /^\[\d{2}:\d{2}:\d{2}\] ==> \[Paso 1\/3\] Clonando repositorio/
          ),
        })
      );
      resolve();
    });
  });

  it('normalizes git/docker carriage-return progress output into timestamped lines', () => {
    taskTelemetryService.emitTaskLog(
      'Receiving objects:  42% (120/285)\rReceiving objects: 100% (285/285), done.\n',
      {
        explicitTaskId: 'task_progress_202',
        phase: 'git clone',
      }
    );

    expect(emitMock).toHaveBeenCalledTimes(1);
    const [, payload] = emitMock.mock.calls[0];
    expect(payload.taskId).toBe('task_progress_202');
    expect(payload.phase).toBe('git clone');
    expect(payload.summaryLine).toBe('Receiving objects: 100% (285/285), done.');
    expect(payload.chunk).toContain('Receiving objects:  42% (120/285)');
    expect(payload.chunk).toContain('Receiving objects: 100% (285/285), done.');
  });

  it('broadcasts live host memory, load average, and top process tree snapshot', async () => {
    process.env.FORCE_TELEMETRY_IN_TESTS = '1';
    try {
      await taskTelemetryService.broadcastLiveTelemetry({
        explicitTaskId: 'task_top_303',
        rootPid: process.pid,
        phase: 'docker compose build',
        targetProject: 'Proveko',
        safetyFloorMb: 260,
      });

      expect(emitMock).toHaveBeenCalledWith(
        'task:telemetry',
        expect.objectContaining({
          taskId: 'task_top_303',
          phase: 'docker compose build',
          targetProject: 'Proveko',
          host: expect.objectContaining({
            ramTotalMb: expect.any(Number),
            ramAvailableMb: expect.any(Number),
            safetyFloorMb: 260,
          }),
          processes: expect.any(Array),
        })
      );
    } finally {
      delete process.env.FORCE_TELEMETRY_IN_TESTS;
    }
  });
});
