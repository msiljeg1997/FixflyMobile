import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import * as inboxApi from '../api/inbox';
import { AdminInbox, BacklogItem, InboxItem, InboxReason } from '../api/types';
import { ManagerTicketSheet } from '../components/ManagerTicketSheet';
import { AssignedTab } from '../components/AssignedTab';
import { formatDuration } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

// Each reason gets a colour so the list reads at a glance: unowned is the
// alarm, the middle two are shades of "soon", closure is done-and-waiting.
const REASON_COLOR: Record<InboxReason, string> = {
  [InboxReason.Unowned]: colors.error,
  [InboxReason.UrgentUnaccepted]: colors.error,
  [InboxReason.StaleInPool]: colors.warning,
  [InboxReason.AcceptanceExpiring]: colors.warning,
  [InboxReason.AwaitingClosure]: colors.statusDone,
};

const REASON_KEY: Record<InboxReason, string> = {
  [InboxReason.Unowned]: 'unowned',
  [InboxReason.UrgentUnaccepted]: 'urgentUnaccepted',
  [InboxReason.StaleInPool]: 'staleInPool',
  [InboxReason.AcceptanceExpiring]: 'acceptanceExpiring',
  [InboxReason.AwaitingClosure]: 'awaitingClosure',
};

type Tab = 'todo' | 'assigned' | 'cleanup';

/**
 * A manager's tickets: what needs a decision, and what needs clearing out.
 *
 * Deliberately not every ticket — the dashboard already lists those, and a
 * phone list of everything is a list nobody opens twice. The two tabs are the
 * two different jobs: acting on what still matters, and closing out what has
 * been dead for months.
 */
