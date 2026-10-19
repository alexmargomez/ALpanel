export interface UserEntity {
  id: number;
  username: string;
  fullName: string;
  role: string;
  roleId: number | null;
  roleName: string;
  lastLogin: string | null;
  createdAt: string;
}

export type UserDto = UserEntity;
