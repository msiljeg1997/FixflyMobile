import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { colors, spacing } from '../theme/tokens';

// Placeholder for Screen 2 (guide §15). Real task list + Active/Completed
// tabs + pull-to-refresh land once backend W3 (GET /api/agent/tasks) exists —
// this is just the navigation destination so the auth flow is testable now.
export function TasksScreen() {
  const { t } = useTranslation();
  const { agent, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('tasks.title')}</Text>
      {agent && <Text style={styles.subtitle}>{agent.name}</Text>}
      <Text style={styles.empty}>{t('tasks.empty')}</Text>
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>{t('common.logout')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, backgroundColor: colors.white },
  title: { fontSize: 24, fontWeight: '700', color: colors.forest, marginBottom: spacing.xs },
  subtitle: { fontSize: 14, color: colors.muted, marginBottom: spacing.lg },
  empty: { fontSize: 14, color: colors.muted },
  logoutButton: { marginTop: 'auto', alignItems: 'center', paddingVertical: spacing.md },
  logoutText: { color: colors.error, fontSize: 15, fontWeight: '600' },
});
