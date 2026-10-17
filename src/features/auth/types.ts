import type { ExternalUserType, UserCategory } from '@/types/database.types';

export type UserRole = 'external' | 'internal' | 'admin' | 'vendor' | 'reviewer';

export type AuthUser = {
  email: string;
  id: string | number;
  name?: string;
  role: UserRole;
  category?: UserCategory;
  externalType?: ExternalUserType;
  vendorProfileId?: number;
  vendorName?: string;
  projectName?: string;
  designation?: string;
  phone?: string;
};

export type LoginCredentials = {
  email: string;
  password: string;
};

