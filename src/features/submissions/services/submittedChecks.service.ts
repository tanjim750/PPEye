import AsyncStorage from '@react-native-async-storage/async-storage';

export type SubmittedWorkerCheck = {
  id: string;
  submissionId: string;
  workerNumber: number;
  frontUri: string;
  backUri: string;
  otherPhotoUris: string[];
  site: string;
  submittedAt: string;
  status: 'waiting' | 'safe' | 'unsafe';
};

const storageKey = 'ppeye.submitted-worker-checks.v1';

export async function listSubmittedWorkerChecks(): Promise<SubmittedWorkerCheck[]> {
  const stored = await AsyncStorage.getItem(storageKey);
  if (!stored) return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as SubmittedWorkerCheck[]) : [];
  } catch {
    return [];
  }
}

export async function saveSubmittedWorkerChecks(checks: SubmittedWorkerCheck[]) {
  const existing = await listSubmittedWorkerChecks();
  await AsyncStorage.setItem(storageKey, JSON.stringify([...checks, ...existing]));
}

export async function getSubmittedWorkerCheck(id: string) {
  const checks = await listSubmittedWorkerChecks();
  return checks.find((check) => check.id === id) ?? null;
}
