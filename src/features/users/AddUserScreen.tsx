import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
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
import { supabase } from '@/services/supabase/client';
import { createClient } from '@supabase/supabase-js';
import { saveUserCredential } from '@/services/auth/credentialSync.service';
import {
  isEmail,
  isValidName,
  isValidPassword,
  isValidPhone,
  isValidVendorName,
} from '@/utils/validation';

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
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [savedVendors, setSavedVendors] = useState<string[]>(vendorOptions);
  const [selectedVendor, setSelectedVendor] = useState<string>(vendorOptions[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [role, setRole] = useState(externalRoles[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdSuccessInfo, setCreatedSuccessInfo] = useState<{
    name: string;
    email: string;
    role: string;
    password: string;
  } | null>(null);

  useEffect(() => {
    async function loadSavedVendors() {
      try {
        const { data, error } = await supabase
          .from('vendor_profiles')
          .select('vendor_name')
          .order('vendor_name', { ascending: true });

        if (!error && data && data.length > 0) {
          const namesFromDb = data
            .map((item: any) => item.vendor_name?.trim())
            .filter((name: string) => Boolean(name) && name.length >= 2);
          const uniqueNames: string[] = [];
          const seen = new Set<string>();
          for (const n of namesFromDb) {
            const lower = n.toLowerCase();
            if (!seen.has(lower)) {
              seen.add(lower);
              uniqueNames.push(n);
            }
          }
          setSavedVendors(uniqueNames.length > 0 ? uniqueNames : vendorOptions);
        } else {
          setSavedVendors(vendorOptions);
        }
      } catch (err) {
        console.warn('[AddUserScreen] Error fetching vendor_profiles:', err);
      }
    }
    void loadSavedVendors();
  }, []);

  function handleSelectOrAddVendor(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = savedVendors.find((v) => v.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setSelectedVendor(existing);
    } else {
      setSavedVendors((prev) => [trimmed, ...prev]);
      setSelectedVendor(trimmed);
    }
    setSearchQuery('');
    setIsDropdownOpen(false);
  }

  const filteredVendors = searchQuery.trim()
    ? savedVendors.filter((v) =>
        v.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : savedVendors;

  // When userType changes, reset role to appropriate default
  function handleTypeChange(type: 'internal' | 'external') {
    setUserType(type);
    setFormError(null);
    if (type === 'internal') {
      setRole(internalRoles[0]);
    } else {
      setRole(externalRoles[0]);
    }
  }

  async function handleCreateUser() {
    if (isSubmitting) return;

    setFormError(null);
    const trimmedName = fullName.trim();
    const rawPhone = phone.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const trimmedVendor = (selectedVendor || searchQuery).trim();
    if (searchQuery.trim() && !selectedVendor) {
      handleSelectOrAddVendor(searchQuery);
    }

    if (!trimmedName || !isValidName(trimmedName)) {
      setFormError('Please enter a valid full name using letters only.');
      Alert.alert('Validation Error', 'Please enter a valid full name using letters only.');
      return;
    }
    if (!rawPhone || !isValidPhone(rawPhone)) {
      setFormError('Please enter a valid mobile number.');
      Alert.alert('Validation Error', 'Please enter a valid mobile number.');
      return;
    }
    if (!trimmedEmail || !isEmail(trimmedEmail)) {
      setFormError('Please enter a valid email address.');
      Alert.alert('Validation Error', 'Please enter a valid email address.');
      return;
    }
    if (!trimmedPassword || !isValidPassword(trimmedPassword)) {
      setFormError('Password must be at least 6 characters.');
      Alert.alert('Validation Error', 'Password must be at least 6 characters.');
      return;
    }
    if (userType === 'external' && (!trimmedVendor || !isValidVendorName(trimmedVendor))) {
      setFormError('Please select or add a valid organization.');
      Alert.alert('Validation Error', 'Please select or add a valid organization.');
      return;
    }

    const formattedPhone = rawPhone.startsWith('+')
      ? rawPhone
      : rawPhone.startsWith('0')
      ? `+88${rawPhone}`
      : `+880${rawPhone}`;

    setIsSubmitting(true);
    try {
      // 1. Map role to database enum types
      const category = userType === 'internal' ? 'INTERNAL' : 'EXTERNAL';
      let externalType: 'PROJECT_MANAGER' | 'TEAM_LEADER' | 'WORKER' | null = null;
      if (category === 'EXTERNAL') {
        if (role === 'Vendor Team Leader') externalType = 'TEAM_LEADER';
        else if (role === 'Field Technician') externalType = 'WORKER';
        else externalType = 'PROJECT_MANAGER';
      }

      // 2. Upsert user record in public.users table
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .or(`email.eq.${trimmedEmail},phone.eq.${formattedPhone}`)
        .maybeSingle();

      let createdUserId: number | undefined;

      if (existingUser?.id) {
        createdUserId = existingUser.id;
        await supabase
          .from('users')
          .update({
            name: trimmedName,
            phone: formattedPhone,
            email: trimmedEmail,
            category,
            designation: role,
            external_type: externalType,
            profile_picture_file_id: null,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingUser.id);
      } else {
        const { data: insertedUser, error: insertError } = await supabase
          .from('users')
          .insert({
            name: trimmedName,
            phone: formattedPhone,
            email: trimmedEmail,
            category,
            designation: role,
            external_type: externalType,
            profile_picture_file_id: null,
            is_active: true,
          })
          .select('id')
          .maybeSingle();

        if (insertError) {
          throw new Error(insertError.message);
        }
        createdUserId = insertedUser?.id;
      }

      // 3. If EXTERNAL user, ensure vendor_members is linked to custom or existing vendor_profile
      if (category === 'EXTERNAL' && createdUserId) {
        // Look up by vendor name (case-insensitive) to prevent duplicate profiles
        const { data: matchedVendor } = await supabase
          .from('vendor_profiles')
          .select('id')
          .ilike('vendor_name', trimmedVendor)
          .maybeSingle();

        let vendorProfileId = matchedVendor?.id;

        if (!vendorProfileId) {
          const { data: allProfiles } = await supabase
            .from('vendor_profiles')
            .select('id, vendor_name');

          const found = allProfiles?.find(
            (p: any) => (p.vendor_name || '').trim().toLowerCase() === trimmedVendor.toLowerCase()
          );

          if (found?.id) {
            vendorProfileId = found.id;
          }
        }

        if (!vendorProfileId) {
          const { data: newVendorProfile, error: createVendorErr } = await supabase
            .from('vendor_profiles')
            .insert({
              vendor_name: trimmedVendor,
              project_name: vendorId.trim() ? `Project ${vendorId.trim()}` : `${trimmedVendor} Operations`,
              created_by: createdUserId,
            })
            .select('id')
            .maybeSingle();

          if (!createVendorErr && newVendorProfile?.id) {
            vendorProfileId = newVendorProfile.id;
          } else {
            console.warn('[AddUserScreen] vendor_profiles insert note:', createVendorErr?.message);
          }
        }

        const finalVendorProfileId = vendorProfileId || 1;
        await supabase.from('vendor_members').upsert(
          {
            vendor_profile_id: finalVendorProfileId,
            user_id: createdUserId,
          },
          { onConflict: 'vendor_profile_id,user_id' }
        );
      }

      // 4. Save credential to database store so user can log in immediately from ANY device (Phone or Web)
      await saveUserCredential(trimmedEmail, trimmedPassword, createdUserId);

      // 5. Best-effort Supabase Auth signUp in background (doesn't block user if email rate limit reached)
      try {
        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
        const supabaseAnonKey =
          process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';
        const tempAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
        tempAuthClient.auth.signUp({
          email: trimmedEmail,
          password: trimmedPassword,
          options: {
            data: {
              name: trimmedName,
              phone: formattedPhone,
              category,
            },
          },
        }).catch((e) => console.warn('[AddUserScreen] Supabase Auth signUp warning:', e?.message));
      } catch (authErr) {
        console.warn('[AddUserScreen] Could not spawn temp auth client:', authErr);
      }

      // 6. Show prominent Success Feedback
      setCreatedSuccessInfo({
        name: trimmedName,
        email: trimmedEmail,
        role,
        password: trimmedPassword,
      });

      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
        window.alert(
          `User Created Successfully!\n\nName: ${trimmedName}\nRole: ${role}\nEmail: ${trimmedEmail}\nPassword: ${trimmedPassword}\n\nYou can now log in with these credentials on any phone or computer.`
        );
      }
    } catch (err: any) {
      console.error('[AddUserScreen] Error creating user:', err);
      const errMsg = err?.message || 'Could not complete user registration.';
      setFormError(errMsg);
      Alert.alert('Error Creating User', errMsg);
    } finally {
      setIsSubmitting(false);
    }
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
            {formError ? (
              <View style={styles.errorBanner}>
                <Icon
                  color="#dc2626"
                  name={{ ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' }}
                  size={18}
                />
                <Text style={styles.errorBannerText}>{formError}</Text>
              </View>
            ) : null}

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

                <View style={styles.divider} />

                {/* Password Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Initial Password</Text>
                  <View style={styles.passwordRow}>
                    <TextInput
                      autoCapitalize="none"
                      placeholder="Set account password, minimum 6 characters"
                      placeholderTextColor="#a0a7b5"
                      secureTextEntry={!isPasswordVisible}
                      style={[styles.input, { flex: 1 }]}
                      value={password}
                      onChangeText={setPassword}
                    />
                    <Pressable
                      accessibilityLabel="Toggle password visibility"
                      accessibilityRole="button"
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      onPress={() => setIsPasswordVisible((v) => !v)}
                      style={styles.eyeBtn}>
                      <Icon
                        color="#717785"
                        name={{
                          ios: isPasswordVisible ? 'eye.slash' : 'eye',
                          android: isPasswordVisible ? 'visibility_off' : 'visibility',
                          web: isPasswordVisible ? 'visibility_off' : 'visibility',
                        }}
                        size={18}
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>

            {/* Organization Section (Visible for External) */}
            {userType === 'external' && (
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>ORGANIZATION</Text>
                <View style={styles.card}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Organization / Vendor</Text>

                    {/* Search & Add Input Box */}
                    <View style={styles.orgInputRow}>
                      <View style={styles.orgSearchBox}>
                        <Icon
                          color="#717785"
                          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                          size={18}
                        />
                        <TextInput
                          placeholder="Search or add organization..."
                          placeholderTextColor="#a0a7b5"
                          returnKeyType="done"
                          style={styles.orgTextInput}
                          value={searchQuery}
                          onChangeText={(text) => {
                            setSearchQuery(text);
                            setIsDropdownOpen(true);
                          }}
                          onFocus={() => setIsDropdownOpen(true)}
                          onSubmitEditing={() => {
                            if (searchQuery.trim()) {
                              handleSelectOrAddVendor(searchQuery);
                            }
                          }}
                          {...(Platform.OS === 'web'
                            ? ({
                                onKeyDown: (e: any) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (searchQuery.trim()) {
                                      handleSelectOrAddVendor(searchQuery);
                                    }
                                  }
                                },
                              } as any)
                            : {})}
                        />
                        {searchQuery.trim().length > 0 ? (
                          <Pressable
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            onPress={() => setSearchQuery('')}>
                            <Icon
                              color="#717785"
                              name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
                              size={16}
                            />
                          </Pressable>
                        ) : null}
                      </View>

                      {searchQuery.trim().length > 0 &&
                        !savedVendors.some(
                          (v) => v.toLowerCase() === searchQuery.trim().toLowerCase()
                        ) && (
                          <Pressable
                            accessibilityLabel="Add organization"
                            accessibilityRole="button"
                            onPress={() => handleSelectOrAddVendor(searchQuery)}
                            style={styles.addOrgBtn}>
                            <Icon
                              color="#ffffff"
                              name={{ ios: 'plus', android: 'add', web: 'add' }}
                              size={16}
                            />
                            <Text style={styles.addOrgBtnText}>Add</Text>
                          </Pressable>
                        )}
                    </View>

                    {/* Selected Organization Summary Card */}
                    {selectedVendor ? (
                      <View style={styles.selectedOrgCard}>
                        <View style={styles.selectedOrgLeft}>
                          <View style={styles.selectedOrgIcon}>
                            <Icon
                              color="#0082F0"
                              name={{
                                ios: 'checkmark.seal.fill',
                                android: 'verified',
                                web: 'verified',
                              }}
                              size={18}
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.selectedOrgSub}>Selected Organization</Text>
                            <Text style={styles.selectedOrgName} numberOfLines={1}>
                              {selectedVendor}
                            </Text>
                          </View>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() => setIsDropdownOpen((prev) => !prev)}
                          style={styles.changeOrgBtn}>
                          <Text style={styles.changeOrgBtnText}>
                            {isDropdownOpen ? 'Close' : 'Browse'}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {/* Dropdown of Saved Organizations & Search Results */}
                    {isDropdownOpen && (
                      <View style={styles.orgDropdownList}>
                        <Text style={styles.dropdownHeaderTitle}>
                          Saved Organizations ({filteredVendors.length})
                        </Text>
                        <ScrollView
                          keyboardShouldPersistTaps="handled"
                          nestedScrollEnabled
                          style={styles.dropdownScroll}>
                          {filteredVendors.map((item) => {
                            const isSelected =
                              selectedVendor.trim().toLowerCase() === item.toLowerCase();
                            return (
                              <Pressable
                                key={item}
                                onPress={() => handleSelectOrAddVendor(item)}
                                style={[
                                  styles.dropdownItemRow,
                                  isSelected && styles.dropdownItemRowActive,
                                ]}>
                                <Text
                                  style={[
                                    styles.dropdownItemName,
                                    isSelected && styles.dropdownItemNameActive,
                                  ]}>
                                  {item}
                                </Text>
                                {isSelected ? (
                                  <Icon
                                    color={colors.primary}
                                    name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                                    size={16}
                                  />
                                ) : null}
                              </Pressable>
                            );
                          })}

                          {/* Inline Add Option if Search Query is New */}
                          {searchQuery.trim().length > 0 &&
                            !filteredVendors.some(
                              (v) => v.toLowerCase() === searchQuery.trim().toLowerCase()
                            ) && (
                              <Pressable
                                onPress={() => handleSelectOrAddVendor(searchQuery)}
                                style={styles.dropdownAddItemRow}>
                                <Icon
                                  color="#0082F0"
                                  name={{
                                    ios: 'plus.circle.fill',
                                    android: 'add_circle',
                                    web: 'add_circle',
                                  }}
                                  size={18}
                                />
                                <Text style={styles.dropdownAddItemText}>
                                  Add "{searchQuery.trim()}"
                                </Text>
                              </Pressable>
                            )}

                          {filteredVendors.length === 0 && searchQuery.trim().length === 0 && (
                            <View style={styles.emptyDropdown}>
                              <Text style={styles.emptyDropdownText}>
                                No saved organizations found.
                              </Text>
                            </View>
                          )}
                        </ScrollView>
                      </View>
                    )}
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Vendor ID - Optional</Text>
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
              disabled={isSubmitting}
              onPress={handleCreateUser}
              style={({ pressed }) => [
                styles.submitButton,
                isSubmitting && { opacity: 0.7 },
                pressed && styles.submitButtonPressed,
              ]}>
              {isSubmitting ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <>
                  <Icon
                    color={colors.white}
                    name={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }}
                    size={20}
                  />
                  <Text style={styles.submitButtonText}>Create User</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* In-App Success Feedback Modal (guaranteed to render on Web and Mobile) */}
      {createdSuccessInfo && (
        <Modal
          animationType="fade"
          onRequestClose={() => {
            setCreatedSuccessInfo(null);
            router.back();
          }}
          transparent
          visible={!!createdSuccessInfo}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalIconCircle}>
                <Icon
                  color="#16a34a"
                  name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
                  size={44}
                />
              </View>

              <Text style={styles.modalTitle}>User Created Successfully!</Text>
              <Text style={styles.modalSubtitle}>
                The account has been created and synced with the database.
              </Text>

              <View style={styles.modalDetailsBox}>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Name</Text>
                  <Text style={styles.modalValue}>{createdSuccessInfo.name}</Text>
                </View>
                <View style={styles.modalDivider} />
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Role</Text>
                  <Text style={styles.modalValue}>{createdSuccessInfo.role}</Text>
                </View>
                <View style={styles.modalDivider} />
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Email</Text>
                  <Text style={styles.modalValue}>{createdSuccessInfo.email}</Text>
                </View>
                <View style={styles.modalDivider} />
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Password</Text>
                  <Text style={[styles.modalValue, { fontWeight: '700', color: colors.primary }]}>
                    {createdSuccessInfo.password}
                  </Text>
                </View>
              </View>

              <Text style={styles.modalNotice}>
                You can now log in with this email and password from your phone or web browser.
              </Text>

              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setCreatedSuccessInfo(null);
                  router.back();
                }}
                style={({ pressed }) => [styles.modalDoneButton, pressed && { opacity: 0.85 }]}>
                <Text style={styles.modalDoneButtonText}>Done / Back to Users</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
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
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
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
  orgInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  orgSearchBox: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: colors.outlineVariant,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    height: 48,
    paddingHorizontal: 12,
  },
  orgTextInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    height: '100%',
    marginLeft: 8,
  },
  addOrgBtn: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  addOrgBtnText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  selectedOrgCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 92, 173, 0.06)',
    borderColor: 'rgba(0, 92, 173, 0.2)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    padding: 12,
  },
  selectedOrgLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  selectedOrgIcon: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  selectedOrgSub: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  selectedOrgName: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  changeOrgBtn: {
    backgroundColor: '#ffffff',
    borderColor: colors.outlineVariant,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  changeOrgBtnText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  orgDropdownList: {
    backgroundColor: '#ffffff',
    borderColor: colors.outlineVariant,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 4,
    marginTop: 8,
    maxHeight: 220,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  dropdownHeaderTitle: {
    backgroundColor: '#f1f5f9',
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    textTransform: 'uppercase',
  },
  dropdownScroll: {
    maxHeight: 180,
  },
  dropdownItemRow: {
    alignItems: 'center',
    borderBottomColor: '#f1f5f9',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownItemRowActive: {
    backgroundColor: 'rgba(0, 92, 173, 0.08)',
  },
  dropdownItemName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  dropdownItemNameActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  dropdownAddItemRow: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderTopColor: colors.outlineVariant,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownAddItemText: {
    color: colors.primaryButton,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyDropdown: {
    alignItems: 'center',
    padding: 16,
  },
  emptyDropdownText: {
    color: colors.textMuted,
    fontSize: 13,
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
  errorBanner: {
    alignItems: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    borderColor: '#fca5a5',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    padding: 12,
  },
  errorBannerText: {
    color: '#dc2626',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 16,
    elevation: 8,
    maxWidth: 400,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    width: '100%',
  },
  modalIconCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(22, 163, 74, 0.12)',
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    marginBottom: 16,
    width: 72,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 6,
    textAlign: 'center',
  },
  modalDetailsBox: {
    backgroundColor: colors.background,
    borderColor: colors.outlineVariant,
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  modalLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  modalValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  modalDivider: {
    backgroundColor: colors.outlineVariant,
    height: 1,
    marginVertical: 2,
    opacity: 0.5,
  },
  modalNotice: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalDoneButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: 10,
    height: 46,
    justifyContent: 'center',
    width: '100%',
  },
  modalDoneButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
});

export default AddUserScreen;
