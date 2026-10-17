import { StorageError, StorageErrorCode } from '@/services/storage/storage.errors';
import type { ExternalUserType } from '@/types/database.types';

let supabaseOverride: any = null;

export function setVendorTeamSupabaseOverride(client: any): void {
  supabaseOverride = client;
}

function getDb(): any {
  if (supabaseOverride) {
    return supabaseOverride;
  }
  return require('@/services/supabase/client').supabase;
}

export interface VendorTeamMemberItem {
  id: number;
  userId: number;
  name: string;
  phone: string;
  email: string | null;
  designation: string | null;
  externalType: ExternalUserType | null;
  isActive: boolean;
  joinedAt: string;
}

export interface AddTeamMemberInput {
  name: string;
  phone: string;
  email?: string;
  designation?: string;
  externalType: 'TEAM_LEADER' | 'WORKER';
}

/**
 * Fetch all members of a specific vendor profile.
 */
export async function getVendorTeamMembers(
  vendorProfileId: number = 1
): Promise<VendorTeamMemberItem[]> {
  try {
    const { data, error } = await getDb()
      .from('vendor_members')
      .select(`
        id,
        created_at,
        users (
          id,
          name,
          phone,
          email,
          designation,
          external_type,
          is_active
        )
      `)
      .eq('vendor_profile_id', vendorProfileId)
      .order('created_at', { ascending: true });

    if (error || !data) {
      console.warn('[VendorTeam] Error fetching team members:', error?.message);
      return [];
    }

    return data
      .filter((row: any) => row.users !== null)
      .map((row: any) => ({
        id: row.id,
        userId: row.users.id,
        name: row.users.name,
        phone: row.users.phone,
        email: row.users.email,
        designation: row.users.designation,
        externalType: row.users.external_type,
        isActive: row.users.is_active,
        joinedAt: row.created_at,
      }));
  } catch (err) {
    console.warn('[VendorTeam] Exception in getVendorTeamMembers:', err);
    return [];
  }
}

/**
 * Adds a new team member to the vendor organization.
 * Security guards:
 * - Only external roles (TEAM_LEADER or WORKER) can be created by vendor managers.
 * - Validates phone uniqueness and required fields.
 * - Prevents creating INTERNAL users (EHS Reviewers / Admins).
 */
export async function addVendorTeamMember(
  vendorProfileId: number,
  memberData: AddTeamMemberInput
): Promise<{ success: boolean; memberId?: number; error?: string }> {
  try {
    // 1. Validation
    if (!memberData.name || !memberData.name.trim()) {
      throw new StorageError(StorageErrorCode.INVALID_INPUT, 'Name is required.');
    }
    if (!memberData.phone || !memberData.phone.trim()) {
      throw new StorageError(StorageErrorCode.INVALID_INPUT, 'Phone number is required.');
    }
    if (memberData.externalType !== 'TEAM_LEADER' && memberData.externalType !== 'WORKER') {
      throw new StorageError(
        StorageErrorCode.PERMISSION_DENIED,
        'Vendor managers can only register Team Leaders or Workers.'
      );
    }

    const cleanPhone = memberData.phone.trim();

    // 2. Check phone uniqueness & category safety
    const { data: existingUser } = await getDb()
      .from('users')
      .select('id, category')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (existingUser && existingUser.category === 'INTERNAL') {
      throw new StorageError(
        StorageErrorCode.PERMISSION_DENIED,
        'Internal staff (EHS Reviewers / Admins) cannot be added to vendor teams.'
      );
    }

    let userId: number;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create new external user
      const { data: newUser, error: createError } = await getDb()
        .from('users')
        .insert({
          name: memberData.name.trim(),
          phone: cleanPhone,
          email: memberData.email?.trim() || null,
          category: 'EXTERNAL',
          designation: memberData.designation?.trim() || null,
          external_type: memberData.externalType,
          is_active: true,
        })
        .select('id')
        .single();

      if (createError || !newUser) {
        throw new Error(createError?.message ?? 'Failed to register team member.');
      }
      userId = newUser.id;
    }

    // 3. Link to vendor_members
    const { data: link, error: linkError } = await getDb()
      .from('vendor_members')
      .insert({
        vendor_profile_id: vendorProfileId,
        user_id: userId,
      })
      .select('id')
      .single();

    if (linkError) {
      if (linkError.code === '23505') {
        throw new StorageError(
          StorageErrorCode.INVALID_INPUT,
          'User is already a member of this vendor team.'
        );
      }
      throw new Error(linkError.message);
    }

    return { success: true, memberId: link?.id };
  } catch (err: any) {
    console.warn('[VendorTeam] Error adding team member:', err);
    return { success: false, error: err?.message ?? 'Failed to add team member' };
  }
}

/**
 * Removes a member from the vendor organization.
 */
export async function removeVendorTeamMember(
  vendorProfileId: number,
  memberUserId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await getDb()
      .from('vendor_members')
      .delete()
      .eq('vendor_profile_id', vendorProfileId)
      .eq('user_id', memberUserId);

    if (error) {
      throw new Error(error.message);
    }

    return { success: true };
  } catch (err: any) {
    console.warn(`[VendorTeam] Error removing user ${memberUserId}:`, err);
    return { success: false, error: err?.message ?? 'Failed to remove team member' };
  }
}
