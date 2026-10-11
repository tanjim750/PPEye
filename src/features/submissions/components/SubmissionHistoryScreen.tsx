import { Text } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function SubmissionHistoryScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Submission history</Text>
      <Text style={typography.body}>Submitted PPE records will appear here.</Text>
    </Screen>
  );
}
