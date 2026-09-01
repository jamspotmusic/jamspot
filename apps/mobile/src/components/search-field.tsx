import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The search inputs from apps/web's headers: a muted rounded field with a
 * leading icon and a border that turns violet while focused
 * (`focus-within:border-primary/50`).
 */
export function SearchField({
  icon: Icon,
  ...inputProps
}: TextInputProps & { icon: LucideIcon }) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.field,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <Icon size={15} color={theme.textSecondary} />
      <TextInput
        placeholderTextColor={theme.textSecondary}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        {...inputProps}
        style={[styles.input, { color: theme.text }, inputProps.style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three - Spacing.one,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
});
