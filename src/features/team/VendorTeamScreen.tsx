import React, { useCallback, useEffect, useState } from 'react';
import {
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/hooks/useAuth';
import {
  addVendorTeamMember,
  getVendorTeamMembers,
  removeVendorTeamMember,
  VendorTeamMemberItem,
} from '@/services/vendor/vendorTeam.service';
import { getVendorPermissions } from '@/services/vendor/vendorRole.service';

const colors = {
  background: '#f9f9ff',
  card: '#ffffff',
  outline: '#717785',
  outlineVariant: '#c0c7d5',
  primary: '#005cad',
  primaryContainer: '#0075d8',
  danger: '#ba1a1a',
  dangerContainer: '#ffdad6',
  surfaceVariant: '#ebedf7',
  text: '#181c22',
  textMuted: '#404753',
  textSubtle: '#717785',
  white: '#ffffff',
  success: '#16A34A',
  successContainer: '#dcfce7',
};

export function VendorTeamScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const permissions = getVendorPermissions(user?.externalType);

  const [members, setMembers] = useState<VendorTeamMemberItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Form states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [designation, setDesignation] = useState('');
  const [externalType, setExternalType] = useState<'TEAM_LEADER' | 'WORKER'>('WORKER');

  const vendorProfileId = user?.vendorProfileId || 1;

  const loadMembers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getVendorTeamMembers(vendorProfileId);
      setMembers(data);
    } catch (err) {
      console.warn('[VendorTeamScreen] Error loading members:', err);
    } finally {
      setLoading(false);
    }
  }, [vendorProfileId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function handleAddMember() {
    if (!name.trim()) {
      Alert.alert('Required Field', 'Please enter the member name.');
      return;
    }
    if (!phone.trim()) {
      Alert.alert('Required Field', 'Please enter a valid phone number.');
      return;
    }

    try {
      setSubmitting(true);
      const res = await addVendorTeamMember(vendorProfileId, {
        name: name.trim(),
        phone: phone.trim(),
        designation: designation.trim() || undefined,
        externalType,
      });

      if (!res.success) {
        Alert.alert('Registration Failed', res.error || 'Could not register team member.');
        return;
      }

      Alert.alert('Success', `Registered ${name} as ${externalType === 'TEAM_LEADER' ? 'Team Leader' : 'Worker'}.`);
      setIsAddModalOpen(false);
      setName('');
      setPhone('');
      setDesignation('');
      setExternalType('WORKER');
      await loadMembers();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to add member.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleConfirmRemove(member: VendorTeamMemberItem) {
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${member.name} from the vendor team?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await removeVendorTeamMember(vendorProfileId, member.userId);
              if (res.success) {
                await loadMembers();
              } else {
                Alert.alert('Removal Failed', res.error || 'Could not remove member.');
              }
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to remove member.');
            }
          },
        },
      ]
    );
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
          <View style={styles.headerTitleBox}>
            <Text style={styles.headerTitle}>Team Management</Text>
            <Text style={styles.headerSubtitle}>
              {user?.vendorName || user?.projectName || 'Vendor Organization'}
            </Text>
          </View>
          {permissions.canManageTeamMembers ? (
            <Pressable
              accessibilityLabel="Add Member"
              accessibilityRole="button"
              onPress={() => setIsAddModalOpen(true)}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressedOpacity]}>
              <Icon
                color={colors.white}
                name={{ ios: 'plus', android: 'add', web: 'add' }}
                size={20}
                weight="bold"
              />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) }]}
          showsVerticalScrollIndicator={false}>
          {/* Info Card */}
          <View style={styles.infoBanner}>
            <Icon
              color={colors.primary}
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              size={24}
            />
            <View style={styles.infoTextGroup}>
              <Text style={styles.infoTitle}>Vendor Crew ({members.length})</Text>
              <Text style={styles.infoDesc}>
                Authorized workers and team leaders assigned to this vendor for field safety compliance checks.
              </Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <Text style={styles.loadingText}>Loading team members...</Text>
            </View>
          ) : members.length === 0 ? (
            <View style={styles.emptyCard}>
              <Icon
                color={colors.textSubtle}
                name={{ ios: 'person.crop.circle.badge.plus', android: 'person_add', web: 'person_add' }}
                size={48}
              />
              <Text style={styles.emptyTitle}>No Team Members</Text>
              <Text style={styles.emptyDesc}>
                No members found for this vendor organization. Tap the add button above to register team leaders and field workers.
              </Text>
            </View>
          ) : (
            <View style={styles.membersList}>
              {members.map((member, idx) => (
                <View
                  key={member.id}
                  style={[styles.memberCard, idx < members.length - 1 && styles.cardDivider]}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {member.name
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </Text>
                  </View>

                  <View style={styles.memberInfo}>
                    <View style={styles.nameRow}>
                      <Text style={styles.memberName}>{member.name}</Text>
                      <View
                        style={[
                          styles.badge,
                          member.externalType === 'TEAM_LEADER'
                            ? styles.leaderBadge
                            : styles.workerBadge,
                        ]}>
                        <Text
                          style={[
                            styles.badgeText,
                            member.externalType === 'TEAM_LEADER'
                              ? styles.leaderBadgeText
                              : styles.workerBadgeText,
                          ]}>
                          {member.externalType === 'TEAM_LEADER' ? 'Team Leader' : 'Worker'}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.memberPhone}>{member.phone}</Text>
                    {member.designation ? (
                      <Text style={styles.memberDesignation}>{member.designation}</Text>
                    ) : null}
                  </View>

                  {permissions.canManageTeamMembers ? (
                    <Pressable
                      accessibilityLabel="Remove member"
                      accessibilityRole="button"
                      onPress={() => handleConfirmRemove(member)}
                      style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedOpacity]}>
                      <Icon
                        color={colors.danger}
                        name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                        size={18}
                      />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Add Member Modal */}
        <Modal
          animationType="slide"
          onRequestClose={() => setIsAddModalOpen(false)}
          transparent
          visible={isAddModalOpen}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Vendor Member</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsAddModalOpen(false)}
                  style={styles.modalCloseButton}>
                  <Icon
                    color={colors.textMuted}
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={20}
                  />
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={styles.modalBody}>
                {/* Full Name */}
                <Text style={styles.inputLabel}>Full Name *</Text>
                <TextInput
                  onChangeText={setName}
                  placeholder="e.g. Shakib Al Hasan"
                  placeholderTextColor={colors.textSubtle}
                  style={styles.input}
                  value={name}
                />

                {/* Phone */}
                <Text style={styles.inputLabel}>Phone Number *</Text>
                <TextInput
                  keyboardType="phone-pad"
                  onChangeText={setPhone}
                  placeholder="e.g. +8801700000000"
                  placeholderTextColor={colors.textSubtle}
                  style={styles.input}
                  value={phone}
                />

                {/* Designation */}
                <Text style={styles.inputLabel}>Designation / Trade</Text>
                <TextInput
                  onChangeText={setDesignation}
                  placeholder="e.g. Rigger / Tower Climber"
                  placeholderTextColor={colors.textSubtle}
                  style={styles.input}
                  value={designation}
                />

                {/* Role Selection */}
                <Text style={styles.inputLabel}>Role Assignment *</Text>
                <View style={styles.rolePickerRow}>
                  <Pressable
                    onPress={() => setExternalType('WORKER')}
                    style={[
                      styles.rolePickerOption,
                      externalType === 'WORKER' && styles.rolePickerSelected,
                    ]}>
                    <Text
                      style={[
                        styles.rolePickerText,
                        externalType === 'WORKER' && styles.rolePickerTextSelected,
                      ]}>
                      Worker
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setExternalType('TEAM_LEADER')}
                    style={[
                      styles.rolePickerOption,
                      externalType === 'TEAM_LEADER' && styles.rolePickerSelected,
                    ]}>
                    <Text
                      style={[
                        styles.rolePickerText,
                        externalType === 'TEAM_LEADER' && styles.rolePickerTextSelected,
                      ]}>
                      Team Leader
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.modalActions}>
                  <Pressable
                    disabled={submitting}
                    onPress={() => setIsAddModalOpen(false)}
                    style={[styles.modalCancelBtn]}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    disabled={submitting}
                    onPress={handleAddMember}
                    style={[styles.modalSubmitBtn, submitting && styles.btnDisabled]}>
                    <Text style={styles.modalSubmitText}>
                      {submitting ? 'Registering...' : 'Register Member'}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  shell: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.outlineVariant,
    backgroundColor: colors.card,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleBox: {
    flex: 1,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textSubtle,
    marginTop: 2,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  infoBanner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#e8f2fc',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c6def9',
  },
  infoTextGroup: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  infoDesc: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  loadingBox: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSubtle,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  emptyDesc: {
    fontSize: 13,
    color: colors.textSubtle,
    textAlign: 'center',
    lineHeight: 18,
  },
  membersList: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  cardDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.outlineVariant,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  memberInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  leaderBadge: {
    backgroundColor: '#dbeafe',
  },
  leaderBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  workerBadge: {
    backgroundColor: '#f3f4f6',
  },
  workerBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4b5563',
  },
  memberPhone: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  memberDesignation: {
    fontSize: 12,
    color: colors.textSubtle,
    marginTop: 1,
  },
  deleteButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#fee2e2',
  },
  pressedOpacity: {
    opacity: 0.7,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  modalCloseButton: {
    padding: 6,
  },
  modalBody: {
    paddingBottom: 24,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  rolePickerRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  rolePickerOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rolePickerSelected: {
    backgroundColor: '#e8f2fc',
    borderColor: colors.primary,
  },
  rolePickerText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  rolePickerTextSelected: {
    color: colors.primary,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  modalSubmitBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  modalSubmitText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.white,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
