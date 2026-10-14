import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';
import { markWorkerSafe } from '@/features/submissions/services/workerChecks.service';

export function ReviewDetailScreen() {
  const router = useRouter();
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();

  function handleApprove() {
    // Marks the worker as safe
    markWorkerSafe(submissionId || 'w131');
    Alert.alert('Approved', 'Submission marked as Safe!', [
      {
        text: 'OK',
        onPress: () => router.back(),
      },
    ]);
  }

  return (
    <Screen>
      <Text style={typography.title}>Submission {submissionId}</Text>
      <Text style={typography.body}>Review evidence, notes, and vendor details.</Text>
      <View style={styles.actions}>
        <Button onPress={handleApprove}>Approve as Safe</Button>
        <Button onPress={() => router.back()} variant="secondary">Reject</Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: 12,
    marginTop: 20,
  },
});

export default ReviewDetailScreen;
