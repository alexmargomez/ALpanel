import { UserPermissionsMap } from '../permissions/permissions.model';

export interface AuthUserProfile {
  id: number;
  username: string;
  fullName: string;
  role: string;
  roleId: number | null;
  roleName: string;
  permissions: UserPermissionsMap;
}
