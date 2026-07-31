import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import * as inboxApi from '../api/inbox';
import { AdminInbox, BacklogItem, InboxItem, InboxReason } from '../api/types';
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

/**
 * What needs the manager, and nothing else.
 *
 * Deliberately not a ticket list — the dashboard already has one, and a phone
 * list of every ticket is a list nobody opens twice. Everything here is in a
 * state that will not move without a person, and every row can be acted on
 * without leaving the screen: an inbox exists to be emptied, and a round trip
 * through a detail screen per ticket defeats that.
 */
export function InboxScreen() {
  const { t } = useTranslation();
  const { manager } = useAuth();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<AdminInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const [backlogOpen, setBacklogOpen] = useState(false);
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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const run = async (action: () => Promise<unknown>, failureKey: string) => {
    setBusy(true);
    try {
      await action();
      await load(true);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.message || t(failureKey));
    } finally {
      setBusy(false);
    }
  };

  const openActions = (item: InboxItem) => {
    const buttons: any[] = [];

    if (item.reason === InboxReason.AwaitingClosure) {
      buttons.push({
        text: t('inbox.action.close'),
        onPress: () => run(() => inboxApi.closeTicket(item.ticketId), 'inbox.actionError'),
      });
    }

    buttons.push({
      text: item.isUrgent ? t('inbox.action.unsetUrgent') : t('inbox.action.setUrgent'),
      onPress: () => run(() => inboxApi.setUrgent(item.ticketId, !item.isUrgent), 'inbox.actionError'),
    });

    // Assigning needs a person picked from a location- and category-scoped
    // list, so it opens its own sheet rather than guessing.
    buttons.push({
      text: t('inbox.action.assign'),
      onPress: () => openAssign(item),
    });

    if (item.reason !== InboxReason.AwaitingClosure) {
      buttons.push({
        text: t('inbox.action.close'),
        style: 'destructive',
        onPress: () => run(() => inboxApi.closeTicket(item.ticketId), 'inbox.actionError'),
      });
    }

    buttons.push({ text: t('common.cancel'), style: 'cancel' });

    Alert.alert(
      item.locationName || item.location,
      `${item.ticketId}\n\n${item.description}`,
      buttons
    );
  };

  const openAssign = async (item: InboxItem) => {
    try {
      const res = await inboxApi.getForwardOptions(item.ticketId);
      if (res.options.length === 0) {
        Alert.alert(t('inbox.action.assign'), t('inbox.noAssignees'));
        return;
      }
      Alert.alert(
        t('inbox.action.assign'),
        res.categoryName
          ? t('inbox.assignForCategory', { category: res.categoryName })
          : item.ticketId,
        [
          ...res.options.slice(0, 8).map((o) => ({
            // The server sorts recommended-first; the marker keeps that
            // visible in a plain alert list.
            text: `${o.matchesCategory ? '★ ' : ''}${o.name}`,
            onPress: () => run(() => inboxApi.forwardTicket(item.ticketId, o.id), 'inbox.actionError'),
          })),
          { text: t('common.cancel'), style: 'cancel' as const },
        ]
      );
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.message || t('inbox.actionError'));
    }
  };

  const openBacklog = async () => {
    setBacklogOpen(true);
    setSelected(new Set());
    try {
      const res = await inboxApi.getBacklog();
      setBacklog(res.items);
    } catch {
      setBacklog([]);
    }
  };

  const toggleSelected = (ticketId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const confirmBulkClose = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    Alert.alert(
      t('inbox.bulkCloseTitle'),
      t('inbox.bulkCloseBody', { count: ids.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('inbox.action.close'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await inboxApi.bulkClose(ids, 'Zatvoreno iz mobilne aplikacije');
              setBacklogOpen(false);
              setBacklog(null);
              await load(true);
            } catch (err: any) {
              Alert.alert(t('common.error'), err?.response?.data?.message || t('inbox.actionError'));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const renderItem = (item: InboxItem) => {
    const color = REASON_COLOR[item.reason];
    return (
      <TouchableOpacity
        key={item.ticketId}
        style={[styles.card, { borderLeftColor: color }]}
        activeOpacity={0.75}
        disabled={busy}
        onPress={() => openActions(item)}
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
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.green} />
        }
      >
        <Text style={styles.title}>{t('inbox.title')}</Text>
        <Text style={styles.subtitle}>{manager?.locationName || manager?.companyName || ''}</Text>

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

        {!!data?.backlogCount && (
          <TouchableOpacity style={styles.backlogRow} activeOpacity={0.7} onPress={openBacklog}>
            <View style={{ flex: 1 }}>
              <Text style={styles.backlogTitle}>{t('inbox.backlogTitle')}</Text>
              <Text style={styles.backlogBody}>
                {t('inbox.backlogBody', { count: data.backlogCount, days: data.backlogHorizonDays })}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {busy && (
        <View style={styles.busyOverlay}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      )}

      <Modal
        visible={backlogOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setBacklogOpen(false)}
      >
        <View style={styles.container}>
          <View style={[styles.sheetHeader, { paddingTop: insets.top + spacing.sm }]}>
            <TouchableOpacity onPress={() => setBacklogOpen(false)} hitSlop={10}>
              <Text style={styles.sheetClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>{t('inbox.backlogTitle')}</Text>
            <Text style={styles.sheetCount}>{selected.size || ''}</Text>
          </View>

          {backlog === null ? (
            <View style={styles.center}><ActivityIndicator color={colors.green} /></View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }}>
              <Text style={styles.bucketHint}>{t('inbox.backlogHint')}</Text>
              {backlog.map((b) => {
                const on = selected.has(b.ticketId);
                return (
                  <TouchableOpacity
                    key={b.ticketId}
                    style={[styles.card, on && styles.cardSelected, { borderLeftColor: colors.muted }]}
                    activeOpacity={0.75}
                    onPress={() => toggleSelected(b.ticketId)}
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
              })}
            </ScrollView>
          )}

          {selected.size > 0 && (
            <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + spacing.md }]}>
              <TouchableOpacity style={styles.dangerButton} onPress={confirmBulkClose} disabled={busy}>
                <Text style={styles.dangerButtonText}>
                  {t('inbox.closeSelected', { count: selected.size })}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0D111799',
    justifyContent: 'center',
    alignItems: 'center',
  },

  title: { fontSize: 24, fontWeight: '700', color: colors.forest, paddingHorizontal: spacing.xs },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2, marginBottom: spacing.lg, paddingHorizontal: spacing.xs },
  errorText: { color: colors.error, fontSize: 14, marginBottom: spacing.md, paddingHorizontal: spacing.xs },

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

  backlogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  backlogTitle: { fontSize: 15, fontWeight: '700', color: colors.forest },
  backlogBody: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 },
  chevron: { fontSize: 20, color: colors.muted },

  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetClose: { fontSize: 20, color: colors.muted, width: 24 },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.forest },
  sheetCount: { fontSize: 15, fontWeight: '700', color: colors.green, minWidth: 24, textAlign: 'right' },
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
  sheetFooter: {
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
