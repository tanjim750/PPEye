import { LoginCredentials } from '@/features/auth/types';
import { getCurrentSession, signInWithPassword, signOut } from '@/services/supabase/auth';
import { setPendingAuthEmail, supabase } from '@/services/supabase/client';
import type { AuthUser } from '@/features/auth/types';
import { clearImageCache } from '@/utils/image';
import { signOutFromGoogle } from '@/services/google-drive/auth';
import { saveUserCredential, verifyUserCredential } from '@/services/auth/credentialSync.service';

async function resolveAvatarSignedUrl(providerFileId?: string | null): Promise<string | undefined> {
  if (!providerFileId) return undefined;
  try {
    const { supabaseStorageService } = require('@/services/storage/supabase-storage.client');
    const signed = await supabaseStorageService.createSignedUrl('avatars', providerFileId, 86400 * 7);
    const signedUrl = typeof signed === 'string' ? signed : signed?.signedUrl;
    if (signedUrl && typeof signedUrl === 'string' && signedUrl.startsWith('http')) {
      return signedUrl;
    }
  } catch (e) {
    console.warn('[auth.service] Error resolving avatar signed URL:', e);
  }
  return undefined;
}

async function resolvePpeyeUser(email: string): Promise<AuthUser> {
  const normalizedEmail = email.trim().toLowerCase();
  setPendingAuthEmail(normalizedEmail);
  try {
    // 1. Prefer SECURITY DEFINER RPC when available (handles both Supabase Auth JWT and credentialSync sessions)
    const { data: rpcProfile, error: rpcError } = await (supabase.rpc as any)(
      'resolve_ppeye_user_profile',
      { p_email: normalizedEmail }
    );

    if (!rpcError && rpcProfile && typeof rpcProfile === 'object') {
      if (!rpcProfile.is_active) {
        await signOut();
        throw new Error('This Supabase account is not linked to an active PPEye user.');
      }
      if (rpcProfile.category !== 'INTERNAL' && rpcProfile.category !== 'EXTERNAL') {
        await signOut();
        throw new Error('This PPEye account has an unsupported category.');
      }
      if (rpcProfile.category === 'EXTERNAL') {
        if (Number(rpcProfile.membership_count) > 1) {
          await signOut();
          throw new Error('This account belongs to multiple vendor profiles. Ask an administrator to resolve the membership.');
        }
        if (!rpcProfile.vendor_profile_id) {
          await signOut();
          throw new Error('This external account is not linked to a vendor profile.');
        }
      }

      const profilePictureUrl = await resolveAvatarSignedUrl(rpcProfile.avatar_provider_file_id);
      return {
        id: Number(rpcProfile.id),
        email: rpcProfile.email || normalizedEmail,
        name: rpcProfile.name,
        phone: rpcProfile.phone,
        category: rpcProfile.category,
        externalType: rpcProfile.external_type ?? undefined,
        designation: rpcProfile.designation ?? undefined,
        vendorProfileId: rpcProfile.vendor_profile_id ? Number(rpcProfile.vendor_profile_id) : undefined,
        vendorName: rpcProfile.vendor_name ?? undefined,
        projectName: rpcProfile.project_name ?? undefined,
        role: rpcProfile.category === 'EXTERNAL' ? 'vendor' : 'reviewer',
        profilePictureUrl,
      };
    }

    // 2. Standard table resolution (carries x-client-info ppeye_email for RLS current_app_user_id())
    const { data: appUser, error: appUserError } = await supabase
      .from('users')
      .select('id, name, phone, email, category, external_type, designation, is_active, profile_picture_file_id')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (appUserError) {
      await signOut();
      throw new Error(`Could not load the PPEye user profile: ${appUserError.message}`);
    }
    if (!appUser || !appUser.is_active) {
      await signOut();
      throw new Error('This Supabase account is not linked to an active PPEye user.');
    }
    if (appUser.category !== 'INTERNAL' && appUser.category !== 'EXTERNAL') {
      await signOut();
      throw new Error('This PPEye account has an unsupported category.');
    }

    let vendorProfileId: number | undefined;
    let vendorName: string | undefined;
    let projectName: string | undefined;

    if (appUser.category === 'EXTERNAL') {
      const { data: memberships, error: membershipError } = await supabase
        .from('vendor_members')
        .select('vendor_profile_id, vendor_profiles ( vendor_name, project_name )')
        .eq('user_id', appUser.id);

      if (membershipError) {
        await signOut();
        throw new Error(`Could not resolve this vendor account: ${membershipError.message}`);
      }
      if (!memberships?.length) {
        const { data: defaultVendor } = await supabase
          .from('vendor_profiles')
          .select('id, vendor_name, project_name')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (defaultVendor) {
          await supabase.from('vendor_members').insert({
            vendor_profile_id: defaultVendor.id,
            user_id: appUser.id,
          });
          vendorProfileId = defaultVendor.id;
          vendorName = defaultVendor.vendor_name;
          projectName = defaultVendor.project_name;
        } else {
          await signOut();
          throw new Error('This external account is not linked to a vendor profile.');
        }
      } else if (memberships.length > 1) {
        await signOut();
        throw new Error('This account belongs to multiple vendor profiles. Ask an administrator to resolve the membership.');
      } else {
        const membership = memberships[0] as any;
        vendorProfileId = membership.vendor_profile_id;
        vendorName = membership.vendor_profiles?.vendor_name;
        projectName = membership.vendor_profiles?.project_name;
      }
    }

    let profilePictureUrl: string | undefined;
    if (appUser.profile_picture_file_id) {
      try {
        const { data: fRow } = await supabase
          .from('files')
          .select('provider_file_id, storage_provider')
          .eq('id', appUser.profile_picture_file_id)
          .maybeSingle();
        profilePictureUrl = await resolveAvatarSignedUrl(fRow?.provider_file_id);
      } catch (e) {
        console.warn('[auth.service] Error resolving avatar signed URL:', e);
      }
    }

    return {
      id: Number(appUser.id),
      email: appUser.email || normalizedEmail,
      name: appUser.name,
      phone: appUser.phone,
      category: appUser.category,
      externalType: appUser.external_type ?? undefined,
      designation: appUser.designation ?? undefined,
      vendorProfileId,
      vendorName,
      projectName,
      role: appUser.category === 'EXTERNAL' ? 'vendor' : 'reviewer',
      profilePictureUrl,
    };
  } finally {
    setPendingAuthEmail(null);
  }
}

