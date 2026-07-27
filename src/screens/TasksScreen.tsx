import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { signalRService } from '../realtime/signalr';
import * as tasksApi from '../api/tasks';
import { AgentRole, TaskListItem, TaskTab, TicketStatus } from '../api/types';
import type { TasksStackParamList } from '../navigation/TasksStackNavigator';
import { categoryLabel, formatDateTime } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

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
  const { agent } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<TasksStackParamList>>();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<TaskTab>('active');
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  // Pagination — the API has always been paged; the app previously showed
  // only page 1, silently hiding work past the 20th task.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search + filters (client-side over what's loaded — the list endpoint
  // takes no search params, so filtering server-side isn't available)
  const [search, setSearch] = useState('');
  const [urgentOnly, setUrgentOnly] = useState(false);

  const load = useCallback(
    async (which: TaskTab, asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      else setLoading(true);
      setError(false);
      try {
        const res = await tasksApi.getTasks(which, 1);
        setItems(res.items);
        setPage(res.page);
        setTotalPages(res.totalPages);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || refreshing || page >= totalPages) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await tasksApi.getTasks(tab, next);
      // De-dupe by ticketId: a task can shift between pages if something
      // changed server-side between requests.
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.ticketId));
        return [...prev, ...res.items.filter((i) => !seen.has(i.ticketId))];
      });
      setPage(res.page);
      setTotalPages(res.totalPages);
    } catch {
      // Keep what's already loaded; pull-to-refresh is the recovery path.
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loading, refreshing, page, totalPages, tab]);

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

  // A dispatcher hands work out, so they need to see it after it leaves their
  // own queue; a technician only ever has their own two lists.
  const isDispatcher = agent?.role === AgentRole.Hausmajstor;
  const tabs: TaskTab[] = isDispatcher
    ? ['active', 'completed', 'teamActive', 'teamCompleted']
    : ['active', 'completed'];
  const tabLabel = (tb: TaskTab) =>
    isDispatcher ? t(`tasks.tab_${tb}_dispatcher`) : t(`tasks.tab_${tb}`);

  const query = search.trim().toLowerCase();
  const visibleItems = items.filter((i) => {
    if (urgentOnly && !i.isUrgent) return false;
    if (!query) return true;
    return (
      i.description.toLowerCase().includes(query) ||
      (i.locationName ?? '').toLowerCase().includes(query) ||
      i.location.toLowerCase().includes(query) ||
      i.ticketId.toLowerCase().includes(query) ||
      (i.category?.name ?? '').toLowerCase().includes(query)
    );
  });

  const isTeamTab = tab === 'teamActive' || tab === 'teamCompleted';

  const renderItem = ({ item }: { item: TaskListItem }) => {
    const statusColor = STATUS_COLORS[item.status];
    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: statusColor }]}
        onPress={() => navigation.navigate('TaskDetail', { ticketId: item.ticketId })}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardLocation} numberOfLines={1}>
            {item.locationName || item.location}
            {item.roomNumber ? ` · ${t('tasks.room')} ${item.roomNumber}` : ''}
          </Text>
          {item.isUrgent && <Text style={styles.urgentBadge}>{t('tasks.urgent')}</Text>}
        </View>
        {item.category && (
          <Text style={styles.cardCategory} numberOfLines={1}>
            {categoryLabel(item.category)}
          </Text>
        )}
        <Text style={styles.cardDescription} numberOfLines={2}>
          {item.description}
        </Text>
        <View style={styles.cardBottom}>
          <View style={[styles.statusPill, { backgroundColor: tint(statusColor) }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel(item.status)}</Text>
          </View>
          <Text style={styles.cardTime}>{formatDateTime(item.createdAt)}</Text>
        </View>
        {/* Only on the team tabs — on "my" lists the assignee is always me. */}
        {isTeamTab && item.assignedAgentName && (
          <View style={styles.assigneeRow}>
            <Text style={styles.assigneeIcon}>👷</Text>
            <Text style={styles.assigneeName} numberOfLines={1}>{item.assignedAgentName}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>{t('tasks.title')}</Text>
        {agent && <Text style={styles.subtitle}>{agent.name}</Text>}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        keyboardShouldPersistTaps="handled"
      >
        {tabs.map((tb) => (
          <TouchableOpacity
            key={tb}
            style={[styles.tab, tab === tb && styles.tabActive]}
            onPress={() => setTab(tb)}
          >
            <Text style={[styles.tabText, tab === tb && styles.tabTextActive]}>{tabLabel(tb)}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.tab, urgentOnly && styles.tabActive]}
          onPress={() => setUrgentOnly((v) => !v)}
        >
          <Text style={[styles.tabText, urgentOnly && styles.tabTextActive]}>⚠ {t('tasks.urgent')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔎</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={t('tasks.searchPlaceholder')}
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={10}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
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
          data={visibleItems}
          keyExtractor={(item) => item.ticketId}
          renderItem={renderItem}
          contentContainerStyle={visibleItems.length === 0 ? styles.center : styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(tab, true)} tintColor={colors.green} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.muted} style={{ marginVertical: spacing.md }} /> : null
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {query || urgentOnly ? t('tasks.noMatches') : t('tasks.empty')}
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.forest },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },

  // Horizontally scrollable: a dispatcher has five chips (four tabs +
  // urgent filter), which don't fit a phone width.
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    alignItems: 'center',
  },
  tab: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.green, borderColor: colors.green },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  tabTextActive: { color: colors.white },

  assigneeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  assigneeIcon: { fontSize: 11 },
  assigneeName: { fontSize: 12, color: colors.muted, fontWeight: '600', flex: 1 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, color: colors.forest, fontSize: 15, paddingVertical: spacing.sm + 2 },
  searchClear: { color: colors.muted, fontSize: 15, fontWeight: '700' },

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
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardLocation: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.forest },
  urgentBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
    backgroundColor: tint(colors.error),
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  cardCategory: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  cardDescription: { fontSize: 14, color: colors.text, lineHeight: 20, marginTop: 2 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusText: { fontSize: 11, fontWeight: '700' },
  cardTime: { fontSize: 11, color: colors.muted },
});
