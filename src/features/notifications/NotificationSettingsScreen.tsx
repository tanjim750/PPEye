import { Text } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function NotificationSettingsScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Notifications</Text>
      <Text style={typography.body}>Manage push notification preferences.</Text>
    </Screen>
  );
}
