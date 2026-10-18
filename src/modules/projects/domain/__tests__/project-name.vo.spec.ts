import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProjectNameVO } from '../value-objects/project-name.vo';
import { InvalidProjectNameException } from '../exceptions/project.exception';

describe('ProjectNameVO (Value Object de seguridad y rutas)', () => {
  it('acepta nombres válidos con letras, números, guiones, guiones bajos y puntos', () => {
    const vo1 = new ProjectNameVO('hc_version2');
    assert.equal(vo1.value, 'hc_version2');

    const vo2 = new ProjectNameVO('api-sm.v1');
    assert.equal(vo2.value, 'api-sm.v1');
  });

  it('bloquea intentos de Path Traversal, espacios e inyección de comandos', () => {
    const maliciousInputs = [
      '',
      '../etc/passwd',
      '../../root',
      'proyecto con espacios',
      'proj;rm -rf /',
      'proj$(whoami)',
      'carpeta/subcarpeta',
    ];

    for (const input of maliciousInputs) {
      assert.throws(
        () => new ProjectNameVO(input),
        (err: unknown) =>
          err instanceof InvalidProjectNameException && err.statusCode === 400,
        `Debió rechazar el nombre inseguro: "${input}"`
      );
    }
  });

  it('detecta correctamente si el proyecto corresponde al propio ALpanel (isSelfPanel)', () => {
    assert.equal(ProjectNameVO.isSelfPanel('alpanel', '/opt/alpanel'), true);
    assert.equal(ProjectNameVO.isSelfPanel('ALPANEL', '/opt/alpanel'), true);
    assert.equal(ProjectNameVO.isSelfPanel('ServerPanel', '/opt/alpanel'), true);
    assert.equal(
      ProjectNameVO.isSelfPanel('mi_panel_custom', '/opt/mi_panel_custom'),
      true
    );
    assert.equal(
      ProjectNameVO.isSelfPanel('hc_version2', '/opt/alpanel'),
      false
    );
  });

  it('resuelve rutas dentro de projectsRoot y redirige alpanel a panelSelfDir si existe', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-vo-'));
    const projectsRoot = path.join(tmpBase, 'projects');
    const panelSelfDir = path.join(tmpBase, 'alpanel');
    fs.mkdirSync(projectsRoot, { recursive: true });
    fs.mkdirSync(panelSelfDir, { recursive: true });

    try {
      const normalProject = new ProjectNameVO('hc_version2');
      assert.equal(
        normalProject.resolvePath(projectsRoot, panelSelfDir),
        path.resolve(projectsRoot, 'hc_version2')
      );

      const selfProject = new ProjectNameVO('alpanel');
      assert.equal(
        selfProject.resolvePath(projectsRoot, panelSelfDir),
        path.resolve(panelSelfDir)
      );
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
