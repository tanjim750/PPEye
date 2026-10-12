import { Href, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';
import { dummyUsers } from '@/utils/dummy-users';

export function LoginScreen() {
  const router = useRouter();
  const { t } = useTranslation(['auth', 'common']);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function handleLogin() {
    const user = dummyUsers.find(
      (item) => item.username === username.trim() && item.password === password
    );

    if (!user) {
      Alert.alert('Login failed', 'Invalid username or password.');
      return;
    }

    router.replace((user.role === 'vendor' ? '/(external)' : '/(internal)') as Href);
  }

  function handleForgotPassword() {
    router.push('/forgot-password' as Href);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.logoFrame}>
              <Image source={assets.logo} style={styles.logo} />
            </View>

            <View style={styles.copy}>
              <Text style={styles.title}>{t('auth:loginScreen.title')}</Text>
              <Text style={styles.description}>{t('auth:loginScreen.description')}</Text>
            </View>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('auth:loginScreen.emailOrPhone')}</Text>
              <View style={styles.inputShell}>
                <Icon
                  color={colors.outline}
                  name={{ ios: 'envelope', android: 'mail', web: 'mail' }}
                  size={20}
                  style={styles.inputIcon}
                />
                <TextInput
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onChangeText={setUsername}
                  placeholder={t('auth:loginScreen.emailOrPhonePlaceholder')}
                  placeholderTextColor={colors.outline}
                  style={styles.input}
                  value={username}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.passwordLabelRow}>
                <Text style={styles.label}>{t('auth:loginScreen.password')}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={handleForgotPassword}
                  style={({ pressed }) => pressed && styles.textPressed}>
                  {/* <Text style={styles.forgotText}>{t('auth:loginScreen.forgotPassword')}</Text> */}
                </Pressable>
              </View>

              <View style={styles.inputShell}>
                <Icon
                  color={colors.outline}
                  name={{ ios: 'lock', android: 'lock', web: 'lock' }}
                  size={20}
                  style={styles.inputIcon}
                />
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setPassword}
                  placeholder={t('auth:loginScreen.passwordPlaceholder')}
                  placeholderTextColor={colors.outline}
                  secureTextEntry={!isPasswordVisible}
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                />
                <Pressable
                  accessibilityLabel={t('auth:loginScreen.togglePasswordVisibility')}
                  accessibilityRole="button"
                  onPress={() => setIsPasswordVisible((visible) => !visible)}
                  style={({ pressed }) => [styles.eyeButton, pressed && styles.textPressed]}>
                  <Icon
                    color={colors.outline}
                    name={{
                      ios: isPasswordVisible ? 'eye.slash' : 'eye',
                      android: isPasswordVisible ? 'visibility_off' : 'visibility',
                      web: isPasswordVisible ? 'visibility_off' : 'visibility',
                    }}
                    size={22}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={handleLogin}
              style={({ pressed }) => [styles.loginButton, pressed && styles.pressed]}>
              <Text style={styles.loginText}>{t('auth:loginScreen.submit')}</Text>
              <Icon
                color={colors.white}
                name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                size={16}
                weight="semibold"
              />
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.adminCopy}>
              {t('auth:loginScreen.needAccess')}{' '}
              <Text style={styles.adminLink}>{t('auth:loginScreen.contactAdmin')}</Text>
            </Text>
            <Text style={styles.version}>{t('common:version', { version: '1.0.0' })}</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const colors = {
  background: '#f9f9ff',
  outline: '#717785',
  primary: '#005cad',
  primaryFixed: '#d5e3ff',
  surfaceContainerLow: '#f1f3fd',
  text: '#181c22',
  textMuted: '#404753',
  white: '#ffffff',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  content: {
    alignSelf: 'center',
    gap: 48,
    justifyContent: 'space-between',
    minHeight: 707,
    paddingVertical: 32,
    width: '100%',
    maxWidth: 448,
  },
  header: {
    alignItems: 'center',
    gap: 16,
  },
  logoFrame: {
    alignItems: 'center',
    backgroundColor: colors.primaryFixed,
    borderRadius: 12,
    height: 64,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    width: 64,
  },
  logo: {
    borderRadius: 12,
    height: 64,
    width: 64,
  },
  copy: {
    alignItems: 'center',
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 32,
    textAlign: 'center',
  },
  description: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  form: {
    gap: 24,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0,
    lineHeight: 16,
  },
  passwordLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  forgotText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 12,
    flexDirection: 'row',
    minHeight: 48,
    paddingLeft: 16,
  },
  inputIcon: {
    height: 20,
    width: 28,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 48,
    paddingRight: 16,
  },
  passwordInput: {
    paddingRight: 92,
  },
  eyeButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
  },
  loginButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loginText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  textPressed: {
    opacity: 0.68,
  },
  footer: {
    alignItems: 'center',
    gap: 16,
  },
  adminCopy: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  adminLink: {
    color: colors.primary,
    fontWeight: '600',
  },
  version: {
    color: colors.outline,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
    textAlign: 'center',
  },
});
