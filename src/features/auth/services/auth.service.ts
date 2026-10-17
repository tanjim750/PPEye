import { LoginCredentials } from '@/features/auth/types';
import { signInWithPassword, signOut } from '@/services/supabase/auth';
import { clearImageCache } from '@/utils/image';
import { signOutFromGoogle } from '@/services/google-drive/auth';

export async function login(credentials: LoginCredentials) {
  return signInWithPassword(credentials);
}

export async function logout() {
  try {
    await clearImageCache({ onlySensitive: true });
  } catch (err) {
    console.warn('[AuthService] Error clearing sensitive image cache on logout:', err);
  }

  try {
    await signOutFromGoogle(false);
  } catch (err) {
    console.warn('[AuthService] Error signing out of Google Drive on logout:', err);
  }

  return signOut();
}

