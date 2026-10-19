import { UserPermissionsMap } from '../../../permissions/domain/entities/permission.entity';

export interface AuthUserProfile {
  id: number;
  username: string;
  fullName: string;
  role: string;
  roleId: number | null;
  roleName: string;
  permissions: UserPermissionsMap;
}
