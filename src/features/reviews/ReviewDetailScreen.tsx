import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function ReviewDetailScreen() {
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();

  return (
    <Screen>
      <Text style={typography.title}>Submission {submissionId}</Text>
      <Text style={typography.body}>Review evidence, notes, and vendor details.</Text>
      <Button>Approve</Button>
      <Button variant="secondary">Reject</Button>
    </Screen>
  );
}
