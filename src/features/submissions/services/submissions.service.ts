import { Submission, SubmissionStatus } from '@/features/submissions/types';
import { supabase } from '@/services/supabase/client';
import type { SubmissionStatus as DbSubmissionStatus } from '@/types/database.types';

export async function listSubmissions(): Promise<Submission[]> {
  try {
    const { data, error } = await supabase
      .from('ppe_submissions')
      .select('id, created_at, status, vendor_profile_id')
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map((item) => ({
      id: item.id.toString(),
      createdAt: item.created_at,
      status: (item.status ? item.status.toLowerCase() : 'submitted') as SubmissionStatus,
      vendorId: item.vendor_profile_id ? item.vendor_profile_id.toString() : undefined,
    }));
  } catch (err) {
    console.warn('[PPEye Service] listSubmissions error:', err);
    return [];
  }
}

export async function createSubmission(submission: Omit<Submission, 'createdAt' | 'id'>) {
  try {
    const statusMap: Record<string, DbSubmissionStatus> = {
      approved: 'COMPLETED',
      draft: 'DRAFT',
      in_review: 'UNDER_REVIEW',
      rejected: 'UNDER_REVIEW',
      submitted: 'SUBMITTED',
    };

    const dbStatus: DbSubmissionStatus = statusMap[submission.status] ?? 'SUBMITTED';
    let vendorProfileId = submission.vendorId ? parseInt(submission.vendorId, 10) : null;
    let submittedBy: number | null = null;

    if (!vendorProfileId) {
      const { data: firstVendor } = await supabase.from('vendor_profiles').select('id').limit(1).maybeSingle();
      if (firstVendor) vendorProfileId = firstVendor.id;
    }

    const { data: firstUser } = await supabase.from('users').select('id').limit(1).maybeSingle();
    if (firstUser) submittedBy = firstUser.id;

    if (!vendorProfileId || !submittedBy) {
      return {
        ...submission,
        createdAt: new Date().toISOString(),
        id: crypto.randomUUID(),
      };
    }

    const { data, error } = await supabase
      .from('ppe_submissions')
      .insert({
        vendor_profile_id: vendorProfileId,
        submitted_by: submittedBy,
        site_name: 'Site-01',
        status: dbStatus,
        metadata: {},
      })
      .select()
      .single();

    if (!error && data) {
      return {
        ...submission,
        id: data.id.toString(),
        createdAt: data.created_at,
      };
    }
  } catch (err) {
    console.warn('[PPEye Service] createSubmission error, falling back:', err);
  }

  return {
    ...submission,
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
  };
}
