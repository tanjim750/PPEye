import { Text } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function HelpScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Help</Text>
      <Text style={typography.body}>Support and FAQ content will appear here.</Text>
    </Screen>
  );
}
