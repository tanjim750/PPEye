import { Text } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function ReviewQueueScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Review queue</Text>
      <Text style={typography.body}>Pending submissions will appear here.</Text>
    </Screen>
  );
}
