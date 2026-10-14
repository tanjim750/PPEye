import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';

const colors = {
  background: '#f9f9ff',
  card: '#ffffff',
  outline: '#717785',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  primaryButton: '#0082F0',
  surfaceVariant: '#e0e2ec',
  text: '#181c22',
  textMuted: '#404753',
  white: '#ffffff',
};

const vendorOptions = ['ABC Telecom', 'XYZ Networks', 'Apex Power', 'Delta Comms', 'Sigma Tech'];
const externalRoles = ['Vendor Team Leader', 'Field Technician', 'Safety Supervisor'];
const internalRoles = ['EHS Representative', 'Safety Inspector', 'Compliance Officer'];

export function AddUserScreen() {
  const router = useRouter();
  const { t } = useTranslation('settings');

  const [userType, setUserType] = useState<'internal' | 'external'>('external');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [vendor, setVendor] = useState(vendorOptions[0]);
  const [vendorId, setVendorId] = useState('');
  const [role, setRole] = useState(externalRoles[0]);

  // When userType changes, reset role to appropriate default
  function handleTypeChange(type: 'internal' | 'external') {
    setUserType(type);
    if (type === 'internal') {
      setRole(internalRoles[0]);
    } else {
      setRole(externalRoles[0]);
    }
  }

  function handleCreateUser() {
    if (!fullName.trim()) {
      Alert.alert('Validation Error', 'Please enter a full name.');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Validation Error', 'Please enter a phone number.');
      return;
    }
    if (!email.trim()) {
      Alert.alert('Validation Error', 'Please enter an email address.');
      return;
    }

    Alert.alert(
      'User Created Successfully',
      `Account for ${fullName} (${role}) has been created.`,
      [
        {
          text: 'OK',
          onPress: () => router.back(),
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}>
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
            <View style={styles.headerTitleContainer}>
              <Text style={styles.headerTitle}>
                {t('addUser', { defaultValue: 'Add User' })}
              </Text>
              <Text style={styles.headerSubtitle}>
                {t('addUserSub', { defaultValue: 'Create a new account' })}
              </Text>
            </View>
            <View style={styles.headerPlaceholder} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scroll}>
            {/* User Type Segmented Control */}
            <View style={styles.segmentedControl}>
              <Pressable
                accessibilityRole="button"
                onPress={() => handleTypeChange('internal')}
                style={[
                  styles.segmentButton,
                  userType === 'internal' && styles.segmentButtonActive,
                ]}>
                <Text
                  style={[
                    styles.segmentText,
                    userType === 'internal' && styles.segmentTextActive,
                  ]}>
                  Internal
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => handleTypeChange('external')}
                style={[
                  styles.segmentButton,
                  userType === 'external' && styles.segmentButtonActive,
                ]}>
                <Text
                  style={[
                    styles.segmentText,
                    userType === 'external' && styles.segmentTextActive,
                  ]}>
                  External
                </Text>
              </Pressable>
            </View>

            {/* Basic Information Section */}
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>BASIC INFORMATION</Text>
              <View style={styles.card}>
                {/* Full Name */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Full name</Text>
                  <TextInput
                    placeholder="e.g. Rahim Mia"
                    placeholderTextColor="#a0a7b5"
                    style={styles.input}
                    value={fullName}
                    onChangeText={setFullName}
                  />
                </View>

                <View style={styles.divider} />

                {/* Phone Number */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Phone number</Text>
                  <View style={styles.phoneRow}>
                    <Text style={styles.prefix}>+880</Text>
                    <TextInput
                      keyboardType="phone-pad"
                      placeholder="1712345678"
                      placeholderTextColor="#a0a7b5"
                      style={[styles.input, styles.phoneInput]}
                      value={phone}
                      onChangeText={setPhone}
                    />
                  </View>
                </View>

                <View style={styles.divider} />

                {/* Email */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Email</Text>
                  <TextInput
                    autoCapitalize="none"
                    keyboardType="email-address"
                    placeholder="rahim.mia@example.com"
                    placeholderTextColor="#a0a7b5"
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>
              </View>
            </View>

            {/* Organization Section (Visible for External) */}
            {userType === 'external' && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>ORGANIZATION</Text>
                <View style={styles.card}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Vendor</Text>
                    <View style={styles.pillsRow}>
                      {vendorOptions.map((opt) => (
                        <Pressable
                          key={opt}
                          onPress={() => setVendor(opt)}
                          style={[
                            styles.vendorPill,
                            vendor === opt && styles.vendorPillActive,
                          ]}>
                          <Text
                            style={[
                              styles.vendorPillText,
                              vendor === opt && styles.vendorPillTextActive,
                            ]}>
                            {opt}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Vendor ID (Optional)</Text>
                    <TextInput
                      placeholder="e.g. V-12345"
                      placeholderTextColor="#a0a7b5"
                      style={styles.input}
                      value={vendorId}
                      onChangeText={setVendorId}
                    />
                  </View>
                </View>
              </View>
            )}

            {/* Access Section */}
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>ACCESS & ROLE</Text>
              <View style={styles.card}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Role</Text>
                  <View style={styles.pillsRow}>
                    {(userType === 'external' ? externalRoles : internalRoles).map((r) => (
                      <Pressable
                        key={r}
                        onPress={() => setRole(r)}
                        style={[
                          styles.vendorPill,
                          role === r && styles.vendorPillActive,
                        ]}>
                        <Text
                          style={[
                            styles.vendorPillText,
                            role === r && styles.vendorPillTextActive,
                          ]}>
                          {r}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.bottomSpacer} />
          </ScrollView>

          {/* Sticky Bottom Action Area */}
          <View style={styles.bottomBar}>
            <Pressable
              accessibilityRole="button"
              onPress={handleCreateUser}
              style={({ pressed }) => [
                styles.submitButton,
                pressed && styles.submitButtonPressed,
              ]}>
              <Icon
                color={colors.white}
                name={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }}
                size={20}
              />
              <Text style={styles.submitButtonText}>Create User</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  shell: {
    backgroundColor: colors.background,
    flex: 1,
    maxWidth: 448,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 60,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  backButton: {
    padding: 6,
    marginLeft: -6,
  },
  pressedOpacity: {
    opacity: 0.7,
  },
  headerTitleContainer: {
    flex: 1,
    marginLeft: 8,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  headerPlaceholder: {
    width: 32,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 20,
  },
  segmentedControl: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    flexDirection: 'row',
    marginBottom: 20,
    padding: 4,
  },
  segmentButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    paddingVertical: 8,
  },
  segmentButtonActive: {
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: colors.text,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: 'rgba(192, 199, 213, 0.6)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inputGroup: {
    paddingVertical: 6,
  },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
  },
  input: {
    color: colors.text,
    fontSize: 15,
    minHeight: 28,
    padding: 0,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  prefix: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '500',
    marginRight: 8,
  },
  phoneInput: {
    flex: 1,
  },
  divider: {
    backgroundColor: colors.outlineVariant,
    height: 1,
    marginVertical: 6,
    opacity: 0.6,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  vendorPill: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  vendorPillActive: {
    backgroundColor: colors.primary,
  },
  vendorPillText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  vendorPillTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
  bottomSpacer: {
    height: 30,
  },
  bottomBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopColor: colors.outlineVariant,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
  },
  submitButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  submitButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default AddUserScreen;
