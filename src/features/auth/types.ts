export type UserRole = 'external' | 'internal' | 'admin' | 'vendor' | 'reviewer';

export type AuthUser = {
  email: string;
  id: string;
  name?: string;
  role: UserRole;
};

export type LoginCredentials = {
  email: string;
  password: string;
};
