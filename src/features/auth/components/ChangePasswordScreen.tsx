import { Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function ChangePasswordScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Change password</Text>
      <Input label="Current password" secureTextEntry />
      <Input label="New password" secureTextEntry />
      <Button>Update password</Button>
    </Screen>
  );
}
