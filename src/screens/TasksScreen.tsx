import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { signalRService } from '../realtime/signalr';
import * as tasksApi from '../api/tasks';
import { TaskListItem, TaskTab, TicketStatus } from '../api/types';
import type { TasksStackParamList } from '../navigation/TasksStackNavigator';
import { categoryLabel } from '../utils/format';
import { colors, radius, spacing } from '../theme/tokens';

const STATUS_COLORS: Record<TicketStatus, string> = {
  [TicketStatus.New]: colors.statusNew,
  [TicketStatus.ForwardedToTechnician]: colors.statusForwarded,
  [TicketStatus.Accepted]: colors.statusAccepted,
  [TicketStatus.Returned]: colors.statusReturned,
  [TicketStatus.Done]: colors.statusDone,
  [TicketStatus.Closed]: colors.statusClosed,
};

export function TasksScreen() {
  const { t } = useTranslation();
  const { agent, logout } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<TasksStackParamList>>();

  const [tab, setTab] = useState<TaskTab>('active');
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (which: TaskTab, asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      else setLoading(true);
      setError(false);
      try {
        const res = await tasksApi.getTasks(which);
        setItems(res.items);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  // Reload on focus (returning from detail) and on tab change
  useFocusEffect(
    useCallback(() => {
      load(tab);
    }, [tab, load])
  );

  // Realtime (W7): any task event refreshes the current tab
  useEffect(() => {
    const offAssigned = signalRService.onTaskAssigned(() => load(tab, true));
    const offChanged = signalRService.onTaskStatusChanged(() => load(tab, true));
    return () => {
      offAssigned();
      offChanged();
    };
  }, [tab, load]);

  const statusLabel = (s: TicketStatus) => t(`status.${TicketStatus[s]}`);

  const renderItem = ({ item }: { item: TaskListItem }) => (
    <TouchableOpacity
      style={[styles.card, item.isUrgent && styles.cardUrgent]}
      onPress={() => navigation.navigate('TaskDetail', { ticketId: item.ticketId })}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardLocation} numberOfLines={1}>
          {item.locationName || item.location}
          {item.roomNumber ? ` · ${t('tasks.room')} ${item.roomNumber}` : ''}
        </Text>
        {item.isUrgent && <Text style={styles.urgentBadge}>{t('tasks.urgent')}</Text>}
      </View>
      <Text style={styles.cardDescription} numberOfLines={2}>
        {item.description}
      </Text>
      <View style={styles.cardBottom}>
        <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[item.status] }]}>
          <Text style={styles.statusText}>{statusLabel(item.status)}</Text>
        </View>
        {item.category && (
          <Text style={styles.cardCategory} numberOfLines={1}>
            {categoryLabel(item.category)}
          </Text>
        )}
        <Text style={styles.cardTime}>{new Date(item.createdAt).toLocaleDateString()}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('tasks.title')}</Text>
          {agent && <Text style={styles.subtitle}>{agent.name}</Text>}
        </View>
        <TouchableOpacity onPress={logout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.logoutText}>{t('common.logout')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        {(['active', 'completed'] as TaskTab[]).map((tb) => (
          <TouchableOpacity
            key={tb}
            style={[styles.tab, tab === tb && styles.tabActive]}
            onPress={() => setTab(tb)}
          >
            <Text style={[styles.tabText, tab === tb && styles.tabTextActive]}>
              {tb === 'active' ? t('tasks.tabActive') : t('tasks.tabCompleted')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('tasks.loadError')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => load(tab)}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.ticketId}
          renderItem={renderItem}
          contentContainerStyle={items.length === 0 ? styles.center : styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(tab, true)} tintColor={colors.green} />
          }
          ListEmptyComponent={<Text style={styles.emptyText}>{t('tasks.empty')}</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.white,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.forest },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  logoutText: { color: colors.error, fontSize: 14, fontWeight: '600' },

  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  tab: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.forest },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  tabTextActive: { color: colors.white },

  list: { padding: spacing.md, gap: spacing.sm },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  emptyText: { color: colors.muted, fontSize: 14 },
  retryButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.green,
  },
  retryText: { color: colors.white, fontWeight: '700' },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardUrgent: { borderLeftWidth: 4, borderLeftColor: colors.error },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardLocation: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.forest },
  urgentBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  cardDescription: { fontSize: 14, color: colors.text, lineHeight: 20 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  statusText: { fontSize: 11, fontWeight: '700', color: colors.white },
  cardCategory: { flex: 1, fontSize: 12, color: colors.muted },
  cardTime: { fontSize: 12, color: colors.muted },
});
