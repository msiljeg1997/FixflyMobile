import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
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
import { outbox } from '../offline/outbox';
import { taskCache } from '../offline/taskCache';
import { isNetworkError } from '../api/client';
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

  // Scope and status are two independent axes, not one flat list of tabs —
  // see the segmented controls below.
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [status, setStatus] = useState<'active' | 'completed'>('active');
  const [items, setItems] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  /** When the shown list was captured, if it came from the cache rather than the server. */
  const [staleAt, setStaleAt] = useState<number | null>(null);

  // Pagination — the API has always been paged; the app previously showed
  // only page 1, silently hiding work past the 20th task.
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search + filters (client-side over what's loaded — the list endpoint
  // takes no search params, so filtering server-side isn't available)
  const [search, setSearch] = useState('');
  const [urgentOnly, setUrgentOnly] = useState(false);

  // Tickets whose resolve is sitting in the outbox. Shown on the row so a
  // technician can see the job is recorded but not yet delivered — the whole
  // point of queueing is lost if it looks identical to nothing happening.
  const [pendingResolve, setPendingResolve] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    const sync = () => {
      outbox.pendingResolves().then((items) => {
        const map: Record<string, string | undefined> = {};
        for (const i of items) map[i.ticketId] = i.failedReason;
        setPendingResolve(map);
      });
    };
    sync();
    return outbox.subscribe(sync);
  }, []);

  // A dispatcher hands work out, so they need to see it after it leaves their
  // own queue; a technician only ever has their own two lists.
  const isDispatcher = agent?.role === AgentRole.Hausmajstor;
  const isTeam = isDispatcher && scope === 'team';
  const tab: TaskTab = isTeam
    ? status === 'active'
      ? 'teamActive'
      : 'teamCompleted'
    : status;

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
        setStaleAt(null);
        taskCache.putList(which, res.items);
      } catch (e) {
        // Offline is not the same failure as a rejected request. With no
        // network, fall back to what was last seen and say how old it is —
        // a technician in a basement needs the address of the job he is
        // standing in, and an error screen does not have it.
        const cached = isNetworkError(e) ? await taskCache.getList(which) : null;
        if (cached) {
          setItems(cached.data);
          setPage(1);
          setTotalPages(1);
          setStaleAt(cached.at);
        } else {
          setError(true);
        }
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
    // Events cover what the server managed to tell us. A dropped socket or a
    // spell in the background is the case where it could not, and the list
    // would otherwise sit on pre-drop data with nothing saying so.
    const offResync = signalRService.onResync(() => load(tab, true));
    return () => {
      offAssigned();
      offChanged();
      offResync();
    };
  }, [tab, load]);

  const statusLabel = (s: TicketStatus) => t(`status.${TicketStatus[s]}`);

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
        {item.ticketId in pendingResolve && (
          <Text style={pendingResolve[item.ticketId] ? styles.syncFailed : styles.syncPending}>
            {pendingResolve[item.ticketId] ? t('tasks.syncFailed') : t('tasks.syncPending')}
          </Text>
        )}
        <View style={styles.cardBottom}>
          <View style={[styles.statusPill, { backgroundColor: tint(statusColor) }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel(item.status)}</Text>
          </View>
          <Text style={styles.cardTime}>{formatDateTime(item.createdAt)}</Text>
        </View>
        {/* Only on the team tabs — on "my" lists the assignee is always me. */}
        {isTeam && item.assignedAgentName && (
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

      <View style={styles.filterRow}>
        {isDispatcher && (
          <View style={styles.segment}>
            {(['mine', 'team'] as const).map((s) => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.segmentItem,
                  styles.segmentItemFixed,
                  scope === s && styles.segmentItemActive,
                ]}
                onPress={() => setScope(s)}
              >
                <Text style={[styles.segmentText, scope === s && styles.segmentTextActive]}>
                  {t(`tasks.scope_${s}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={[styles.segment, styles.segmentGrow]}>
          {(['active', 'completed'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              style={[
                styles.segmentItem,
                styles.segmentItemGrow,
                status === s && styles.segmentItemActive,
              ]}
              onPress={() => setStatus(s)}
            >
              <Text
                style={[styles.segmentText, status === s && styles.segmentTextActive]}
                numberOfLines={1}
              >
                {t(`tasks.tab_${s}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.searchRow}>
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
        {/* Urgent is a filter, not a view — it belongs with search, not with
            the tabs it used to sit among. */}
        <TouchableOpacity
          style={[styles.urgentToggle, urgentOnly && styles.urgentToggleActive]}
          onPress={() => setUrgentOnly((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: urgentOnly }}
          accessibilityLabel={t('tasks.urgent')}
        >
          <Text style={[styles.urgentToggleText, urgentOnly && styles.urgentToggleTextActive]}>⚠</Text>
        </TouchableOpacity>
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
        <>
        {/* Cached data without its age on it is what makes people trust a
            stale screen. The date is the whole point of the bar. */}
        {staleAt !== null && (
          <View style={styles.offlineBar}>
            <Text style={styles.offlineBarText}>
              {t('tasks.offlineAsOf', { when: formatDateTime(new Date(staleAt).toISOString()) })}
            </Text>
          </View>
        )}
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.ticketId}
          renderItem={renderItem}
          contentContainerStyle={visibleItems.length === 0 ? styles.center : styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  offlineBar: {
    backgroundColor: tint(colors.statusAccepted, '1F'),
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  offlineBarText: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.forest },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },

  // Two fixed segmented controls instead of one horizontally scrolling chip
  // row. The old row was a horizontal ScrollView, and RN gives those
  // flexGrow: 1 by default — so it stole the leftover column height and
  // vertically centred the chips inside it. Every tab switch changed how
  // much space the list wanted, the leftover was re-split, and the whole
  // header visibly jumped. Nothing here grows or scrolls, so nothing moves.
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segmentGrow: { flex: 1 },
  segmentItem: {
    paddingVertical: spacing.xs + 3,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Only inside the flex:1 status segment. `flex: 1` sets flexBasis: 0, which
  // in the content-sized scope segment would collapse both halves to nothing —
  // there the items size to their labels, with minWidth keeping them even.
  segmentItemGrow: { flex: 1 },
  segmentItemFixed: { minWidth: 52 },
  segmentItemActive: { backgroundColor: colors.green },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.muted },
  segmentTextActive: { color: colors.white },

  assigneeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  assigneeIcon: { fontSize: 11 },
  assigneeName: { fontSize: 12, color: colors.muted, fontWeight: '600', flex: 1 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, color: colors.forest, fontSize: 15, paddingVertical: spacing.sm + 2 },
  searchClear: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  urgentToggle: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  urgentToggleActive: { backgroundColor: tint(colors.error), borderColor: colors.error },
  urgentToggleText: { fontSize: 16, color: colors.muted },
  urgentToggleTextActive: { color: colors.error },

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
  syncPending: { fontSize: 11, color: colors.warning, fontWeight: '700', marginTop: 2 },
  syncFailed: { fontSize: 11, color: colors.error, fontWeight: '700', marginTop: 2 },
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
