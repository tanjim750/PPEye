import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import {
  getSubmittedWorkerCheck,
  SubmittedWorkerCheck,
} from '@/features/submissions/services/submittedChecks.service';

export function SubmittedWorkerPreviewScreen() {
  const router = useRouter();
  const { checkId } = useLocalSearchParams<{ checkId?: string }>();
  const [check, setCheck] = useState<SubmittedWorkerCheck | null>(null);
  const { t } = useTranslation('submission');

  useEffect(() => {
    if (checkId) getSubmittedWorkerCheck(checkId).then(setCheck);
  }, [checkId]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Icon
            color="#17324d"
            name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
            size={22}
          />
        </Pressable>
        <Text style={styles.title}>{t('submittedPreview.title')}</Text>
      </View>
      {check ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summary}>
            <Text style={styles.worker}>
              {t('submittedPreview.workerNumber', { number: check.workerNumber })}
            </Text>
            <Text style={styles.site}>{check.site}</Text>
            <Text style={styles.status}>{t('submittedPreview.waiting')}</Text>
          </View>
          <Text style={styles.section}>{t('submittedPreview.photos')}</Text>
          <Text style={styles.label}>{t('submittedPreview.front')}</Text>
          <Image contentFit="cover" source={{ uri: check.frontUri }} style={styles.photo} />
          <Text style={styles.label}>{t('submittedPreview.back')}</Text>
          <Image contentFit="cover" source={{ uri: check.backUri }} style={styles.photo} />
          {check.otherPhotoUris.map((uri, index) => (
            <View key={`${uri}-${index}`}>
              <Text style={styles.label}>{t('submittedPreview.sitePhoto', { number: index + 1 })}</Text>
              <Image contentFit="cover" source={{ uri }} style={styles.photo} />
            </View>
          ))}
          <Text style={styles.date}>
            {t('submittedPreview.submittedAt', {
              date: new Date(check.submittedAt).toLocaleString(),
            })}
          </Text>
        </ScrollView>
      ) : (
        <View style={styles.empty}><Text style={styles.emptyText}>{t('submittedPreview.notFound')}</Text></View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#f5f8fc', flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, padding: 18 },
  back: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  title: { color: '#17324d', fontSize: 19, fontWeight: '700' },
  content: { gap: 12, padding: 18, paddingBottom: 36 },
  summary: { backgroundColor: '#fff', borderRadius: 16, gap: 6, padding: 18 },
  worker: { color: '#17324d', fontSize: 20, fontWeight: '700' },
  site: { color: '#607286', fontSize: 14 },
  status: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff4d8',
    borderRadius: 20,
    color: '#966300',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  section: { color: '#17324d', fontSize: 17, fontWeight: '700', marginTop: 10 },
  label: { color: '#607286', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 6 },
  photo: { backgroundColor: '#e5ebf2', borderRadius: 14, height: 250, width: '100%' },
  date: { color: '#607286', fontSize: 12, marginTop: 8 },
  empty: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyText: { color: '#607286', fontSize: 15 },
});
