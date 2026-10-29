import { supabase } from '@/services/supabase/client';

const AUTH_MIME_TYPE = 'application/x-ppeye-auth';

function encodePassword(pass: string): string {
  try {
    if (typeof btoa !== 'undefined') {
      return btoa(unescape(encodeURIComponent(pass)));
    }
  } catch {}
  return Buffer.from(pass, 'utf-8').toString('base64');
}

function decodePassword(encoded: string): string {
  try {
    if (typeof atob !== 'undefined') {
      return decodeURIComponent(escape(atob(encoded)));
    }
  } catch {}
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

function getFileName(email: string): string {
  return `auth_credential_${email.trim().toLowerCase()}`;
}

/**
 * Saves or updates an authentication credential in Supabase so it can be verified from any client (Web or Mobile).
 */
export async function saveUserCredential(
  email: string,
  password: string,
  userId?: number | string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const fileName = getFileName(normalizedEmail);
  const encoded = encodePassword(password.trim());
  const numericUserId = typeof userId === 'number' ? userId : Number(userId) || null;

  try {
    const { data: existing } = await supabase
      .from('files')
      .select('id')
      .eq('file_name', fileName)
      .eq('mime_type', AUTH_MIME_TYPE)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from('files')
        .update({
          provider_file_id: encoded,
          created_by: numericUserId,
        })
        .eq('id', existing.id);

      if (error) {
        console.warn('[CredentialSync] Failed to update credential:', error.message);
        return false;
      }
    } else {
      const { error } = await supabase.from('files').insert({
        file_name: fileName,
        provider_file_id: encoded,
        mime_type: AUTH_MIME_TYPE,
        storage_provider: 'SUPABASE',
        created_by: numericUserId,
      });

      if (error) {
        console.warn('[CredentialSync] Failed to insert credential:', error.message);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.warn('[CredentialSync] Exception in saveUserCredential:', err);
    return false;
  }
}

/**
 * Checks if a valid credential exists for the given email and matches the password.
 */
export async function verifyUserCredential(
  email: string,
  password: string
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  const fileName = getFileName(normalizedEmail);

  try {
    const { data, error } = await supabase
      .from('files')
      .select('provider_file_id')
      .eq('file_name', fileName)
      .eq('mime_type', AUTH_MIME_TYPE)
      .maybeSingle();

    if (error || !data?.provider_file_id) {
      return false;
    }

    const decoded = decodePassword(data.provider_file_id);
    return decoded === password.trim();
  } catch (err) {
    console.warn('[CredentialSync] Exception in verifyUserCredential:', err);
    return false;
  }
}

/**
 * Updates an existing credential password.
 */
export async function updateUserCredential(
  email: string,
  newPassword: string
): Promise<boolean> {
  return saveUserCredential(email, newPassword);
}
