import type { ExternalUserType, UserCategory } from '@/types/database.types';

export type DummyUserRole = 'vendor' | 'reviewer';

export type DummyUser = {
  username: string;
  password: string;
  role: DummyUserRole;
  name: string;
  category: UserCategory;
  externalType?: ExternalUserType;
  designation?: string;
  vendorProfileId?: number;
  vendorName?: string;
  projectName?: string;
  phone?: string;
};

// Static users for development and testing. Passwords are intentionally not hashed.
export const dummyUsers: DummyUser[] = [
  {
    username: 'pm',
    password: 'pm123',
    role: 'vendor',
    name: 'Tariq Ahmed',
    category: 'EXTERNAL',
    externalType: 'PROJECT_MANAGER',
    designation: 'Vendor Project Manager',
    vendorProfileId: 1,
    vendorName: 'ABC Telecom Ltd',
    projectName: 'Metro Fiber Expansion',
    phone: '+8801711000001',
  },
  {
    username: 'vendor', // Default Team Leader
    password: 'vendor123',
    role: 'vendor',
    name: 'Rahim Khan',
    category: 'EXTERNAL',
    externalType: 'TEAM_LEADER',
    designation: 'Site Team Leader',
    vendorProfileId: 1,
    vendorName: 'ABC Telecom Ltd',
    projectName: 'Metro Fiber Expansion',
    phone: '+8801712000002',
  },
  {
    username: 'worker',
    password: 'worker123',
    role: 'vendor',
    name: 'Karim Ullah',
    category: 'EXTERNAL',
    externalType: 'WORKER',
    designation: 'Rigger / Field Worker',
    vendorProfileId: 1,
    vendorName: 'ABC Telecom Ltd',
    projectName: 'Metro Fiber Expansion',
    phone: '+8801713000003',
  },
  {
    username: 'reviewer',
    password: 'reviewer123',
    role: 'reviewer',
    name: 'Mahmud Hasan',
    category: 'INTERNAL',
    designation: 'Lead EHS Safety Officer',
    phone: '+8801714000004',
  },
];

