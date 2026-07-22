import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import * as profileApi from '../api/profile';
import { AgentRole, AgentStats } from '../api/types';
import { setLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '../i18n';
import { colors, radius, spacing } from '../theme/tokens';

const PUSH_PREF_KEY = 'fixfly_push_notifications_enabled';
const LANGUAGE_NAMES: Record<SupportedLanguage, string> = { hr: 'Hrvatski', en: 'English', de: 'Deutsch' };

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const { agent, logout } = useAuth();

  const [stats, setStats] = useState<AgentStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Local preference only — actual FCM permission/registration lands with
  // the native-build push client (Expo Go can't hold a real device token).
  const [pushEnabled, setPushEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(PUSH_PREF_KEY).then((v) => {
      if (v !== null) setPushEnabled(v === 'true');
    });
  }, []);

  const togglePush = (value: boolean) => {
    setPushEnabled(value);
    AsyncStorage.setItem(PUSH_PREF_KEY, String(value));
  };

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await profileApi.getMyStats());
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );

  const pickLanguage = () => {
    Alert.alert(
      t('profile.language'),
      undefined,
      SUPPORTED_LANGUAGES.map((lang) => ({
        text: LANGUAGE_NAMES[lang],
        onPress: async () => setLanguage(lang),
      })).concat([{ text: t('common.cancel'), onPress: async () => {} }])
    );
  };

  const confirmLogout = () => {
    Alert.alert(t('profile.logoutConfirmTitle'), t('profile.logoutConfirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.logout'), style: 'destructive', onPress: logout },
    ]);
  };

  if (!agent) return null;

  const roleLabel = agent.role === AgentRole.Hausmajstor ? t('role.dispatcher') : t('role.technician');
  const currentLanguage = LANGUAGE_NAMES[(i18n.language as SupportedLanguage) ?? 'en'] ?? i18n.language;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(agent.name)}</Text>
        </View>
        <Text style={styles.name}>{agent.name}</Text>
        <Text style={styles.role}>{roleLabel}</Text>
      </View>

      <View style={styles.statsGrid}>
        {statsLoading ? (
          <ActivityIndicator color={colors.green} style={{ marginVertical: spacing.lg }} />
        ) : (
          <>
            <View style={styles.statTile}>
              <Text style={[styles.statValue, styles.statValueGreen]}>{stats?.resolvedToday ?? '–'}</Text>
              <Text style={styles.statLabel}>{t('profile.resolvedToday')}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{stats ? `${stats.avgResolutionMinutes} min` : '–'}</Text>
              <Text style={styles.statLabel}>{t('profile.avgResolution')}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={[styles.statValue, styles.statValueGreen]}>
                {stats ? `${stats.successRatePercent}%` : '–'}
              </Text>
              <Text style={styles.statLabel}>{t('profile.successRate')}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{stats?.activeTasks ?? '–'}</Text>
              <Text style={styles.statLabel}>{t('profile.activeTasks')}</Text>
            </View>
          </>
        )}
      </View>

      <Text style={styles.sectionLabel}>{t('profile.settings')}</Text>
      <View style={styles.settingsCard}>
        <View style={styles.settingRow}>
          <Text style={styles.settingIcon}>🔔</Text>
          <Text style={styles.settingLabel}>{t('profile.pushNotifications')}</Text>
          <Switch
            value={pushEnabled}
            onValueChange={togglePush}
            trackColor={{ true: colors.green, false: colors.border }}
          />
        </View>

        <TouchableOpacity style={styles.settingRow} onPress={pickLanguage}>
          <Text style={styles.settingIcon}>🌐</Text>
          <Text style={styles.settingLabel}>{t('profile.language')}</Text>
          <Text style={styles.settingValue}>{currentLanguage} ›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.settingRow, styles.logoutRow]} onPress={confirmLogout}>
          <Text style={styles.settingIcon}>🚪</Text>
          <Text style={styles.logoutLabel}>{t('common.logout')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, padding: spacing.lg, paddingTop: spacing.xl + spacing.md },

  header: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#d7f5e6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { fontSize: 26, fontWeight: '700', color: colors.forest },
  name: { fontSize: 18, fontWeight: '700', color: colors.forest },
  role: { fontSize: 13, color: colors.muted, marginTop: 2 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  statTile: {
    width: '47.5%',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.forest },
  statValueGreen: { color: colors.green },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  settingsCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
    gap: spacing.sm,
  },
  settingIcon: { fontSize: 18, width: 24 },
  settingLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  settingValue: { fontSize: 14, color: colors.muted },
  logoutRow: { borderBottomWidth: 0 },
  logoutLabel: { flex: 1, fontSize: 15, color: colors.error, fontWeight: '700' },
});
