import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProjectNameVO } from '../../../src/modules/projects/domain/value-objects/project-name.vo';
import { InvalidProjectNameException } from '../../../src/modules/projects/domain/exceptions/project.exception';

describe('ProjectNameVO (Value Object de seguridad y rutas)', () => {
  it('acepta nombres válidos con letras, números, guiones, guiones bajos y puntos', () => {
    const vo1 = new ProjectNameVO('hc_version2');
    expect(vo1.value).toBe('hc_version2');

    const vo2 = new ProjectNameVO('api-sm.v1');
    expect(vo2.value).toBe('api-sm.v1');
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
      expect(() => new ProjectNameVO(input)).toThrow(InvalidProjectNameException);
    }
  });

  it('detecta correctamente si el proyecto corresponde al propio ALpanel (isSelfPanel)', () => {
    expect(ProjectNameVO.isSelfPanel('alpanel', '/opt/alpanel')).toBe(true);
    expect(ProjectNameVO.isSelfPanel('ALPANEL', '/opt/alpanel')).toBe(true);
    expect(ProjectNameVO.isSelfPanel('ServerPanel', '/opt/alpanel')).toBe(true);
    expect(
      ProjectNameVO.isSelfPanel('mi_panel_custom', '/opt/mi_panel_custom')
    ).toBe(true);
    expect(ProjectNameVO.isSelfPanel('hc_version2', '/opt/alpanel')).toBe(false);
  });

  it('resuelve rutas dentro de projectsRoot y redirige alpanel a panelSelfDir si existe', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'alpanel-vo-'));
    const projectsRoot = path.join(tmpBase, 'projects');
    const panelSelfDir = path.join(tmpBase, 'alpanel');
    fs.mkdirSync(projectsRoot, { recursive: true });
    fs.mkdirSync(panelSelfDir, { recursive: true });

    try {
      const normalProject = new ProjectNameVO('hc_version2');
      expect(normalProject.resolvePath(projectsRoot, panelSelfDir)).toBe(
        path.resolve(projectsRoot, 'hc_version2')
      );

      const selfProject = new ProjectNameVO('alpanel');
      expect(selfProject.resolvePath(projectsRoot, panelSelfDir)).toBe(
        path.resolve(panelSelfDir)
      );
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
