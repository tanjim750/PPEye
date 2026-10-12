import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

export function ChangePasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation('settings');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isNewVisible, setIsNewVisible] = useState(false);
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function handleUpdatePassword() {
    if (!newPassword.trim()) {
      Alert.alert(t('changePasswordScreen.errorTitle'), t('changePasswordScreen.errorEmpty'));
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert(t('changePasswordScreen.errorTitle'), t('changePasswordScreen.errorMismatch'));
      return;
    }

    console.log('Password updated successfully:', {
      newPassword,
      confirmPassword,
    });

    setSuccessMessage(t('changePasswordScreen.successMessage'));
    setNewPassword('');
    setConfirmPassword('');

    Alert.alert(t('changePasswordScreen.successTitle'), t('changePasswordScreen.successAlert'), [
      { text: t('changePasswordScreen.okButton'), onPress: () => router.back() },
    ]);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressedOpacity]}>
            <Icon
              color={colors.primary}
              name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
              size={22}
            />
          </Pressable>
          <Text style={styles.headerTitle}>{t('changePasswordScreen.title')}</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          <Text style={styles.subtitle}>{t('changePasswordScreen.subtitle')}</Text>

          {/* Form with exactly 2 inputs */}
          <View style={styles.form}>
            {/* Input 1: New password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('changePasswordScreen.newPassword')}</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setNewPassword}
                  placeholder={t('changePasswordScreen.newPasswordPlaceholder')}
                  placeholderTextColor={colors.outline}
                  secureTextEntry={!isNewVisible}
                  style={styles.input}
                  value={newPassword}
                />
                <Pressable
                  accessibilityLabel="Toggle new password visibility"
                  accessibilityRole="button"
                  onPress={() => setIsNewVisible((v) => !v)}
                  style={styles.eyeButton}>
                  <Icon
                    color={colors.outline}
                    name={{
                      ios: isNewVisible ? 'eye.slash' : 'eye',
                      android: isNewVisible ? 'visibility_off' : 'visibility',
                      web: isNewVisible ? 'visibility_off' : 'visibility',
                    }}
                    size={20}
                  />
                </Pressable>
              </View>
            </View>

            {/* Input 2: Confirm password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('changePasswordScreen.confirmPassword')}</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setConfirmPassword}
                  placeholder={t('changePasswordScreen.confirmPasswordPlaceholder')}
                  placeholderTextColor={colors.outline}
                  secureTextEntry={!isConfirmVisible}
                  style={styles.input}
                  value={confirmPassword}
                />
                <Pressable
                  accessibilityLabel="Toggle confirm password visibility"
                  accessibilityRole="button"
                  onPress={() => setIsConfirmVisible((v) => !v)}
                  style={styles.eyeButton}>
                  <Icon
                    color={colors.outline}
                    name={{
                      ios: isConfirmVisible ? 'eye.slash' : 'eye',
                      android: isConfirmVisible ? 'visibility_off' : 'visibility',
                      web: isConfirmVisible ? 'visibility_off' : 'visibility',
                    }}
                    size={20}
                  />
                </Pressable>
              </View>
            </View>
          </View>

          {successMessage ? (
            <View style={styles.successBanner}>
              <Icon
                color={colors.successGreen}
                name={{
                  ios: 'checkmark.circle.fill',
                  android: 'check_circle',
                  web: 'check_circle',
                }}
                size={20}
              />
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          ) : null}

          {/* Action Button: Full-width blue Update Password */}
          <View style={styles.actionContainer}>
            <Pressable
              accessibilityRole="button"
              onPress={handleUpdatePassword}
              style={({ pressed }) => [styles.updateButton, pressed && styles.pressedScale]}>
              <Text style={styles.updateButtonText}>{t('changePasswordScreen.updateButton')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const colors = {
  background: '#f9f9ff',
  outline: '#717785',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  successGreen: '#16a34a',
  surface: '#ffffff',
  text: '#181c22',
  textMuted: '#404753',
  white: '#ffffff',
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  shell: {
    alignSelf: 'center',
    backgroundColor: colors.background,
    flex: 1,
    maxWidth: 448,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitle: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerPlaceholder: {
    height: 40,
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  form: {
    gap: 20,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  inputWrapper: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minHeight: 48,
    paddingRight: 10,
  },
  eyeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  successBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(22, 163, 74, 0.1)',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
    padding: 12,
  },
  successText: {
    color: colors.successGreen,
    fontSize: 14,
    fontWeight: '600',
  },
  actionContainer: {
    marginTop: 'auto',
    paddingTop: 36,
    paddingBottom: 16,
  },
  updateButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    height: 50,
    justifyContent: 'center',
    width: '100%',
  },
  updateButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  pressedOpacity: {
    opacity: 0.7,
  },
  pressedScale: {
    transform: [{ scale: 0.98 }],
  },
});

export default ChangePasswordScreen;
