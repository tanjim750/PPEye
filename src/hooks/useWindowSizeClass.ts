import { useWindowDimensions } from 'react-native';

export type WindowSizeClass = 'compact' | 'medium' | 'expanded';

/**
 * Android Window Size Classes (Material 3 standard)
 * Compact: < 600dp (Standard phones portrait)
 * Medium: 600dp - 839dp (Foldables unfolded, 7" tablets)
 * Expanded: >= 840dp (10"+ tablets, desktop, landscape)
 */
export function useWindowSizeClass() {
  const { width, height } = useWindowDimensions();

  const sizeClass: WindowSizeClass =
    width < 600 ? 'compact' : width < 840 ? 'medium' : 'expanded';

  return {
    width,
    height,
    sizeClass,
    isCompact: sizeClass === 'compact',
    isMedium: sizeClass === 'medium',
    isExpanded: sizeClass === 'expanded',
    isLandscape: width > height,
    // Max width to keep content centered and readable on wide screens
    contentMaxWidth: sizeClass === 'compact' ? 448 : sizeClass === 'medium' ? 680 : 960,
  };
}
