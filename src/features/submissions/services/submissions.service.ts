import { Submission } from '@/features/submissions/types';

export async function listSubmissions(): Promise<Submission[]> {
  return [];
}

export async function createSubmission(submission: Omit<Submission, 'createdAt' | 'id'>) {
  return {
    ...submission,
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
  };
}
