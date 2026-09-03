import { LogIn, User } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AuthModal } from '@/components/auth-modal';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

/**
 * The auth affordance in the mobile header — "Sign in" when signed out, the
 * account glyph when signed in — mirroring apps/web's AuthNav so both apps put
 * auth in the same place. Opens AuthModal.
 */
export function AuthButton() {
  const theme = useTheme();
  const { status } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  // Reserve the space rather than flashing "Sign in" before the persisted
  // session resolves.
  if (status === 'loading') {
    return <View style={styles.placeholder} />;
  }

  const signedIn = status === 'authenticated';

  return (
    <>
      <Pressable
        onPress={() => setIsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={signedIn ? 'Account' : 'Sign in'}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
          },
          pressed && styles.pressed,
        ]}>
        {signedIn ? (
          <User size={14} color={theme.primary} />
        ) : (
          <LogIn size={14} color={theme.textSecondary} />
        )}
        {!signedIn && (
          <ThemedText type="small" themeColor="textSecondary">
            Sign in
          </ThemedText>
        )}
      </Pressable>

      {isOpen && <AuthModal onClose={() => setIsOpen(false)} />}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three - Spacing.one,
    paddingVertical: Spacing.one + Spacing.half,
  },
  placeholder: {
    height: 28,
    width: 76,
  },
  pressed: {
    opacity: 0.7,
  },
});
