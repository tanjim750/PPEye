import { listSubmissions } from '@/features/submissions/services/submissions.service';

export function useSubmissions() {
  return {
    listSubmissions,
  };
}
