import { Text } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function ProfileScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Profile</Text>
      <Text style={typography.body}>User profile details will appear here.</Text>
    </Screen>
  );
}
