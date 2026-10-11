import { Text } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function ForgotPasswordScreen() {
  return (
    <Screen>
      <Text style={typography.title}>Forgot password</Text>
      <Text style={typography.body}>Enter your email to receive reset instructions.</Text>
      <Input autoCapitalize="none" keyboardType="email-address" label="Email" />
      <Button>Send reset link</Button>
    </Screen>
  );
}
