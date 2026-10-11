import { SymbolView, SymbolViewProps } from 'expo-symbols';
import { StyleProp, ViewStyle } from 'react-native';

type IconProps = {
  color: string;
  name: SymbolViewProps['name'];
  size?: number;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolViewProps['weight'];
};

export function Icon({ color, name, size = 20, style, weight = 'regular' }: IconProps) {
  return <SymbolView name={name} size={size} style={style} tintColor={color} weight={weight} />;
}
