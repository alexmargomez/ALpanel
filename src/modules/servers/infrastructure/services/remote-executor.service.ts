import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  RemoteContainerItem,
  ServerNodeMetrics,
  StoredServerNode,
} from '../../domain/entities/server-node.entity';
import { taskTelemetryService } from '../../../../shared/infrastructure/services/task-telemetry.service';

const execAsync = promisify(exec);

export interface EncryptedBlob {
  cipher: string;
  iv: string;
  tag: string;
}

export class RemoteExecutorService {
  private getEncryptionKey(): Buffer {
    const secret =
      process.env.PANEL_JWT_SECRET || 'alpanel_super_secret_jwt_key_change_in_prod_2026';
    return crypto.createHash('sha256').update(`alpanel-ssh-vault:${secret}`).digest();
  }

  encryptSecret(plain: string): EncryptedBlob {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      cipher: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  decryptSecret(blob?: EncryptedBlob): string {
    if (!blob?.cipher || !blob?.iv || !blob?.tag) return '';
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.getEncryptionKey(),
        Buffer.from(blob.iv, 'base64')
      );
      decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
      const dec = Buffer.concat([
        decipher.update(Buffer.from(blob.cipher, 'base64')),
        decipher.final(),
      ]);
      return dec.toString('utf-8');
    } catch {
      return '';
    }
  }

  async execOnServer(
    server: StoredServerNode,
    command: string,
    opts?: { timeoutMs?: number; cwd?: string }
  ): Promise<{ stdout: string; stderr: string }> {
    const timeout = opts?.timeoutMs || 30000;
    const fullCmd = opts?.cwd ? `cd "${opts.cwd.replace(/"/g, '\\"')}" && ${command}` : command;

    if (server.isLocal) {
      return execAsync(fullCmd, {
        timeout,
        maxBuffer: 8 * 1024 * 1024,
      });
    }

    const safeHost = server.host.replace(/[^a-zA-Z0-9._:-]/g, '');
    const safeUser = (server.sshUser || 'root').replace(/[^a-zA-Z0-9._-]/g, '');
    const safePort = Number(server.sshPort) || 22;
    const b64Script = Buffer.from(fullCmd, 'utf-8').toString('base64');
    const remoteRunner = `echo "${b64Script}" | base64 -d | sh`;
    const secret = this.decryptSecret(server.encryptedSecret);

    const baseSshOpts = [
      '-o StrictHostKeyChecking=no',
      '-o UserKnownHostsFile=/dev/null',
      '-o ConnectTimeout=8',
      '-o ServerAliveInterval=10',
      `-p ${safePort}`,
    ];

    if (server.authType === 'key' && secret) {
      const tmpKey = path.join(
        os.tmpdir(),
        `alpanel-key-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
      );
      try {
        const normalizedKey = secret.endsWith('\n') ? secret : `${secret}\n`;
        fs.writeFileSync(tmpKey, normalizedKey, { encoding: 'utf-8', mode: 0o600 });
        fs.chmodSync(tmpKey, 0o600);
        const sshCmd = `ssh -i "${tmpKey}" -o BatchMode=yes ${baseSshOpts.join(' ')} "${safeUser}@${safeHost}" '${remoteRunner}'`;
        return await execAsync(sshCmd, { timeout, maxBuffer: 8 * 1024 * 1024 });
      } finally {
        try {
          if (fs.existsSync(tmpKey)) fs.unlinkSync(tmpKey);
        } catch {
          // ignore
        }
      }
    }

    if (server.authType === 'password' && secret) {
      // Usa SSH_ASKPASS portátil sin requerir sshpass en Alpine/Debian
      const askPassScript = path.join(
        os.tmpdir(),
        `alpanel-askpass-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.sh`
      );
      try {
        const b64Pass = Buffer.from(secret, 'utf-8').toString('base64');
        fs.writeFileSync(
          askPassScript,
          `#!/bin/sh\necho "${b64Pass}" | base64 -d\n`,
          { encoding: 'utf-8', mode: 0o700 }
        );
        fs.chmodSync(askPassScript, 0o700);
        const sshCmd = `ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no ${baseSshOpts.join(' ')} "${safeUser}@${safeHost}" '${remoteRunner}'`;
        return await execAsync(sshCmd, {
          timeout,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            SSH_ASKPASS: askPassScript,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: 'none:0',
          },
        });
      } finally {
        try {
          if (fs.existsSync(askPassScript)) fs.unlinkSync(askPassScript);
        } catch {
          // ignore
        }
      }
    }

    const fallbackCmd = `ssh -o BatchMode=yes ${baseSshOpts.join(' ')} "${safeUser}@${safeHost}" '${remoteRunner}'`;
    return execAsync(fallbackCmd, { timeout, maxBuffer: 8 * 1024 * 1024 });
  }

  async probeServer(server: StoredServerNode): Promise<{
    online: boolean;
    metrics?: ServerNodeMetrics;
    error?: string;
  }> {
    const probeScript = [
      'CORES=$(nproc 2>/dev/null || echo 1)',
      'LOAD=$(awk \'{print $1}\' /proc/loadavg 2>/dev/null || echo 0)',
      'MEM_TOTAL=$(awk \'/^MemTotal:/ {print int($2/1024)}\' /proc/meminfo 2>/dev/null || echo 0)',
      'MEM_AVAIL=$(awk \'/^MemAvailable:/ {print int($2/1024)}\' /proc/meminfo 2>/dev/null || echo 0)',
      'DISK_LINE=$(df -BG / 2>/dev/null | awk \'NR==2 {gsub(/G/,"",$2); gsub(/G/,"",$3); gsub(/%/,"",$5); print $2"|"$3"|"$5}\')',
      'DOCKER_V=$(docker --version 2>/dev/null | awk \'{print $3}\' | tr -d \',\' || echo "no-instalado")',
      'COMPOSE_V=$(docker compose version --short 2>/dev/null || echo "no-instalado")',
      'CADDY_V=$(caddy version 2>/dev/null | awk \'{print $1}\' || docker ps --filter "ancestor=caddy:2" --format "{{.Names}}" 2>/dev/null | head -n 1 || echo "no-instalado")',
      'OS_NAME=$(grep -E "^PRETTY_NAME=" /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d \'"\' || uname -s)',
      'C_RUN=$(docker ps -q 2>/dev/null | wc -l | tr -d \' \')',
      'C_ALL=$(docker ps -aq 2>/dev/null | wc -l | tr -d \' \')',
      'echo "PROBE_RESULT::${CORES}::${LOAD}::${MEM_TOTAL}::${MEM_AVAIL}::${DISK_LINE}::${DOCKER_V}::${COMPOSE_V}::${CADDY_V}::${OS_NAME}::${C_RUN}::${C_ALL}"',
    ].join('\n');

    try {
      const { stdout } = await this.execOnServer(server, probeScript, {
        timeoutMs: 12000,
      });
      const markerLine = stdout
        .split('\n')
        .find((l) => l.includes('PROBE_RESULT::'));
      if (!markerLine) {
        return { online: false, error: 'No se recibió respuesta de telemetría del nodo.' };
      }
      const parts = markerLine.split('PROBE_RESULT::')[1].split('::');
      const cpuCores = Math.max(1, Number(parts[0]) || 1);
      const load1 = Number(parts[1]) || 0;
      const cpuUsagePercent = Math.min(100, Math.round((load1 / cpuCores) * 100));
      const ramTotalMb = Number(parts[2]) || 0;
      const ramAvailableMb = Number(parts[3]) || 0;
      const ramUsedMb = Math.max(0, ramTotalMb - ramAvailableMb);
      const ramPercent =
        ramTotalMb > 0 ? Math.round((ramUsedMb / ramTotalMb) * 100) : 0;

      const [diskTotalStr, diskUsedStr, diskPctStr] = (parts[4] || '0|0|0').split('|');
      const metrics: ServerNodeMetrics = {
        cpuCores,
        cpuUsagePercent,
        ramTotalMb,
        ramUsedMb,
        ramAvailableMb,
        ramPercent,
        diskTotalGb: Number(diskTotalStr) || 0,
        diskUsedGb: Number(diskUsedStr) || 0,
        diskPercent: Number(diskPctStr) || 0,
        dockerVersion: (parts[5] || 'no-instalado').trim(),
        composeVersion: (parts[6] || 'no-instalado').trim(),
        caddyStatus: (parts[7] || 'no-instalado').trim() || 'no-instalado',
        osName: (parts[8] || 'Linux').trim(),
        containersRunning: Number(parts[9]) || 0,
        containersTotal: Number(parts[10]) || 0,
      };
      return { online: true, metrics };
    } catch (err: any) {
      return {
        online: false,
        error: err?.stderr?.trim() || err?.message || 'Error de conexión SSH con el servidor.',
      };
    }
  }

  async listContainersOnServer(
    server: StoredServerNode
  ): Promise<RemoteContainerItem[]> {
    const cmd = `docker ps -a --format '{{.ID}}||{{.Names}}||{{.Image}}||{{.State}}||{{.Status}}||{{.Ports}}||{{.Label "com.docker.compose.project"}}||{{.Label "com.docker.compose.service"}}||{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null || true`;
    const { stdout } = await this.execOnServer(server, cmd, { timeoutMs: 12000 });
    const items: RemoteContainerItem[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [
        id,
        name,
        image,
        state,
        status,
        ports,
        composeProject,
        composeService,
        workingDir,
      ] = trimmed.split('||');
      if (!name) continue;
      let internalPort = '3000';
      const arrowM = /->(\d+)/.exec(ports || '');
      const rawM = /(\d+)\/tcp/.exec(ports || '');
      if (arrowM) internalPort = arrowM[1];
      else if (rawM) internalPort = rawM[1];

      items.push({
        id: (id || '').slice(0, 12),
        name: name.trim(),
        image: (image || '').trim(),
        state: (state || 'unknown').trim(),
        status: (status || '').trim(),
        ports: (ports || '').trim(),
        internalPort,
        composeProject: (composeProject || '').trim(),
        composeService: (composeService || '').trim(),
        workingDir: (workingDir || '').trim(),
        serverId: server.id,
        serverName: server.name,
        serverHost: server.privateIp || server.host,
      });
    }
    return items;
  }

  async provisionServerNode(
    server: StoredServerNode
  ): Promise<{ success: boolean; output: string }> {
    if (server.isLocal) {
      return {
        success: true,
        output: '✅ El Nodo Central (Local) ya se encuentra aprovisionado con Docker y Caddy.',
      };
    }

    const safeRoot = (server.projectsRoot || '/opt/projects').replace(/[^a-zA-Z0-9/_-]/g, '');
    taskTelemetryService.emitTaskStep(
      `==> [1/3] Preparando directorio de proyectos ${safeRoot} en ${server.name}...`,
      `Preparando ${server.name}`
    );

    const script = [
      `mkdir -p "${safeRoot}" && chmod 755 "${safeRoot}"`,
      'if ! command -v docker >/dev/null 2>&1; then',
      '  echo "==> Instalando Docker Engine + Docker Compose plugin..."',
      '  curl -fsSL https://get.docker.com | sh',
      '  systemctl enable --now docker 2>/dev/null || true',
      'else',
      '  echo "✅ Docker ya instalado: $(docker --version)"',
      'fi',
      'docker network create alpanel_proxy_net 2>/dev/null || true',
      'echo "✅ Red alpanel_proxy_net verificada."',
    ].join('\n');

    try {
      const res = await this.execOnServer(server, script, { timeoutMs: 240000 });
      const output = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
      taskTelemetryService.emitTaskStep(
        `✅ Nodo ${server.name} aprovisionado y listo para recibir proyectos y contenedores.`,
        'Completado'
      );
      return { success: true, output: output || '✅ Aprovisionamiento completado.' };
    } catch (err: any) {
      return {
        success: false,
        output: err?.stderr || err?.message || 'Error aprovisionando el servidor remoto.',
      };
    }
  }

  async allowPortFromGateway(
    server: StoredServerNode,
    port: number,
    gatewaySourceIp: string
  ): Promise<{ success: boolean; output: string }> {
    if (server.isLocal || !port || !gatewaySourceIp) {
      return { success: true, output: 'No se requiere regla UFW para contenedor local.' };
    }
    const cleanIp = gatewaySourceIp.replace(/[^0-9a-fA-F.:/]/g, '');
    const cleanPort = Math.max(1, Math.min(65535, Math.floor(port)));
    const cmd = `if command -v ufw >/dev/null 2>&1; then ufw allow from ${cleanIp} to any port ${cleanPort} proto tcp >/dev/null 2>&1 && echo "✅ Regla UFW aplicada: solo ${cleanIp} puede acceder al puerto ${cleanPort}"; else echo "ℹ️ UFW no instalado en el nodo remoto (asegura acceso restringido por VPN/Firewall cloud)."; fi`;
    try {
      const { stdout } = await this.execOnServer(server, cmd, { timeoutMs: 12000 });
      return { success: true, output: stdout.trim() };
    } catch (err: any) {
      return { success: false, output: err?.message || 'Error aplicando regla firewall.' };
    }
  }
}

export const remoteExecutorService = new RemoteExecutorService();
