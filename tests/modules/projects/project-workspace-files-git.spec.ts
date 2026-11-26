import fs from 'fs';
import os from 'os';
import path from 'path';
import { ManageProjectFilesUseCase } from '../../../src/modules/projects/application/use-cases/manage-project-files.use-case';
import { ManageProjectWorkspaceUseCase } from '../../../src/modules/projects/application/use-cases/manage-project-workspace.use-case';

describe('Project Workspace Isolation & File Explorer Use Cases', () => {
  let tmpProjectsRoot: string;

  beforeEach(() => {
    tmpProjectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-proj-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpProjectsRoot, { recursive: true, force: true });
  });

  it('creates an empty isolated project workspace with manifest and compose file', async () => {
    const workspaceUseCase = new ManageProjectWorkspaceUseCase(tmpProjectsRoot);
    const res = await workspaceUseCase.createEmptyWorkspace({
      projectName: 'ProvekoSaaS',
      serverId: 'local',
      description: 'Cluster multi-tenant aislado',
    });

    expect(res.success).toBe(true);
    expect(res.manifest.projectName).toBe('ProvekoSaaS');
    expect(res.manifest.isolatedNetwork).toBe('alpanel_isolated_provekosaas_net');

    const manifestPath = path.join(
      tmpProjectsRoot,
      'ProvekoSaaS',
      '.alpanel-project.json'
    );
    const composePath = path.join(
      tmpProjectsRoot,
      'ProvekoSaaS',
      'docker-compose.yml'
    );
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(composePath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.serverId).toBe('local');
    expect(manifest.isolatedNetwork).toBe('alpanel_isolated_provekosaas_net');
  });

  it('lists, creates, edits with .bak backup, restores, and blocks path traversal', async () => {
    const projDir = path.join(tmpProjectsRoot, 'DemoApp');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(projDir, 'router.go'),
      'package main\n// v1\n',
      'utf8'
    );

    const filesUseCase = new ManageProjectFilesUseCase(tmpProjectsRoot);

    const tree = filesUseCase.listDirectory('DemoApp', '');
    expect(tree.entries.some((e) => e.name === 'router.go')).toBe(true);

    // Block path traversal outside project root
    expect(() => filesUseCase.readFile('DemoApp', '../../etc/passwd')).toThrow(
      /bloqueado|fuera|ruta/i
    );

    // Save updated file and verify automatic .bak creation
    const saved = await filesUseCase.writeFile(
      'DemoApp',
      'router.go',
      'package main\n// v2 updated\n'
    );
    expect(saved.success).toBe(true);
    expect(saved.hasBackup).toBe(true);

    const readV2 = filesUseCase.readFile('DemoApp', 'router.go');
    expect(readV2.content).toContain('// v2 updated');

    // Restore backup back to v1
    filesUseCase.restoreBackup('DemoApp', 'router.go');
    const readRestored = filesUseCase.readFile('DemoApp', 'router.go');
    expect(readRestored.content).toContain('// v1');
  });
});
