import { LoginCredentials } from '@/features/auth/types';
import { getCurrentSession, signInWithPassword, signOut } from '@/services/supabase/auth';
import { supabase } from '@/services/supabase/client';
import type { AuthUser } from '@/features/auth/types';
import { clearImageCache } from '@/utils/image';
import { signOutFromGoogle } from '@/services/google-drive/auth';

async function resolvePpeyeUser(email: string): Promise<AuthUser> {
  const { data: appUser, error: appUserError } = await supabase
    .from('users')
    .select('id, name, phone, email, category, external_type, designation, is_active')
    .ilike('email', email)
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
      // Automatic link: If user is external and vendor_members is not yet set up,
      // link them to the primary vendor_profiles row so they can log in seamlessly and vendor_members is populated.
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
    }
    if (memberships.length !== 1) {
      await signOut();
      throw new Error('This account belongs to multiple vendor profiles. Ask an administrator to resolve the membership.');
    }

    const membership = memberships[0] as any;
    vendorProfileId = membership.vendor_profile_id;
    vendorName = membership.vendor_profiles?.vendor_name;
    projectName = membership.vendor_profiles?.project_name;
  }

  const user: AuthUser = {
    id: appUser.id,
    email,
    name: appUser.name,
    phone: appUser.phone,
    category: appUser.category,
    externalType: appUser.external_type ?? undefined,
    designation: appUser.designation ?? undefined,
    vendorProfileId,
    vendorName,
    projectName,
    role: appUser.category === 'EXTERNAL' ? 'vendor' : 'reviewer',
  };

  return user;
}

export async function login(credentials: LoginCredentials) {
  const email = credentials.email.trim().toLowerCase();
  const { data: authData, error: authError } = await signInWithPassword({
    email,
    password: credentials.password,
  });

  if (authError) throw authError;
  if (!authData.user?.email) {
    await signOut();
    throw new Error('Supabase Auth did not return an email for this account.');
  }

  const user = await resolvePpeyeUser(authData.user.email);
  return { user, session: authData.session };
}

export async function restoreLoginSession() {
  const { data, error } = await getCurrentSession();
  if (error) throw error;
  const email = data.session?.user.email;
  if (!email) return null;

  const user = await resolvePpeyeUser(email);
  return { user, session: data.session };
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