export function InboxScreen() {
  const { t } = useTranslation();
  const { manager } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  const [tab, setTab] = useState<Tab>('todo');
  const [data, setData] = useState<AdminInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const [openTicket, setOpenTicket] = useState<string | null>(null);

  const [backlog, setBacklog] = useState<BacklogItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true);
    setError(false);
    try {
      setData(await inboxApi.getInbox());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadBacklog = useCallback(async () => {
    try {
      const res = await inboxApi.getBacklog();
      setBacklog(res.items);
    } catch {
      setBacklog([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openCleanup = () => {
    setTab('cleanup');
    setSelected(new Set());
    if (backlog === null) loadBacklog();
  };

  const toggleSelected = (ticketId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const allSelected = !!backlog && backlog.length > 0 && selected.size === backlog.length;
  const toggleAll = () => {
    if (!backlog) return;
    setSelected(allSelected ? new Set() : new Set(backlog.map((b) => b.ticketId)));
  };

  const confirmBulkClose = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    Alert.alert(t('inbox.bulkCloseTitle'), t('inbox.bulkCloseBody', { count: ids.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('inbox.action.close'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await inboxApi.bulkClose(ids, 'Zatvoreno iz mobilne aplikacije');
            setSelected(new Set());
            await Promise.all([load(true), loadBacklog()]);
          } catch (err: any) {
            Alert.alert(t('common.error'), err?.response?.data?.message || t('inbox.actionError'));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const renderItem = (item: InboxItem) => {
    const color = REASON_COLOR[item.reason];
    return (
      <TouchableOpacity
        key={item.ticketId}
        style={[styles.card, { borderLeftColor: color }]}
        activeOpacity={0.75}
        onPress={() => setOpenTicket(item.ticketId)}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardLocation} numberOfLines={1}>
            {item.locationName || item.location}
          </Text>
          {item.isUrgent && <Text style={styles.urgentBadge}>{t('tasks.urgent')}</Text>}
        </View>
        {item.categoryName && (
          <Text style={styles.cardCategory} numberOfLines={1}>{item.categoryName}</Text>
        )}
        <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
        <View style={styles.cardBottom}>
          {/* The waiting time is the point of the row — how long this has been
              nobody's problem. */}
          <Text style={[styles.waiting, { color }]}>
            {t('inbox.waiting', { duration: formatDuration(item.waitingMinutes) })}
          </Text>
          {item.assignedAgentName && (
            <Text style={styles.assignee} numberOfLines={1}>{item.assignedAgentName}</Text>
          )}
          {item.reason === InboxReason.AwaitingClosure && item.resolutionPhotoCount > 0 && (
            <Text style={styles.photoCount}>📷 {item.resolutionPhotoCount}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green} size="large" />
      </View>
    );
  }

  const isClear = !!data && data.totalCount === 0;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>{t('inbox.title')}</Text>
        <Text style={styles.subtitle}>{manager?.locationName || manager?.companyName || ''}</Text>

        {/* Cleanup is a tab, not a row at the bottom of the list: with a long
            queue that row is several screens down, exactly when there is most
            to clear. */}
        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentItem, tab === 'todo' && styles.segmentItemActive]}
            onPress={() => setTab('todo')}
          >
            <Text style={[styles.segmentText, tab === 'todo' && styles.segmentTextActive]} numberOfLines={1}>
              {t('inbox.tabTodo')} {data ? `(${data.totalCount})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentItem, tab === 'assigned' && styles.segmentItemActive]}
            onPress={() => setTab('assigned')}
          >
            <Text style={[styles.segmentText, tab === 'assigned' && styles.segmentTextActive]}>
              {t('assigned.tab')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentItem, tab === 'cleanup' && styles.segmentItemActive]}
            onPress={openCleanup}
          >
            <Text style={[styles.segmentText, tab === 'cleanup' && styles.segmentTextActive]} numberOfLines={1}>
              {t('inbox.tabCleanup')} {data ? `(${data.backlogCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {tab === 'assigned' ? (
        <AssignedTab onOpenTicket={setOpenTicket} />
      ) : tab === 'todo' ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.green} />
          }
        >
          {error && <Text style={styles.errorText}>{t('inbox.loadError')}</Text>}

          {isClear && (
            // Reaching zero is the goal, so it is stated — a blank screen would
            // read as a failure to load.
            <View style={styles.clearBox}>
              <Text style={styles.clearIcon}>✓</Text>
              <Text style={styles.clearTitle}>{t('inbox.allClear')}</Text>
              <Text style={styles.clearBody}>{t('inbox.allClearBody')}</Text>
            </View>
          )}

          {data?.buckets.map((bucket) => (
            <View key={bucket.reason} style={styles.bucket}>
              <View style={styles.bucketHeader}>
                <View style={[styles.bucketDot, { backgroundColor: REASON_COLOR[bucket.reason] }]} />
                <Text style={styles.bucketTitle}>{t(`inbox.reason.${REASON_KEY[bucket.reason]}`)}</Text>
                <Text style={styles.bucketCount}>{bucket.count}</Text>
              </View>
              <Text style={styles.bucketHint}>{t(`inbox.hint.${REASON_KEY[bucket.reason]}`)}</Text>
              {bucket.items.map(renderItem)}
              {bucket.count > bucket.items.length && (
                <Text style={styles.more}>
                  {t('inbox.andMore', { count: bucket.count - bucket.items.length })}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      ) : (
        <>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 }]}>
            <Text style={styles.bucketHint}>
              {t('inbox.backlogHint', { days: data?.backlogHorizonDays ?? 7 })}
            </Text>

            {backlog !== null && backlog.length > 0 && (
              <TouchableOpacity style={styles.selectAllRow} onPress={toggleAll} activeOpacity={0.7}>
                <Text style={[styles.checkbox, allSelected && styles.checkboxOn]}>
                  {allSelected ? '✓' : ''}
                </Text>
                <Text style={styles.selectAllText}>
                  {allSelected ? t('inbox.deselectAll') : t('inbox.selectAll', { count: backlog.length })}
                </Text>
              </TouchableOpacity>
            )}

            {backlog === null ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.xl }} />
            ) : backlog.length === 0 ? (
              <Text style={styles.muted}>{t('inbox.backlogEmpty')}</Text>
            ) : (
              backlog.map((b) => {
                const on = selected.has(b.ticketId);
                return (
                  <TouchableOpacity
                    key={b.ticketId}
                    style={[styles.card, on && styles.cardSelected, { borderLeftColor: colors.muted }]}
                    activeOpacity={0.75}
                    onPress={() => toggleSelected(b.ticketId)}
                    onLongPress={() => setOpenTicket(b.ticketId)}
                  >
                    <View style={styles.cardTop}>
                      <Text style={styles.cardLocation} numberOfLines={1}>
                        {b.locationName || b.location}
                      </Text>
                      <Text style={[styles.checkbox, on && styles.checkboxOn]}>{on ? '✓' : ''}</Text>
                    </View>
                    <Text style={styles.cardDescription} numberOfLines={2}>{b.description}</Text>
                    <Text style={styles.cardCategory}>
                      {t('inbox.ageDays', { count: b.ageDays })}
                      {b.categoryName ? ` · ${b.categoryName}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          {selected.size > 0 && (
            <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
              <TouchableOpacity style={styles.dangerButton} onPress={confirmBulkClose} disabled={busy}>
                <Text style={styles.dangerButtonText}>
                  {t('inbox.closeSelected', { count: selected.size })}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      )}

      <ManagerTicketSheet
        ticketId={openTicket}
        visible={openTicket !== null}
        onClose={() => setOpenTicket(null)}
        onChanged={() => {
          load(true);
          if (tab === 'cleanup') loadBacklog();
        }}
        onOpenChat={(ticketId, title) => {
          // Dismiss first: navigating out from under a presented modal leaves
          // iOS showing it over a screen that is no longer there.
          setOpenTicket(null);
          navigation.navigate('ChatTab', { screen: 'Chat', params: { ticketId, title } });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  muted: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0D111799',
    justifyContent: 'center',
    alignItems: 'center',
  },

  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  title: { fontSize: 24, fontWeight: '700', color: colors.forest },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2, marginBottom: spacing.md },
  errorText: { color: colors.error, fontSize: 14, marginBottom: spacing.md },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.xs + 3,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: { backgroundColor: colors.green },
  // Three labels in one row: a size down, and no wrapping.
  segmentText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  segmentTextActive: { color: colors.white },

  clearBox: { alignItems: 'center', paddingVertical: spacing.xl },
  clearIcon: { fontSize: 44, color: colors.green, marginBottom: spacing.sm },
  clearTitle: { fontSize: 17, fontWeight: '700', color: colors.forest },
  clearBody: { fontSize: 14, color: colors.muted, marginTop: spacing.xs, textAlign: 'center' },

  bucket: { marginBottom: spacing.lg },
  bucketHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  bucketDot: { width: 8, height: 8, borderRadius: 4 },
  bucketTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.forest },
  bucketCount: { fontSize: 15, fontWeight: '700', color: colors.muted },
  bucketHint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    lineHeight: 17,
  },

  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.xs,
  },
  selectAllText: { fontSize: 14, fontWeight: '600', color: colors.green },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    marginBottom: spacing.sm,
  },
  cardSelected: { borderColor: colors.green },
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
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  waiting: { fontSize: 12, fontWeight: '700' },
  assignee: { flex: 1, fontSize: 12, color: colors.muted, textAlign: 'right' },
  photoCount: { fontSize: 12, color: colors.muted },
  more: { fontSize: 12, color: colors.muted, paddingHorizontal: spacing.xs, marginTop: 2 },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: 'center',
    lineHeight: 21,
    color: colors.white,
    overflow: 'hidden',
  },
  checkboxOn: { backgroundColor: colors.green, borderColor: colors.green },

  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  dangerButton: {
    backgroundColor: colors.error,
    borderRadius: radius.sm,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
