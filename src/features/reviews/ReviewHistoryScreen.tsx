import { Text } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function ReviewHistoryScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Review history</Text>
      <Text style={typography.body}>Completed reviews will appear here.</Text>
    </Screen>
  );
}
