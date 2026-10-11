import { Href, Link } from 'expo-router';
import { Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function SettingsScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Settings</Text>
      <Link href={'/settings/profile' as Href} asChild>
        <Button variant="secondary">Profile</Button>
      </Link>
      <Link href={'/settings/language' as Href} asChild>
        <Button variant="secondary">Language</Button>
      </Link>
      <Link href={'/settings/notifications' as Href} asChild>
        <Button variant="secondary">Notifications</Button>
      </Link>
    </Screen>
  );
}
