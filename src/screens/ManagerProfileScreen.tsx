import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { appLock } from '../security/appLock';
import { isPushEnabled, setPushEnabled } from '../push/push';
import { setLanguage, SUPPORTED_LANGUAGES, SupportedLanguage } from '../i18n';
import { getInitials } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = { hr: 'Hrvatski', en: 'English', de: 'Deutsch' };

/**
 * The manager's own settings. No stats tiles: a manager is not measured by
 * tickets they personally resolved, and the agent screen's numbers would all
 * read zero for them.
 */
export function ManagerProfileScreen() {
  const { t, i18n } = useTranslation();
  const { manager, logout, startPinSetup, isVenueManager } = useAuth();
  const insets = useSafeAreaInsets();

  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [horizon, setHorizon] = useState('7');
  const [savingHorizon, setSavingHorizon] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
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

  useEffect(() => {
    setDisplayName(manager?.name ?? '');
    // The horizon is a company-wide setting; a venue manager neither sets it
    // nor may read it, and asking would only earn a 403 on every open.
    if (isVenueManager) return;
    apiClient
      .get<{ inboxHorizonDays: number }>('/api/admin/settings/timer')
      .then((r) => setHorizon(String(r.data.inboxHorizonDays ?? 7)))
      .catch(() => {});
  }, [manager?.name, isVenueManager]);

  useFocusEffect(
    useCallback(() => {
      appLock.isLockEnabled().then(setLockEnabled);
    }, [])
  );

  const saveName = async () => {
    const name = displayName.trim();
    if (!name) return;
    setSavingName(true);
    try {
      await apiClient.put(
        isVenueManager ? '/api/location/me' : '/api/admin/settings/profile',
        { name }
      );
      Alert.alert(t('managerProfile.nameSaved'));
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.message || t('inbox.actionError'));
    } finally {
      setSavingName(false);
    }
  };

  const saveHorizon = async () => {
    const days = parseInt(horizon, 10);
    if (!Number.isFinite(days)) return;
    setSavingHorizon(true);
    try {
      // The timer endpoint takes the acceptance windows too, so they are read
      // back and resent unchanged — sending defaults here would quietly
      // rewrite settings this screen never showed.
      const current = await apiClient.get<{
        acceptanceTimeoutMinutes: number;
        urgentAcceptanceTimeoutMinutes: number;
      }>('/api/admin/settings/timer');
      await apiClient.put('/api/admin/settings/timer', {
        acceptanceTimeoutMinutes: current.data.acceptanceTimeoutMinutes,
        urgentAcceptanceTimeoutMinutes: current.data.urgentAcceptanceTimeoutMinutes,
        inboxHorizonDays: days,
      });
      Alert.alert(t('managerProfile.horizonSaved'));
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.message || t('inbox.actionError'));
    } finally {
      setSavingHorizon(false);
    }
  };

  const toggleLock = (value: boolean) => {
    if (value) {
      startPinSetup('enroll');
      return;
    }
    Alert.alert(t('profile.appLockOffTitle'), t('profile.appLockOffBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.appLockOffConfirm'),
        style: 'destructive',
        onPress: async () => { await appLock.disableLock(); setLockEnabled(false); },
      },
    ]);
  };

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

  if (!manager) return null;

  const roleLabel =
    manager.role === 'LocationAdmin' ? t('managerProfile.roleLocation') : t('managerProfile.roleCompany');
  const currentLanguage = LANGUAGE_NAMES[(i18n.language as SupportedLanguage) ?? 'en'] ?? i18n.language;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(manager.name)}</Text>
          </View>
          <Text style={styles.name}>{manager.name}</Text>
          <Text style={styles.role}>{roleLabel}</Text>
          <Text style={styles.company}>{manager.locationName || manager.companyName}</Text>
        </View>

        <Text style={styles.sectionLabel}>{t('managerProfile.nameSection')}</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>{t('managerProfile.nameHint')}</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder={manager.email}
            placeholderTextColor={colors.muted}
            maxLength={100}
          />
          <TouchableOpacity
            style={[styles.saveButton, (!displayName.trim() || savingName) && styles.saveButtonDisabled]}
            onPress={saveName}
            disabled={!displayName.trim() || savingName}
          >
            <Text style={styles.saveButtonText}>
              {savingName ? t('common.saving') : t('managerProfile.save')}
            </Text>
          </TouchableOpacity>
        </View>

        {!isVenueManager && <><Text style={styles.sectionLabel}>{t('managerProfile.horizonSection')}</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>{t('managerProfile.horizonHint')}</Text>
          <View style={styles.horizonRow}>
            <TextInput
              style={[styles.input, styles.horizonInput]}
              value={horizon}
              onChangeText={setHorizon}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={styles.horizonUnit}>{t('managerProfile.days')}</Text>
            <TouchableOpacity
              style={[styles.saveButton, styles.horizonSave, savingHorizon && styles.saveButtonDisabled]}
              onPress={saveHorizon}
              disabled={savingHorizon}
            >
              <Text style={styles.saveButtonText}>
                {savingHorizon ? t('common.saving') : t('managerProfile.save')}
              </Text>
            </TouchableOpacity>
          </View>
        </View></>}

        <Text style={styles.sectionLabel}>{t('profile.settings')}</Text>
        <View style={styles.settingsCard}>
          {/* Only the company admin: nothing on the server pushes to a venue
              manager, so offering them the switch would promise notifications
              that are never sent. */}
          {!isVenueManager && (
            <View style={styles.settingRow}>
              <View style={[styles.iconChip, { backgroundColor: tint(colors.green) }]}>
                <Text style={styles.icon}>🔔</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>{t('profile.pushNotifications')}</Text>
              </View>
              <Switch
                value={pushOn}
                onValueChange={togglePush}
                trackColor={{ true: colors.green, false: colors.border }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.border}
              />
            </View>
          )}

          <View style={styles.settingRow}>
            <View style={[styles.iconChip, { backgroundColor: tint(colors.statusAccepted) }]}>
              <Text style={styles.icon}>🔒</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>{t('profile.appLock')}</Text>
              <Text style={styles.settingSub}>{t('profile.appLockHint')}</Text>
            </View>
            <Switch
              value={lockEnabled}
              onValueChange={toggleLock}
              trackColor={{ true: colors.green, false: colors.border }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.border}
            />
          </View>

          {lockEnabled && (
            <TouchableOpacity style={styles.settingRow} onPress={() => startPinSetup('change')} activeOpacity={0.6}>
              <View style={[styles.iconChip, { backgroundColor: tint(colors.muted) }]}>
                <Text style={styles.icon}>🔑</Text>
              </View>
              <Text style={styles.settingLabel}>{t('profile.changePin')}</Text>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.settingRow} onPress={pickLanguage} activeOpacity={0.6}>
            <View style={[styles.iconChip, { backgroundColor: tint(colors.statusNew) }]}>
              <Text style={styles.icon}>🌐</Text>
            </View>
            <Text style={styles.settingLabel}>{t('profile.language')}</Text>
            <Text style={styles.settingValue}>{currentLanguage}</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.settingRow, styles.lastRow]} onPress={confirmLogout} activeOpacity={0.6}>
            <View style={[styles.iconChip, { backgroundColor: tint(colors.error) }]}>
              <Text style={styles.icon}>🚪</Text>
            </View>
            <Text style={styles.logoutLabel}>{t('common.logout')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.md },

  header: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: tint(colors.green),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { fontSize: 24, fontWeight: '800', color: colors.green },
  name: { fontSize: 20, fontWeight: '700', color: colors.forest },
  role: { fontSize: 13, color: colors.muted, marginTop: 2 },
  company: { fontSize: 13, color: colors.muted },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 17, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.forest,
    fontSize: 15,
  },
  saveButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.5 },
  saveButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },

  horizonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  horizonInput: { width: 70, textAlign: 'center' },
  horizonUnit: { flex: 1, fontSize: 14, color: colors.text },
  horizonSave: { marginTop: 0, paddingHorizontal: spacing.lg },

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
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: { borderBottomWidth: 0 },
  iconChip: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 16 },
  settingLabel: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  settingSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  settingValue: { fontSize: 14, color: colors.muted },
  chevron: { fontSize: 20, color: colors.muted },
  logoutLabel: { flex: 1, fontSize: 15, color: colors.error, fontWeight: '700' },
});
