import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';

type Props = { visible: boolean; status: string; onRetry: () => Promise<void> };

export function NoInternetScreen({ visible, status, onRetry }: Props) {
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [visible]);

  async function handleRetry() {
    setChecking(true);
    try {
      await onRetry();
    } finally {
      setChecking(false);
    }
  }

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <Icon color="#F59E0B" name={{ ios: 'wifi.slash', android: 'wifi_off', web: 'wifi_off' }} size={44} />
        </View>
        <Text style={styles.title}>No Internet Connection</Text>
        <Text style={styles.description}>
          Please connect to Wi-Fi or turn on Mobile Data to continue using PPEye.
        </Text>
        <Text style={styles.status}>{checking ? 'Checking connection...' : status}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={checking}
          onPress={handleRetry}
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}>
          {checking ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Retry Connection</Text>}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  description: { color: '#CBD5E1', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 320 },
  status: { color: '#F59E0B', fontSize: 13, fontWeight: '600' },
  button: {
    marginTop: 12,
    minWidth: 220,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#1E40AF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
