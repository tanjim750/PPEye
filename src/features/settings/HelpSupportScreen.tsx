import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

export function HelpSupportScreen() {
  const router = useRouter();
  const { t } = useTranslation('settings');
  const [searchQuery, setSearchQuery] = useState('');

  function handleCallSupport() {
    Linking.openURL('tel:+8801700000000').catch(() => {
      Alert.alert('Support Line', 'Contact safety support team at +880 1700-000000');
    });
  }

  function handleEmailTeam() {
    Linking.openURL('mailto:support@ppeye.com').catch(() => {
      Alert.alert('Support Email', 'Reach out to support@ppeye.com for urgent queries.');
    });
  }

  const helpTopics = [
    {
      titleKey: 'helpScreen.topic1Title' as const,
      subtitleKey: 'helpScreen.topic1Sub' as const,
      iconName: { ios: 'eye.fill', android: 'visibility', web: 'visibility' } as const,
      iconColor: colors.primary,
      iconBg: 'rgba(0, 92, 173, 0.12)',
    },
    {
      titleKey: 'helpScreen.topic2Title' as const,
      subtitleKey: 'helpScreen.topic2Sub' as const,
      iconName: { ios: 'arrow.up.doc.fill', android: 'upload_file', web: 'upload_file' } as const,
      iconColor: colors.secondary,
      iconBg: 'rgba(1, 93, 182, 0.12)',
    },
    {
      titleKey: 'helpScreen.topic3Title' as const,
      subtitleKey: 'helpScreen.topic3Sub' as const,
      iconName: {
        ios: 'person.badge.shield.checkmark.fill',
        android: 'manage_accounts',
        web: 'manage_accounts',
      } as const,
      iconColor: colors.tertiary,
      iconBg: 'rgba(152, 67, 0, 0.12)',
    },
  ];

  const filteredTopics = helpTopics.filter(
    (item) =>
      t(item.titleKey).toLowerCase().includes(searchQuery.toLowerCase()) ||
      t(item.subtitleKey).toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <Text style={styles.headerTitle}>{t('helpScreen.title')}</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}>
          {/* Intro Section */}
          <View style={styles.introSection}>
            <Text style={styles.introHeading}>{t('helpScreen.heading')}</Text>
            <Text style={styles.introSubtitle}>{t('helpScreen.subheading')}</Text>
          </View>

          {/* Search Input Bar */}
          <View style={styles.searchBar}>
            <Icon
              color={colors.outline}
              name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              size={20}
              style={styles.searchIcon}
            />
            <TextInput
              onChangeText={setSearchQuery}
              placeholder={t('helpScreen.searchPlaceholder')}
              placeholderTextColor={colors.outline}
              style={styles.searchInput}
              value={searchQuery}
            />
          </View>

          {/* Topics List */}
          <View style={styles.topicsCard}>
            {filteredTopics.map((topic, index) => (
              <Pressable
                accessibilityRole="button"
                key={topic.titleKey}
                onPress={() => Alert.alert(t(topic.titleKey), t(topic.subtitleKey))}
                style={({ pressed }) => [
                  styles.topicRow,
                  index < filteredTopics.length - 1 && styles.topicDivider,
                  pressed && styles.topicPressed,
                ]}>
                <View style={[styles.topicIconBox, { backgroundColor: topic.iconBg }]}>
                  <Icon color={topic.iconColor} name={topic.iconName} size={20} />
                </View>
                <View style={styles.topicCopy}>
                  <Text style={styles.topicTitle}>{t(topic.titleKey)}</Text>
                  <Text style={styles.topicSubtitle}>{t(topic.subtitleKey)}</Text>
                </View>
                <Icon
                  color={colors.outlineVariant}
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  size={20}
                />
              </Pressable>
            ))}
          </View>

          {/* Contact Card */}
          <View style={styles.contactCard}>
            <Text style={styles.contactTitle}>{t('helpScreen.contactTitle')}</Text>
            <Text style={styles.contactDescription}>{t('helpScreen.contactDesc')}</Text>
            <View style={styles.contactButtons}>
              <Pressable
                accessibilityRole="button"
                onPress={handleCallSupport}
                style={({ pressed }) => [styles.callButton, pressed && styles.pressedScale]}>
                <Icon
                  color={colors.white}
                  name={{ ios: 'phone.fill', android: 'call', web: 'call' }}
                  size={18}
                />
                <Text style={styles.callButtonText}>{t('helpScreen.callSupport')}</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                onPress={handleEmailTeam}
                style={({ pressed }) => [styles.emailButton, pressed && styles.pressedScale]}>
                <Icon
                  color={colors.primary}
                  name={{ ios: 'envelope.fill', android: 'mail', web: 'mail' }}
                  size={18}
                />
                <Text style={styles.emailButtonText}>{t('helpScreen.emailTeam')}</Text>
              </Pressable>
            </View>
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
  secondary: '#015db6',
  surface: '#ffffff',
  surfaceContainerLow: '#f1f3fd',
  tertiary: '#984300',
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
    color: colors.text,
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
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  introSection: {
    marginBottom: 20,
  },
  introHeading: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
    marginBottom: 4,
  },
  introSubtitle: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 22,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    height: 48,
    marginBottom: 20,
    paddingHorizontal: 14,
    shadowColor: '#000000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
  },
  topicsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.outlineVariant,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 24,
    overflow: 'hidden',
  },
  topicRow: {
    alignItems: 'center',
    flexDirection: 'row',
    padding: 16,
  },
  topicDivider: {
    borderBottomColor: colors.outlineVariant,
    borderBottomWidth: 1,
  },
  topicIconBox: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    marginRight: 14,
    width: 40,
  },
  topicCopy: {
    flex: 1,
  },
  topicTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  topicSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  topicPressed: {
    backgroundColor: 'rgba(224, 226, 236, 0.4)',
  },
  contactCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.outlineVariant,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  contactTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  contactDescription: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  contactButtons: {
    gap: 12,
  },
  callButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    width: '100%',
  },
  callButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  emailButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    width: '100%',
  },
  emailButtonText: {
    color: colors.primary,
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

export default HelpSupportScreen;
