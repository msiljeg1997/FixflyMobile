import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import * as profileApi from '../api/profile';
import { appLock } from '../security/appLock';
import { isPushEnabled, setPushEnabled, registerForPush } from '../push/push';
import { AgentRole, AgentStats } from '../api/types';
import { setLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '../i18n';
import { formatDuration, getInitials } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = { hr: 'Hrvatski', en: 'English', de: 'Deutsch' };

export function ProfileScreen() {
  const { t, i18n } = useTranslation();
  const { agent, logout, startPinSetup } = useAuth();
  const insets = useSafeAreaInsets();

  const [stats, setStats] = useState<AgentStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [pushOn, setPushOn] = useState(true);

  useEffect(() => {
    isPushEnabled().then(setPushOn);
  }, []);

  // The switch moves first and the work happens behind it. Turning it off
  // deletes the device token server-side, so the phone actually stops buzzing
  // rather than the setting merely claiming it will.
  const togglePush = (value: boolean) => {
    setPushOn(value);
    setPushEnabled(value);
  };

  // App lock (PIN / biometrics). Off is a legitimate choice: the session then
  // simply stays open until the agent logs out.
  const [lockEnabled, setLockEnabled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // Re-read on focus — the setup screen lives above this one, so the
      // switch has to reflect whatever happened while we were away.
      appLock.isLockEnabled().then(setLockEnabled);
    }, [])
  );

  const toggleLock = (value: boolean) => {
    if (value) {
      startPinSetup('enroll');
      return; // the switch follows the outcome via the focus effect above
    }
    Alert.alert(t('profile.appLockOffTitle'), t('profile.appLockOffBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.appLockOffConfirm'),
        style: 'destructive',
        onPress: async () => {
          await appLock.disableLock();
          setLockEnabled(false);
        },
      },
    ]);
  };

  const changePin = () => startPinSetup('change');

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
        onPress: async () => {
          await setLanguage(lang);
          // The server writes push notifications for us, so it has to be told
          // — otherwise they keep arriving in the language this phone was
          // registered with, however many times the user changes it here.
          await registerForPush();
        },
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }]}
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(agent.name)}</Text>
        </View>
        <Text style={styles.name}>{agent.name}</Text>
        <Text style={styles.role}>{roleLabel}</Text>
        {agent.companyName ? <Text style={styles.company}>{agent.companyName}</Text> : null}
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
              <Text style={styles.statValue}>{stats ? formatDuration(stats.avgResolutionMinutes) : '–'}</Text>
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
          <View style={[styles.settingIconChip, { backgroundColor: tint(colors.green, '26') }]}>
            <Text style={styles.settingIcon}>🔔</Text>
          </View>
          <Text style={styles.settingLabel}>{t('profile.pushNotifications')}</Text>
          <Switch
            value={pushOn}
            onValueChange={togglePush}
            trackColor={{ true: colors.green, false: colors.border }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.border}
          />
        </View>

        <View style={styles.settingRow}>
          <View style={[styles.settingIconChip, { backgroundColor: tint(colors.statusAccepted, '26') }]}>
            <Text style={styles.settingIcon}>🔒</Text>
          </View>
          <View style={styles.settingLabelWrap}>
            <Text style={styles.settingLabel}>{t('profile.appLock')}</Text>
            <Text style={styles.settingSubLabel}>{t('profile.appLockHint')}</Text>
          </View>
          <Switch
            value={lockEnabled}
            onValueChange={toggleLock}
            trackColor={{ true: colors.green, false: colors.border }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.border}
          />
        </View>

        {/* Only worth showing when there is a PIN to change. */}
        {lockEnabled && (
          <TouchableOpacity style={styles.settingRow} onPress={changePin} activeOpacity={0.6}>
            <View style={[styles.settingIconChip, { backgroundColor: tint(colors.muted, '26') }]}>
              <Text style={styles.settingIcon}>🔑</Text>
            </View>
            <Text style={styles.settingLabel}>{t('profile.changePin')}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.settingRow} onPress={pickLanguage} activeOpacity={0.6}>
          <View style={[styles.settingIconChip, { backgroundColor: tint(colors.statusNew, '26') }]}>
            <Text style={styles.settingIcon}>🌐</Text>
          </View>
          <Text style={styles.settingLabel}>{t('profile.language')}</Text>
          <Text style={styles.settingValue}>{currentLanguage}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.settingRow, styles.logoutRow]} onPress={confirmLogout} activeOpacity={0.6}>
          <View style={[styles.settingIconChip, { backgroundColor: tint(colors.error, '26') }]}>
            <Text style={styles.settingIcon}>🚪</Text>
          </View>
          <Text style={styles.logoutLabel}>{t('common.logout')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg },

  header: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: tint(colors.green, '2A'),
    borderWidth: 1,
    borderColor: tint(colors.green, '55'),
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { fontSize: 26, fontWeight: '700', color: colors.forest },
  name: { fontSize: 18, fontWeight: '700', color: colors.forest },
  role: { fontSize: 13, color: colors.muted, marginTop: 2 },
  company: { fontSize: 12, color: colors.muted, marginTop: 2 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  statTile: {
    width: '47.5%',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  settingIconChip: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingIcon: { fontSize: 16 },
  settingLabelWrap: { flex: 1 },
  settingSubLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
  settingLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  settingValue: { fontSize: 14, color: colors.muted },
  chevron: { fontSize: 18, color: colors.muted, marginLeft: spacing.xs },
  logoutRow: { borderBottomWidth: 0 },
  logoutLabel: { flex: 1, fontSize: 15, color: colors.error, fontWeight: '700' },
});
