import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';
import { assets } from '@/constants/assets';

type EditableField = 'fullName' | 'phoneNumber' | 'email';

export function ProfileScreen() {
  const router = useRouter();
  const { t } = useTranslation('settings');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [fullName, setFullName] = useState('Mahmud Hasan');
  const [phoneNumber, setPhoneNumber] = useState('+880 1712 345678');
  const [email, setEmail] = useState('mahmud@example.com');
  const [focusedField, setFocusedField] = useState<EditableField | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  async function handlePickImage() {
    // Opens the native picker (a hidden file input on web) and returns a local preview URI.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });

    if (!result.canceled) {
      setProfileImage(result.assets[0].uri);
    }
  }

  function handleSave() {
    console.log('Profile saved:', { fullName, phoneNumber, email, profileImage });
    setToastMessage(t('profileScreen.saveSuccess'));
  }

  const fields: {
    key: EditableField;
    label: string;
    value: string;
    onChange: (text: string) => void;
    keyboardType: 'default' | 'phone-pad' | 'email-address';
  }[] = [
    { key: 'fullName', label: t('profileScreen.fieldFullName'), value: fullName, onChange: setFullName, keyboardType: 'default' },
    { key: 'phoneNumber', label: t('profileScreen.fieldPhone'), value: phoneNumber, onChange: setPhoneNumber, keyboardType: 'phone-pad' },
    { key: 'email', label: t('profileScreen.fieldEmail'), value: email, onChange: setEmail, keyboardType: 'email-address' },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressedOpacity]}>
              <Icon color={colors.primary} name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }} size={22} />
            </Pressable>
            <Text style={styles.headerTitle}>{t('profileScreen.title')}</Text>
            <View style={styles.backButton} />
          </View>

          <View style={styles.profileSection}>
            <View style={styles.avatarWrapper}>
              <Image
                contentFit="cover"
                source={profileImage ? { uri: profileImage } : assets.ehsProfile}
                style={styles.avatar}
              />
              <Pressable
                accessibilityLabel="Change profile photo"
                accessibilityRole="button"
                onPress={handlePickImage}
                style={({ pressed }) => [styles.editBadge, pressed && styles.pressedOpacity]}>
                <Icon color={colors.white} name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={16} />
              </Pressable>
            </View>
            <Text style={styles.name}>{fullName}</Text>
            <Text style={styles.subtitle}>{t('profileScreen.ehsSubtitle')}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('profileScreen.personalInfo')}</Text>
            {fields.map((field, index) => (
              <View key={field.key} style={[styles.fieldRow, index > 0 && styles.fieldDivider]}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <TextInput
                  autoCapitalize={field.key === 'fullName' ? 'words' : 'none'}
                  keyboardType={field.keyboardType}
                  onBlur={() => setFocusedField(null)}
                  onChangeText={field.onChange}
                  onFocus={() => setFocusedField(field.key)}
                  style={[styles.input, focusedField === field.key && styles.inputFocused]}
                  value={field.value}
                />
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('profileScreen.accountDetails')}</Text>
            <Text style={styles.fieldLabel}>{t('profileScreen.fieldRole')}</Text>
            <View style={styles.roleBox}>
              <Icon
                color={colors.primary}
                name={{ ios: 'checkmark.shield', android: 'shield_person', web: 'shield_person' }}
                size={20}
              />
              <Text style={styles.roleText}>{t('profileScreen.roleValue')}</Text>
            </View>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={handleSave}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressedScale]}>
            <Icon color={colors.white} name={{ ios: 'square.and.arrow.down', android: 'save', web: 'save' }} size={18} />
            <Text style={styles.saveText}>{t('profileScreen.saveButton')}</Text>
          </Pressable>
        </View>
      </ScrollView>

      {toastMessage ? (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const colors = {
  background: '#f9f9ff',
  border: '#e5e7eb',
  divider: '#eef0f3',
  gray100: '#f3f4f6',
  primary: '#005cad',
  softPrimary: '#3b82f6',
  text: '#181c22',
  textMuted: '#6b7280',
  white: '#ffffff',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  card: {
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 448,
    overflow: 'hidden',
    paddingBottom: 20,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
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
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  profileSection: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 24,
  },
  avatarWrapper: {
    height: 96,
    marginBottom: 8,
    width: 96,
  },
  avatar: {
    borderRadius: 48,
    height: 96,
    width: 96,
  },
  editBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.white,
    borderRadius: 16,
    borderWidth: 2,
    bottom: 0,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 32,
  },
  name: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
  },
  section: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fieldRow: {
    gap: 4,
    paddingVertical: 10,
  },
  fieldDivider: {
    borderTopColor: colors.divider,
    borderTopWidth: 1,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  inputFocused: {
    borderColor: colors.primary,
  },
  roleBox: {
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  roleText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  saveButton: {
    alignItems: 'center',
    backgroundColor: colors.softPrimary,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 24,
  },
  saveText: {
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
  toast: {
    alignSelf: 'center',
    backgroundColor: colors.text,
    borderRadius: 8,
    bottom: 32,
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: 'absolute',
  },
  toastText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
  },
});
