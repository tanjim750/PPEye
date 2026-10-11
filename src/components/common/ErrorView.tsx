import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { colors, spacing, typography } from '@/theme';

type ErrorViewProps = {
  message?: string;
  onRetry?: () => void;
};

export function ErrorView({ message = 'Something went wrong.', onRetry }: ErrorViewProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Unable to continue</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <Button onPress={onRetry}>Retry</Button> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
  },
});
