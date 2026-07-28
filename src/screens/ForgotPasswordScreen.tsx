import React, { useState } from 'react';
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
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing } from '../theme/tokens';

/**
 * Two steps: ask for the address, then take the emailed code plus a new
 * password together.
 *
 * The code is deliberately NOT verified on its own screen first. A separate
 * "check the code" round-trip would either have to spend the code before the
 * password exists — leaving an account resettable by whoever holds the phone
 * next — or double the states to keep straight for no user benefit. One
 * submit, one outcome.
 */
export function ForgotPasswordScreen({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const { refreshSession } = useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await authApi.requestPasswordReset(email.trim());
      // Advances no matter what: the server refuses to say whether the
      // address is registered, and stopping here for an unknown address
      // would give away exactly what it withholds.
      setStep('code');
    } catch {
      setError(t('forgotPassword.requestError'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitReset = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await authApi.resetPassword(email.trim(), code.trim(), password);
      // The server signs us in as part of the reset, so the session is live
      // — pull the profile in and land on the task list.
      await refreshSession();
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message || t('forgotPassword.resetError'));
      setSubmitting(false);
    }
  };

  const canRequest = /\S+@\S+\.\S+/.test(email.trim()) && !submitting;
  const canReset = code.trim().length >= 4 && password.length >= 8 && !submitting;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" bounces={false}>
          <Text style={styles.title}>{t('forgotPassword.title')}</Text>

          {step === 'email' ? (
            <>
              <Text style={styles.subtitle}>{t('forgotPassword.emailPrompt')}</Text>
              <View style={styles.form}>
                <TextInput
                  style={styles.input}
                  placeholder={t('login.email')}
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="send"
                  value={email}
                  onChangeText={setEmail}
                  onSubmitEditing={() => canRequest && requestCode()}
                />
                {error && <Text style={styles.error}>{error}</Text>}
                <TouchableOpacity
                  style={[styles.button, !canRequest && styles.buttonDisabled]}
                  onPress={requestCode}
                  disabled={!canRequest}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.buttonText}>{t('forgotPassword.sendCode')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>{t('forgotPassword.codePrompt', { email: email.trim() })}</Text>
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
                />
                <TextInput
                  style={styles.input}
                  placeholder={t('forgotPassword.newPassword')}
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  textContentType="newPassword"
                  value={password}
                  onChangeText={setPassword}
                />
                <Text style={styles.hint}>{t('forgotPassword.passwordRule')}</Text>

                {error && <Text style={styles.error}>{error}</Text>}

                <TouchableOpacity
                  style={[styles.button, !canReset && styles.buttonDisabled]}
                  onPress={submitReset}
                  disabled={!canReset}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.buttonText}>{t('forgotPassword.submit')}</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => { setStep('email'); setError(null); }} disabled={submitting}>
                  <Text style={styles.link}>{t('forgotPassword.resend')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <TouchableOpacity onPress={onCancel} disabled={submitting}>
            <Text style={styles.link}>{t('forgotPassword.backToLogin')}</Text>
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
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 20,
  },

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
  hint: { fontSize: 12, color: colors.muted },
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
  link: {
    color: colors.green,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
