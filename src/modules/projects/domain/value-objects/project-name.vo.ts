import fs from 'fs';
import path from 'path';
import {
  InvalidProjectNameException,
  ProjectAccessDeniedException,
} from '../exceptions/project.exception';

export class ProjectNameVO {
  public readonly value: string;

  constructor(rawName: string) {
    const clean = (rawName || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!clean || clean !== rawName || clean === '.' || clean === '..') {
      throw new InvalidProjectNameException(rawName);
    }
    this.value = clean;
  }

  static isSelfPanel(name: string, panelSelfDir: string): boolean {
    const lower = (name || '').trim().toLowerCase();
    const selfBase = path.basename(panelSelfDir).toLowerCase();
    return lower === 'serverpanel' || lower === 'alpanel' || lower === selfBase;
  }

  resolvePath(projectsRoot: string, panelSelfDir: string): string {
    if (ProjectNameVO.isSelfPanel(this.value, panelSelfDir) && fs.existsSync(panelSelfDir)) {
      return path.resolve(panelSelfDir);
    }
    const rootResolved = path.resolve(projectsRoot);
    const resolved = path.resolve(rootResolved, this.value);
    const rel = path.relative(rootResolved, resolved);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ProjectAccessDeniedException();
    }
    return resolved;
  }
}
