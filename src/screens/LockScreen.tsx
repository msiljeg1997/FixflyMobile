import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appLock } from '../security/appLock';
import { colors, radius, spacing, tint } from '../theme/tokens';

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'] as const;

interface Props {
  /** 'setup' asks twice (enter + confirm); 'unlock' verifies an existing PIN. */
  mode: 'setup' | 'unlock';
  onSuccess: () => void;
  /** Unlock only — drop the stored session and go back to full login. */
  onUseFullLogin?: () => void;
  /** Setup only — let the user skip and keep full-password login. */
  onSkip?: () => void;
}

export function LockScreen({ mode, onSuccess, onUseFullLogin, onSkip }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [entry, setEntry] = useState('');
  const [confirmEntry, setConfirmEntry] = useState<string | null>(null); // setup: first entry held here
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);

  const isConfirmStep = mode === 'setup' && confirmEntry !== null;

  const tryBiometric = useCallback(async () => {
    setError(null);
    const ok = await appLock.authenticateBiometric(t('lock.biometricPrompt'));
    if (ok) onSuccess();
  }, [onSuccess, t]);

  // On unlock, offer biometrics immediately — the PIN pad is the fallback,
  // not the default path.
  useEffect(() => {
    (async () => {
      if (mode !== 'unlock') return;
      const [available, enabled] = await Promise.all([
        appLock.isBiometricAvailable(),
        appLock.isBiometricEnabled(),
      ]);
      setBioAvailable(available && enabled);
      if (available && enabled) tryBiometric();
    })();
  }, [mode, tryBiometric]);

  const submit = useCallback(
    async (pin: string) => {
      setBusy(true);
      setError(null);
      try {
        if (mode === 'unlock') {
          if (await appLock.verifyPin(pin)) {
            onSuccess();
          } else {
            setError(t('lock.wrongPin'));
            setEntry('');
          }
          return;
        }

        // setup
        if (confirmEntry === null) {
          setConfirmEntry(pin);
          setEntry('');
          return;
        }
        if (confirmEntry !== pin) {
          setError(t('lock.pinMismatch'));
          setConfirmEntry(null);
          setEntry('');
          return;
        }
        await appLock.setPin(pin);
        if (await appLock.isBiometricAvailable()) await appLock.setBiometricEnabled(true);
        onSuccess();
      } finally {
        setBusy(false);
      }
    },
    [mode, confirmEntry, onSuccess, t]
  );

  const press = (key: string) => {
    if (busy) return;
    if (key === 'bio') {
      if (bioAvailable) tryBiometric();
      return;
    }
    if (key === 'del') {
      setEntry((prev) => prev.slice(0, -1));
      return;
    }
    setEntry((prev) => {
      if (prev.length >= PIN_LENGTH) return prev;
      const next = prev + key;
      if (next.length === PIN_LENGTH) setTimeout(() => submit(next), 80);
      return next;
    });
  };

  const title =
    mode === 'setup' ? (isConfirmStep ? t('lock.confirmPinTitle') : t('lock.setPinTitle')) : t('lock.unlockTitle');
  const subtitle = mode === 'setup' ? t('lock.setPinBody') : t('lock.unlockBody');

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.head}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>F</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <View style={styles.dots}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[styles.dot, i < entry.length && styles.dotFilled, !!error && styles.dotError]} />
        ))}
      </View>

      <Text style={styles.error}>{error ?? ' '}</Text>

      <View style={styles.pad}>
        {KEYS.map((key) => {
          const isBio = key === 'bio';
          const isDel = key === 'del';
          if (isBio && !bioAvailable) return <View key={key} style={styles.key} />;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.key, (isBio || isDel) && styles.keyPlain]}
              onPress={() => press(key)}
              activeOpacity={0.6}
              disabled={busy}
            >
              <Text style={[styles.keyText, (isBio || isDel) && styles.keyTextSmall]}>
                {isBio ? '👤' : isDel ? '⌫' : key}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {busy && <ActivityIndicator color={colors.green} style={{ marginTop: spacing.md }} />}

      <View style={styles.footer}>
        {mode === 'unlock' && onUseFullLogin && (
          <TouchableOpacity onPress={onUseFullLogin} hitSlop={8}>
            <Text style={styles.link}>{t('lock.useFullLogin')}</Text>
          </TouchableOpacity>
        )}
        {mode === 'setup' && onSkip && (
          <TouchableOpacity onPress={onSkip} hitSlop={8}>
            <Text style={styles.link}>{t('lock.skip')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, alignItems: 'center' },

  head: { alignItems: 'center' },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  brandMarkText: { fontSize: 24, fontWeight: '800', color: colors.white },
  title: { fontSize: 20, fontWeight: '700', color: colors.forest, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.muted, textAlign: 'center', marginTop: spacing.xs, maxWidth: 280 },

  dots: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.border },
  dotFilled: { backgroundColor: colors.green, borderColor: colors.green },
  dotError: { borderColor: colors.error },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm, minHeight: 18 },

  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 260, justifyContent: 'center', gap: spacing.md },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPlain: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { fontSize: 26, fontWeight: '600', color: colors.forest },
  keyTextSmall: { fontSize: 22 },

  footer: { marginTop: 'auto', paddingTop: spacing.lg },
  link: { color: colors.muted, fontSize: 14, fontWeight: '600' },
});
