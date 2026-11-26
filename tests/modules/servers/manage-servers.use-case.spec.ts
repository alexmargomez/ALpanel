import fs from 'fs';
import os from 'os';
import path from 'path';
import { remoteExecutorService } from '../../../src/modules/servers/infrastructure/services/remote-executor.service';
import { ManageServersUseCase } from '../../../src/modules/servers/application/use-cases/manage-servers.use-case';

describe('Multi-Server Node Management & Secret Vault', () => {
  let tmpDataDir: string;
  const originalDataDir = process.env.PANEL_DATA_DIR;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-servers-test-'));
    process.env.PANEL_DATA_DIR = tmpDataDir;
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.PANEL_DATA_DIR;
    } else {
      process.env.PANEL_DATA_DIR = originalDataDir;
    }
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('encrypts and decrypts SSH secrets and Git PATs with AES-256-GCM', () => {
    const plain = 'ghp_superSecretToken_1234567890';
    const encrypted = remoteExecutorService.encryptSecret(plain);
    expect(encrypted.cipher).not.toEqual(plain);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.tag).toBeTruthy();
    expect(remoteExecutorService.decryptSecret(encrypted)).toBe(plain);
  });

  it('always includes the local central node and blocks deleting it', async () => {
    const useCase = new ManageServersUseCase();
    const servers = await useCase.listServers();
    expect(servers.length).toBeGreaterThanOrEqual(1);
    expect(servers[0].id).toBe('local');
    expect(servers[0].isLocal).toBe(true);

    await expect(useCase.deleteServer('local')).rejects.toThrow(/local|central/i);
  });

  it('creates, updates, sanitizes secrets, and deletes a remote server node', async () => {
    const useCase = new ManageServersUseCase();
    const created = await useCase.saveServer({
      name: 'VPS-Workers-01',
      host: '192.0.2.10',
      privateIp: '10.10.0.5',
      sshPort: 2222,
      sshUser: 'deploy',
      authType: 'password',
      secret: 'TopSecretPass!',
      projectsRoot: '/srv/apps',
      hasCaddy: true,
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe('VPS-Workers-01');
    expect(created.hasSecret).toBe(true);
    expect((created as any).encryptedSecret).toBeUndefined();

    const stored = await useCase.getStoredServerById(created.id);
    expect(stored).not.toBeNull();
    expect(remoteExecutorService.decryptSecret(stored!.encryptedSecret)).toBe(
      'TopSecretPass!'
    );

    const updated = await useCase.saveServer({
      id: created.id,
      name: 'VPS-Workers-01-Updated',
      host: '192.0.2.10',
      sshPort: 22,
    });
    expect(updated.name).toBe('VPS-Workers-01-Updated');
    expect(updated.sshPort).toBe(22);

    await useCase.deleteServer(created.id);
    const remaining = await useCase.listServers();
    expect(remaining.some((s) => s.id === created.id)).toBe(false);
  });

  it('stores, injects auth into HTTPS URLs, and deletes encrypted Git PAT credentials', async () => {
    const useCase = new ManageServersUseCase();
    const cred = await useCase.saveGitCredential({
      label: 'GitHub Corp',
      provider: 'github',
      username: 'bot-user',
      token: 'ghp_123456',
    });

    expect(cred.id).toBeTruthy();
    expect(cred.hasToken).toBe(true);
    expect((cred as any).encryptedToken).toBeUndefined();

    const authUrl = await useCase.injectGitAuthInUrl(
      'https://github.com/org/private-repo.git',
      cred.id
    );
    expect(authUrl).toBe(
      'https://bot-user:ghp_123456@github.com/org/private-repo.git'
    );

    await useCase.deleteGitCredential(cred.id);
    const list = await useCase.listGitCredentials();
    expect(list.some((c) => c.id === cred.id)).toBe(false);
  });
});