export async function login(credentials: LoginCredentials) {
  const email = credentials.email.trim().toLowerCase();
  const cleanPassword = credentials.password.trim();

  // 1. Attempt standard Supabase Auth first so session.user (auth.uid()) is active for RLS
  const { data: authData, error: authError } = await signInWithPassword({
    email,
    password: cleanPassword,
  });

  if (!authError && authData.user?.email) {
    const user = await resolvePpeyeUser(authData.user.email);
    saveUserCredential(email, cleanPassword, user.id).catch(() => {});
    return { user, session: authData.session };
  }

  // 2. Fallback to credential store when password was updated or pending Auth sync
  const isCredentialValid = await verifyUserCredential(email, cleanPassword);
  if (isCredentialValid) {
    // Ensure previous account's Supabase Auth JWT cannot linger across account switches
    await signOut().catch(() => {});
    const user = await resolvePpeyeUser(email);
    return { user, session: null };
  }

  if (authError) throw authError;
  throw new Error('Invalid login credentials.');
}

export async function restoreLoginSession() {
  const { data, error } = await getCurrentSession();
  if (error) throw error;
  const email = data.session?.user?.email;
  if (!data.session?.user?.id || !email) return null;

  const user = await resolvePpeyeUser(email);
  return { user, session: data.session };
}

import { authStore, clearAuthSession } from '@/stores/auth.store';
import { invalidateVendorSubmissionDetailsCache } from '@/services/vendor/vendorSubmissions.service';
import { unlinkPushTokenForUser } from '@/services/notifications/pushNotification.service';

export async function logout() {
  const departingUserId = authStore.user?.id;
  try {
    await unlinkPushTokenForUser(departingUserId);
  } catch (err) {
    console.warn('[AuthService] Error unlinking push token on logout:', err);
  }
  clearAuthSession();
  invalidateVendorSubmissionDetailsCache();
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

