import { ExternalUserType } from '@/types/database.types';

export interface VendorPermissions {
  /** Can view all submissions belonging to their vendor organization */
  canViewVendorSubmissions: boolean;
  /** Can initiate and submit PPE evidence */
  canCreateSubmission: boolean;
  /** Can save and edit drafts */
  canSaveDraft: boolean;
  /** Can delete unsubmitted draft submissions */
  canDeleteDraft: boolean;
  /** Can view review status, verdicts, and detailed violation feedback */
  canViewFeedback: boolean;
  /** Can resubmit corrected PPE evidence for workers marked Unsafe */
  canResubmitUnsafe: boolean;
  /** Can add or manage vendor team members */
  canManageTeamMembers: boolean;
  /** Can view their own profile */
  canViewProfile: boolean;
  /** Can update their own profile and profile picture */
  canEditProfile: boolean;
}

/**
 * Returns strongly-typed vendor permissions based on external_type.
 * Enforces role boundaries between Project Manager, Team Leader, and Worker.
 */
export function getVendorPermissions(externalType?: ExternalUserType | null): VendorPermissions {
  switch (externalType) {
    case 'PROJECT_MANAGER':
      return {
        canViewVendorSubmissions: true,
        canCreateSubmission: true,
        canSaveDraft: true,
        canDeleteDraft: true,
        canViewFeedback: true,
        canResubmitUnsafe: true,
        canManageTeamMembers: true,
        canViewProfile: true,
        canEditProfile: true,
      };

    case 'TEAM_LEADER':
      return {
        canViewVendorSubmissions: true,
        canCreateSubmission: true,
        canSaveDraft: true,
        canDeleteDraft: true,
        canViewFeedback: true,
        canResubmitUnsafe: true,
        canManageTeamMembers: false, // Team Leaders focus on field submissions
        canViewProfile: true,
        canEditProfile: true,
      };

    case 'WORKER':
      return {
        canViewVendorSubmissions: false, // Workers do not get blanket vendor submission access
        canCreateSubmission: false, // Only team leads / PMs create submissions
        canSaveDraft: false,
        canDeleteDraft: false,
        canViewFeedback: false,
        canResubmitUnsafe: false,
        canManageTeamMembers: false,
        canViewProfile: true,
        canEditProfile: true,
      };

    default:
      // Default fallback for external users without explicit type
      return {
        canViewVendorSubmissions: true,
        canCreateSubmission: true,
        canSaveDraft: true,
        canDeleteDraft: true,
        canViewFeedback: true,
        canResubmitUnsafe: true,
        canManageTeamMembers: false,
        canViewProfile: true,
        canEditProfile: true,
      };
  }
}
