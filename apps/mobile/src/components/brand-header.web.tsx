import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';

/**
 * On the Expo web build the floating nav bar in app-tabs.web.tsx already
 * carries the JAMSPOT mark and both destinations — the same composition
 * apps/web's sticky header has — so repeating the brand mark here would be a
 * second copy of it directly underneath. Native has no such bar (the tabs sit
 * at the bottom), which is why only the mark stands down on web.
 *
 * Children still render: they carry per-screen header content the nav bar
 * doesn't duplicate, including the sign-in button, which would otherwise
 * vanish on web and leave no way to authenticate there.
 */
export function BrandHeader({ children }: { children?: React.ReactNode }) {
  if (!children) return null;

  return <View style={styles.header}>{children}</View>;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: Spacing.two,
  },
});
