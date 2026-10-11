import { PropsWithChildren } from 'react';
import { Pressable, PressableProps, PressableStateCallbackType, StyleSheet, Text } from 'react-native';

import { colors, spacing, typography } from '@/theme';

type ButtonProps = PropsWithChildren<
  PressableProps & {
    variant?: 'primary' | 'secondary' | 'ghost';
  }
>;

export function Button({ children, style, variant = 'primary', ...props }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      style={(state: PressableStateCallbackType) => [
        styles.base,
        styles[variant],
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}>
      <Text style={[styles.label, variant === 'primary' ? styles.primaryLabel : styles.darkLabel]}>
        {children}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  pressed: {
    opacity: 0.72,
  },
  label: {
    ...typography.button,
  },
  primaryLabel: {
    color: colors.primaryText,
  },
  darkLabel: {
    color: colors.text,
  },
});
