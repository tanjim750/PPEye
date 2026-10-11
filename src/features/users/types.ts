import { UserRole } from '@/features/auth/types';

export type AppUser = {
  email: string;
  id: string;
  name: string;
  role: UserRole;
};
