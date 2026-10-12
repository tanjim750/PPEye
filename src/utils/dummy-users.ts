export type DummyUserRole = 'vendor' | 'reviewer';

export type DummyUser = {
  username: string;
  password: string;
  role: DummyUserRole;
};

// Static users for development only. Passwords are intentionally not hashed.
export const dummyUsers: DummyUser[] = [
  { username: 'vendor', password: 'vendor123', role: 'vendor' },
  { username: 'reviewer', password: 'reviewer123', role: 'reviewer' },
];
