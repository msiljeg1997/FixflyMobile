import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radius, spacing, tint } from '../theme/tokens';

// Backend chat (W8 — per-ticket thread, read receipts, realtime + push) is
// already live; this placeholder just reserves the tab until Screen 4 (the
// actual conversation UI) is built.
export function ChatPlaceholderScreen() {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.glyph}>💬</Text>
      </View>
      <Text style={styles.title}>{t('chat.comingSoonTitle')}</Text>
      <Text style={styles.subtitle}>{t('chat.comingSoonBody')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.surface },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  glyph: { fontSize: 36 },
  title: { fontSize: 18, fontWeight: '700', color: colors.forest, marginBottom: spacing.xs },
  subtitle: { fontSize: 14, color: colors.muted, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
});
