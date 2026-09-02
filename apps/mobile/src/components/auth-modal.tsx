import { KeyRound, LogOut, Mail, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { EMAIL_OTP_LENGTH, normalizeOtp, type OtpStep } from '@jamspot/shared';

/**
 * Passwordless email-OTP sign-in, presented as a sheet from the header.
 *
 * Uses the same Modal presentation as components/concert-details-modal.tsx
 * rather than adding a route or a third tab, so the app's existing navigation
 * structure is unchanged.
 */
export function AuthModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const { status, user, requestCode, verifyCode, signOut } = useAuth();

  const [step, setStep] = useState<OtpStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const send = async () => {
    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    const result = await requestCode(email);
    if (result.ok) {
      setStep('code');
      setNotice('Check your inbox — the code expires shortly.');
    } else {
      setError(result.message);
    }
    setIsSubmitting(false);
  };

  const verify = async () => {
    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    const result = await verifyCode(email, code);
    // On success the provider's onAuthStateChange flips `status`, and this
    // modal re-renders into its signed-in state.
    if (!result.ok) {
      setError(result.message);
    }
    setIsSubmitting(false);
  };

  const handleSignOut = async () => {
    setIsSubmitting(true);
    setError(null);
    const result = await signOut();
    if (!result.ok) setError(result.message);
    setStep('email');
    setEmail('');
    setCode('');
    setIsSubmitting(false);
  };

  const fieldStyle = [
    styles.field,
    { backgroundColor: theme.backgroundElement, borderColor: theme.border },
  ];

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}>
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <ThemedText type="heading">
            {status === 'authenticated' ? 'Account' : 'Sign in'}
          </ThemedText>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close sign in"
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <X size={18} color={theme.text} />
          </Pressable>
        </View>

        {status === 'loading' && <ActivityIndicator style={styles.loading} />}

        {status === 'authenticated' && (
          <View style={styles.section}>
            <ThemedText type="small" themeColor="textSecondary">
              Signed in as
            </ThemedText>
            <ThemedText>{user?.email}</ThemedText>

            {error && <ErrorBox message={error} />}

            <Pressable
              onPress={handleSignOut}
              disabled={isSubmitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: theme.border },
                (pressed || isSubmitting) && styles.pressed,
              ]}>
              <LogOut size={16} color={theme.text} />
              <ThemedText style={styles.buttonLabel}>Sign out</ThemedText>
            </Pressable>
          </View>
        )}

        {status === 'unauthenticated' && (
          <View style={styles.section}>
            {step === 'email' ? (
              <>
                <ThemedText type="monoSmall" themeColor="textSecondary">
                  EMAIL
                </ThemedText>
                <View style={fieldStyle}>
                  <Mail size={15} color={theme.textSecondary} />
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    onSubmitEditing={send}
                    placeholder="you@example.com"
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    returnKeyType="send"
                    style={[styles.input, { color: theme.text }]}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  We&apos;ll email you a code with {EMAIL_OTP_LENGTH} digits. No password
                  needed.
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText type="monoSmall" themeColor="textSecondary">
                  {EMAIL_OTP_LENGTH}-DIGIT CODE
                </ThemedText>
                <View style={fieldStyle}>
                  <KeyRound size={15} color={theme.textSecondary} />
                  <TextInput
                    value={code}
                    onChangeText={(value) => setCode(normalizeOtp(value))}
                    onSubmitEditing={verify}
                    placeholder={'0'.repeat(EMAIL_OTP_LENGTH)}
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={EMAIL_OTP_LENGTH}
                    returnKeyType="done"
                    style={[styles.input, styles.codeInput, { color: theme.text }]}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  Sent to {email}.
                </ThemedText>
              </>
            )}

            {error && <ErrorBox message={error} />}
            {notice && !error && (
              <ThemedText type="small" themeColor="textSecondary">
                {notice}
              </ThemedText>
            )}

            <Pressable
              onPress={step === 'email' ? send : verify}
              disabled={isSubmitting}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primary },
                (pressed || isSubmitting) && styles.pressed,
              ]}>
              {isSubmitting && (
                <ActivityIndicator size="small" color={theme.primaryForeground} />
              )}
              <ThemedText
                style={[styles.buttonLabel, { color: theme.primaryForeground }]}>
                {step === 'email' ? 'Email me a code' : 'Verify and sign in'}
              </ThemedText>
            </Pressable>

            {step === 'code' && (
              <View style={styles.linkRow}>
                <Pressable onPress={send} disabled={isSubmitting} accessibilityRole="button">
                  <ThemedText type="small" style={{ color: theme.primary }}>
                    Resend code
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setStep('email');
                    setCode('');
                    setError(null);
                    setNotice(null);
                  }}
                  accessibilityRole="button">
                  <ThemedText type="small" themeColor="textSecondary">
                    Use a different email
                  </ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <View style={styles.errorBox}>
      <ThemedText type="small" style={styles.errorText}>
        {message}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: Spacing.two,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three - Spacing.one,
    paddingVertical: Spacing.two + Spacing.half,
  },
  input: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  codeInput: {
    letterSpacing: 6,
  },
  primaryButton: {
    marginTop: Spacing.two,
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.control,
    paddingVertical: Spacing.three - Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    marginTop: Spacing.two,
    flexDirection: 'row',
    gap: Spacing.two,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three - Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  linkRow: {
    marginTop: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorBox: {
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  errorText: {
    color: '#fca5a5',
  },
  loading: {
    marginTop: Spacing.four,
  },
  pressed: {
    opacity: 0.7,
  },
});
