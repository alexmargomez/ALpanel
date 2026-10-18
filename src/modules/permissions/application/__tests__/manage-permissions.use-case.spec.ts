import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionRepositoryPort } from '../ports/repositories/permission-repository.port';
import { ManagePermissionsUseCase } from '../use-cases/manage-permissions.use-case';
import {
  ModuleDto,
  RolePermissionItemDto,
  UserPermissionsMap,
} from '../../domain/entities/permission.entity';

class InMemoryPermissionRepositoryMock implements PermissionRepositoryPort {
  private permissionsByRole = new Map<number, RolePermissionItemDto[]>();

  async listModules(): Promise<ModuleDto[]> {
    return [
      {
        id: 1,
        code: 'projects',
        name: 'Proyectos y Contenedores',
        description: 'Gestión de contenedores Docker y despliegues Git',
        icon: 'boxes',
        sortOrder: 1,
      },
    ];
  }

  async getRolePermissions(roleId: number): Promise<RolePermissionItemDto[]> {
    return this.permissionsByRole.get(roleId) || [];
  }

  async getPermissionsMapForRole(): Promise<UserPermissionsMap> {
    return {};
  }

  async updateRolePermissions(
    roleId: number,
    items: Array<{
      moduleCode: string;
      canView?: boolean;
      canCreate?: boolean;
      canEdit?: boolean;
      canDelete?: boolean;
      canDeploy?: boolean;
    }>
  ): Promise<RolePermissionItemDto[]> {
    const mapped: RolePermissionItemDto[] = items.map((item, idx) => ({
      moduleId: idx + 1,
      moduleCode: item.moduleCode,
      moduleName: item.moduleCode,
      moduleDescription: '',
      moduleIcon: 'box',
      canView: Boolean(item.canView),
      canCreate: Boolean(item.canCreate),
      canEdit: Boolean(item.canEdit),
      canDelete: Boolean(item.canDelete),
      canDeploy: Boolean(item.canDeploy),
    }));
    this.permissionsByRole.set(roleId, mapped);
    return mapped;
  }

  async checkUserPermission(
    userId: number,
    moduleCode: string,
    actionOrService = 'view'
  ): Promise<boolean> {
    const perms = this.permissionsByRole.get(userId) || [];
    const found = perms.find((p) => p.moduleCode === moduleCode);
    if (!found) return false;
    if (actionOrService === 'view') return found.canView;
    if (actionOrService === 'deploy') return found.canDeploy;
    return false;
  }
}

describe('Permissions Module — ManagePermissionsUseCase', () => {
  it('lista módulos, actualiza matriz RBAC por rol y evalúa permisos granulares', async () => {
    const repo = new InMemoryPermissionRepositoryMock();
    const useCase = new ManagePermissionsUseCase(repo);

    const modules = await useCase.listModules();
    assert.equal(modules.length, 1);
    assert.equal(modules[0].code, 'projects');

    await useCase.updateRolePermissions(5, [
      {
        moduleCode: 'projects',
        canView: true,
        canDeploy: true,
        canDelete: false,
      },
    ]);

    const saved = await useCase.getRolePermissions(5);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].canDeploy, true);
    assert.equal(saved[0].canDelete, false);

    assert.equal(await useCase.checkUserPermission(5, 'projects', 'view'), true);
    assert.equal(
      await useCase.checkUserPermission(5, 'projects', 'deploy'),
      true
    );
    assert.equal(
      await useCase.checkUserPermission(5, 'security', 'view'),
      false
    );
  });
});
