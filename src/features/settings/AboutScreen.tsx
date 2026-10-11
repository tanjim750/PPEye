import { Text } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { typography } from '@/theme';

export function AboutScreen() {
  return (
    <Screen>
      <Text style={typography.title}>About PPEye</Text>
      <Text style={typography.body}>PPE verification and review for field teams.</Text>
    </Screen>
  );
}
