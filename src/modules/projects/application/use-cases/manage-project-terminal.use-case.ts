import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ProjectInfo } from '../../domain/entities/project.entity';
import { ProjectNameVO } from '../../domain/value-objects/project-name.vo';

const execAsync = promisify(exec);

export interface TerminalExecPayload {
  targetType?: 'container' | 'host';
  containerName?: string;
  command: string;
  cwd?: string;
}

export interface TerminalExecResult {
  success: boolean;
  output: string;
  cwd: string;
  targetLabel: string;
  durationMs: number;
  exitCode: number;
}

const CWD_MARKER = '__ALPANEL_CWD_MARKER__:';

export class ManageProjectTerminalUseCase {
  constructor(
    private readonly projectsRoot = process.env.PROJECTS_ROOT || '/opt/projects',
    private readonly panelSelfDir = process.env.PANEL_SELF_PATH || '/opt/alpanel'
  ) {}

  async executeTerminalCommand(
    projectName: string,
    payload: TerminalExecPayload,
    projects: ProjectInfo[] = [],
    customRunner?: (
      cmd: string,
      cwd?: string
    ) => Promise<{ stdout: string; stderr: string }>
  ): Promise<TerminalExecResult> {
    const vo = new ProjectNameVO(projectName);
    const rawCommand = String(payload.command || '').trim();
    if (!rawCommand) {
      throw new Error('Escribe un comando para ejecutar en la terminal.');
    }

    const startMs = Date.now();
    const projectDir = vo.resolvePath(this.projectsRoot, this.panelSelfDir);
    const targetType = payload.targetType === 'host' ? 'host' : 'container';

    let effectiveContainer = String(payload.containerName || '').trim();
    if (targetType === 'container' && !effectiveContainer) {
      const proj = projects.find(
        (p) => p.name.toLowerCase() === vo.value.toLowerCase()
      );
      const preferred =
        proj?.containers.find((c) => c.role === 'backend') ||
        proj?.containers[0];
      effectiveContainer = preferred?.name || '';
    }

    const requestedCwd = String(payload.cwd || '').trim();

    let shellCmd = '';
    let targetLabel = '';

    if (targetType === 'container') {
      const safeContainer = effectiveContainer.replace(/[^a-zA-Z0-9._-]/g, '');
      if (!safeContainer) {
        throw new Error(
          'No hay un contenedor seleccionado o activo para abrir la terminal.'
        );
      }
      targetLabel = `docker:${safeContainer}`;
      const cdPrefix = requestedCwd
        ? `cd '${requestedCwd.replace(/'/g, "'\\''")}' 2>/dev/null || true; `
        : '';
      const innerScript = `${cdPrefix}${rawCommand}; __ec=$?; printf "\\n${CWD_MARKER}%s\\n" "$(pwd)"; exit $__ec`;
      const escapedInner = innerScript.replace(/'/g, "'\\''");
      shellCmd = `docker exec ${safeContainer} sh -c '${escapedInner}'`;
    } else {
      targetLabel = `host:${vo.value}`;
      const startDir = requestedCwd && requestedCwd.startsWith(projectDir)
        ? requestedCwd
        : projectDir;
      const cdPrefix = `cd '${startDir.replace(/'/g, "'\\''")}' 2>/dev/null || true; `;
      shellCmd = `${cdPrefix}${rawCommand}; __ec=$?; printf "\\n${CWD_MARKER}%s\\n" "$(pwd)"; exit $__ec`;
    }

    const execFn =
      customRunner ||
      ((cmd: string, cwd?: string) =>
        execAsync(cmd, {
          cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
          timeout: 60000,
          maxBuffer: 8 * 1024 * 1024,
        }));

    try {
      const { stdout, stderr } = await execFn(shellCmd, projectDir);
      const parsed = this.extractCwdFromOutput(
        stdout,
        stderr,
        requestedCwd || (targetType === 'host' ? projectDir : '/app')
      );
      return {
        success: true,
        output: parsed.cleanOutput,
        cwd: parsed.cwd,
        targetLabel,
        durationMs: Date.now() - startMs,
        exitCode: 0,
      };
    } catch (error: any) {
      const parsed = this.extractCwdFromOutput(
        String(error?.stdout || ''),
        String(error?.stderr || error?.message || 'Error ejecutando comando'),
        requestedCwd || (targetType === 'host' ? projectDir : '/app')
      );
      return {
        success: false,
        output: parsed.cleanOutput || error?.message || 'Comando finalizó con error.',
        cwd: parsed.cwd,
        targetLabel,
        durationMs: Date.now() - startMs,
        exitCode: typeof error?.code === 'number' ? error.code : 1,
      };
    }
  }

  private extractCwdFromOutput(
    stdout: string,
    stderr: string,
    fallbackCwd: string
  ): { cleanOutput: string; cwd: string } {
    let detectedCwd = fallbackCwd;
    const cleanedStdoutLines: string[] = [];

    for (const line of (stdout || '').split(/\r?\n/)) {
      if (line.startsWith(CWD_MARKER)) {
        const candidate = line.slice(CWD_MARKER.length).trim();
        if (candidate) detectedCwd = candidate;
      } else {
        cleanedStdoutLines.push(line);
      }
    }

    const outStr = cleanedStdoutLines.join('\n').trimEnd();
    const errStr = (stderr || '').trimEnd();
    const combined = [outStr, errStr].filter(Boolean).join('\n');

    return {
      cleanOutput: combined,
      cwd: detectedCwd,
    };
  }
}
