import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as authApi from '../api/auth';
import { colors, radius, spacing } from '../theme/tokens';

/**
 * Recovering the device PIN.
 *
 * The PIN is local — a gate on a session this device already holds — so there
 * is nothing on the server to reset. What the code proves is that whoever is
 * holding the phone also reads the account's inbox. Possession of the device
 * alone therefore isn't enough to get past the lock, which is the entire point
 * of having one.
 *
 * The code is requested on mount: arriving here means the agent is already
 * stuck, and a screen whose only content is a button that says "send me the
 * thing you obviously need" is a wasted tap.
 */
export function ForgotPinScreen({ onVerified, onCancel }: { onVerified: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    setSending(true);
    try {
      setMaskedEmail(await authApi.requestPinReset());
    } catch {
      setError(t('forgotPin.sendError'));
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await authApi.verifyPinReset(code.trim());
      onVerified();
    } catch (err: any) {
      setError(err?.response?.data?.message || t('forgotPin.codeError'));
      setSubmitting(false);
    }
  };

  const canSubmit = code.trim().length >= 4 && !submitting && !sending;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" bounces={false}>
          <Text style={styles.title}>{t('forgotPin.title')}</Text>
          <Text style={styles.subtitle}>
            {sending
              ? t('forgotPin.sending')
              : maskedEmail
                ? t('forgotPin.sentTo', { email: maskedEmail })
                : t('forgotPin.sent')}
          </Text>

          <View style={styles.form}>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="000000"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={6}
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              value={code}
              onChangeText={setCode}
              editable={!sending}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, !canSubmit && styles.buttonDisabled]}
              onPress={submit}
              disabled={!canSubmit}
            >
              {submitting || sending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buttonText}>{t('forgotPin.submit')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={send} disabled={sending || submitting}>
              <Text style={styles.link}>{t('forgotPin.resend')}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={onCancel} disabled={submitting}>
            <Text style={styles.linkMuted}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.surface },

  title: { fontSize: 24, fontWeight: '700', color: colors.forest, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 20 },

  form: { gap: spacing.sm },
  input: {
    backgroundColor: colors.card,
    color: colors.forest,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 16,
  },
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontWeight: '700' },
  error: { color: colors.error, fontSize: 13 },

  button: {
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  link: { color: colors.green, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: spacing.md },
  linkMuted: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: spacing.md },
});
