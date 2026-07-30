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
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { isNetworkError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, radius, spacing } from '../theme/tokens';

export function LoginScreen({ onForgotPassword }: { onForgotPassword: () => void }) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await login({ email: email.trim(), password });
    } catch (err: unknown) {
      // "Wrong password" used to be the answer to every failure, including a
      // phone that could not reach the server at all — which sent people
      // hunting for a credential problem that did not exist.
      if (isNetworkError(err)) {
        setError(t('login.networkError'));
      } else if (axios.isAxiosError(err) && err.response?.status === 429) {
        // Login is rate limited; without this, being throttled also read as
        // bad credentials and invited more retries, which made it worse.
        setError(t('login.tooManyAttempts'));
      } else {
        setError(t('login.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // The password field sat low enough that the keyboard covered it on
    // smaller devices; the scroll view + padding behavior lifts the form
    // instead, and tapping the backdrop dismisses the keyboard.
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>F</Text>
          </View>
          <Text style={styles.title}>{t('login.title')}</Text>
          <Text style={styles.subtitle}>{t('login.subtitle')}</Text>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder={t('login.email')}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder={t('login.password')}
              placeholderTextColor={colors.muted}
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={() => {
                if (email && password && !submitting) onSubmit();
              }}
              value={password}
              onChangeText={setPassword}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, submitting && styles.buttonDisabled]}
              onPress={onSubmit}
              disabled={submitting || !email || !password}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buttonText}>{t('login.submit')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={onForgotPassword} disabled={submitting} hitSlop={8}>
              <Text style={styles.link}>{t('login.forgotPassword')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.surface },

  brandMark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  brandMarkText: { fontSize: 28, fontWeight: '800', color: colors.white },

  title: { fontSize: 26, fontWeight: '700', color: colors.forest, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: spacing.xl },

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
