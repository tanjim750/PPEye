import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';

interface InProgressLimitModalProps {
  visible: boolean;
  inProgressCount?: number;
  onClose: () => void;
}

export function InProgressLimitModal({
  visible,
  inProgressCount = 3,
  onClose,
}: InProgressLimitModalProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Dismiss dialog"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdropPressable}
        />
        <View style={styles.card}>
          <View style={styles.iconBox}>
            <Icon
              color="#984300"
              name={{
                ios: 'clock.badge.exclamationmark',
                android: 'pending_actions',
                web: 'pending_actions',
              }}
              size={30}
              weight="bold"
            />
          </View>

          <Text style={styles.title}>In-Progress Limit Reached</Text>
          <Text style={styles.subtitle}>Maximum 3 in-progress reviews allowed</Text>

          <Text style={styles.message}>
            You currently have <Text style={styles.bold}>{inProgressCount} reviews</Text> in progress.
            Please complete your in-progress reviews before starting a new review.
          </Text>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  backdropPressable: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    elevation: 8,
    maxWidth: 360,
    paddingHorizontal: 24,
    paddingVertical: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    width: '100%',
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(152, 67, 0, 0.12)',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    marginBottom: 16,
    width: 56,
  },
  title: {
    color: '#181c22',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    color: '#984300',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    color: '#404753',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
    textAlign: 'center',
  },
  bold: {
    color: '#181c22',
    fontWeight: '700',
  },
  actions: {
    width: '100%',
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: '#005cad',
    borderRadius: 12,
    justifyContent: 'center',
    paddingVertical: 13,
    width: '100%',
  },
  cancelButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
