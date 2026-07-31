import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as inboxApi from '../api/inbox';
import type { AssignedTicket, FilterAgent, FilterLocation } from '../api/inbox';
import { TicketStatus } from '../api/types';
import { formatDateTime } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

const STATUS_COLORS: Record<number, string> = {
  [TicketStatus.ForwardedToTechnician]: colors.statusForwarded,
  [TicketStatus.Accepted]: colors.statusAccepted,
};

const PAGE_SIZE = 10;

/**
 * The inbox's complement: tickets somebody owns and is working.
 *
 * Nothing here needs the manager — that is the point. It answers "who is on
 * what, where", which is the other half of the question the inbox asks, and
 * why it carries filters instead of buckets.
 *
 * Filtering and paging are the server's. A company with thousands of open
 * tickets would otherwise be sending all of them to a phone to be sliced
 * locally.
 */
export function AssignedTab({ onOpenTicket }: { onOpenTicket: (ticketId: string) => void }) {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);
  const [data, setData] = useState<inboxApi.AssignedPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [agentId, setAgentId] = useState<number | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [agents, setAgents] = useState<FilterAgent[]>([]);
  const [locations, setLocations] = useState<FilterLocation[]>([]);
  const [picker, setPicker] = useState<'agent' | 'location' | null>(null);
  const [query, setQuery] = useState('');

  // The query belongs to one opening of the picker; leaving it behind means
  // the next open silently shows a filtered list with an empty search box.
  const closePicker = () => { setPicker(null); setQuery(''); };

  const needle = query.trim().toLowerCase();
  const visibleAgents = agents
    // Dispatchers hold tickets too — filtering them out would hide most of
    // what is actually assigned.
    .filter((a) => a.isActive)
    .filter((a) => !needle || a.name.toLowerCase().includes(needle));
  // Matched on code as well: half these venues are named "hotdsa213", and the
  // code is the only thing that tells them apart.
  const visibleLocations = locations.filter(
    (l) => !needle || l.name.toLowerCase().includes(needle) || l.code.toLowerCase().includes(needle)
  );

  const load = useCallback(
    async (targetPage: number, asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        setData(await inboxApi.getAssigned({ page: targetPage, pageSize: PAGE_SIZE, agentId, location }));
        setPage(targetPage);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [agentId, location]
  );

  // Any filter change restarts at page one — staying on page 4 of a list that
  // just became three items long shows an empty screen that looks broken.
  useEffect(() => {
    load(1);
  }, [load]);

  useEffect(() => {
    inboxApi.getAgentsForFilter().then(setAgents).catch(() => setAgents([]));
    inboxApi.getLocationsForFilter().then(setLocations).catch(() => setLocations([]));
  }, []);

  const agentName = agents.find((a) => a.id === agentId)?.name;
  const locationName = locations.find((l) => l.code === location)?.name;

  const renderRow = (item: AssignedTicket) => {
    const color = STATUS_COLORS[item.status] ?? colors.muted;
    return (
      <TouchableOpacity
        key={item.ticketId}
        style={[styles.card, { borderLeftColor: color }]}
        activeOpacity={0.75}
        onPress={() => onOpenTicket(item.ticketId)}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardLocation} numberOfLines={1}>
            {locations.find((l) => l.code === item.location)?.name || item.location}
          </Text>
          {item.isUrgent && <Text style={styles.urgentBadge}>{t('tasks.urgent')}</Text>}
        </View>
        <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>
        <View style={styles.cardBottom}>
          <View style={[styles.statusPill, { backgroundColor: tint(color) }]}>
            <Text style={[styles.statusText, { color }]}>
              {t(`status.${TicketStatus[item.status]}`)}
            </Text>
          </View>
          <Text style={styles.who} numberOfLines={1}>
            {item.assignedAgent?.name ?? '—'}
          </Text>
        </View>
        <Text style={styles.when}>{formatDateTime(item.forwardedAt || item.createdAt)}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.flex}>
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, agentId !== null && styles.filterChipActive]}
          onPress={() => setPicker('agent')}
        >
          <Text style={[styles.filterText, agentId !== null && styles.filterTextActive]} numberOfLines={1}>
            {agentName ?? t('assigned.allTechnicians')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterChip, location !== null && styles.filterChipActive]}
          onPress={() => setPicker('location')}
        >
          <Text style={[styles.filterText, location !== null && styles.filterTextActive]} numberOfLines={1}>
            {locationName ?? t('assigned.allLocations')}
          </Text>
        </TouchableOpacity>
        {(agentId !== null || location !== null) && (
          <TouchableOpacity
            style={styles.clearChip}
            onPress={() => { setAgentId(null); setLocation(null); }}
          >
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.green} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(page, true)} tintColor={colors.green} />
          }
        >
          {!data || data.items.length === 0 ? (
            <Text style={styles.empty}>{t('assigned.empty')}</Text>
          ) : (
            <>
              {data.items.map(renderRow)}

              {data.totalPages > 1 && (
                <View style={styles.pager}>
                  <TouchableOpacity
                    style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
                    disabled={page <= 1}
                    onPress={() => load(page - 1)}
                  >
                    <Text style={styles.pageBtnText}>‹</Text>
                  </TouchableOpacity>
                  <Text style={styles.pageInfo}>
                    {t('assigned.pageOf', { page: data.page, total: data.totalPages })}
                  </Text>
                  <TouchableOpacity
                    style={[styles.pageBtn, page >= data.totalPages && styles.pageBtnDisabled]}
                    disabled={page >= data.totalPages}
                    onPress={() => load(page + 1)}
                  >
                    <Text style={styles.pageBtnText}>›</Text>
                  </TouchableOpacity>
                </View>
              )}
              <Text style={styles.total}>{t('assigned.total', { count: data.totalCount })}</Text>
            </>
          )}
        </ScrollView>
      )}

      {/* Fills the tab rather than sitting on the bottom edge, and the search
          box is the first thing under the title. A bottom-anchored sheet puts
          the input right where the keyboard appears — KeyboardAvoidingView is
          unreliable inside an absolutely positioned overlay, and this sidesteps
          the question: the keyboard covers the tail of a scrollable list, which
          is exactly what a keyboard is supposed to do. */}
      {picker !== null && (
        <View style={styles.pickerOverlay}>
            <View style={styles.pickerPanel}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>
                  {picker === 'agent' ? t('assigned.filterTechnician') : t('assigned.filterLocation')}
                </Text>
                <TouchableOpacity onPress={closePicker} hitSlop={12}>
                  <Text style={styles.pickerClose}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.searchWrap}>
                <Text style={styles.searchIcon}>🔎</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder={
                    picker === 'agent' ? t('assigned.searchTechnician') : t('assigned.searchLocation')
                  }
                  placeholderTextColor={colors.muted}
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {query.length > 0 && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
                    <Text style={styles.searchClear}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                {/* The "all" reset stays out of the search results — it is not a
                    row you look for by name, and hiding it would strand anyone
                    who typed before clearing the filter. */}
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => {
                    if (picker === 'agent') setAgentId(null);
                    else setLocation(null);
                    closePicker();
                  }}
                >
                  <Text style={styles.pickerRowText}>
                    {picker === 'agent' ? t('assigned.allTechnicians') : t('assigned.allLocations')}
                  </Text>
                </TouchableOpacity>

                {picker === 'agent' ? (
                  visibleAgents.length === 0 ? (
                    <Text style={styles.noMatches}>{t('assigned.noMatches')}</Text>
                  ) : (
                    visibleAgents.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={styles.pickerRow}
                        onPress={() => { setAgentId(a.id); closePicker(); }}
                      >
                        <Text style={[styles.pickerRowText, agentId === a.id && styles.pickerRowActive]}>
                          {a.name}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )
                ) : visibleLocations.length === 0 ? (
                  <Text style={styles.noMatches}>{t('assigned.noMatches')}</Text>
                ) : (
                  visibleLocations.map((l) => (
                    <TouchableOpacity
                      key={l.id}
                      style={styles.pickerRow}
                      onPress={() => { setLocation(l.code); closePicker(); }}
                    >
                      <Text style={[styles.pickerRowText, location === l.code && styles.pickerRowActive]}>
                        {l.name}
                      </Text>
                      {/* Two venues can share a name — the code is what tells
                          them apart, and this data already has three. */}
                      <Text style={styles.pickerRowSub}>{l.code}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xl },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },

  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filterChip: {
    flex: 1,
    paddingVertical: spacing.xs + 3,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { borderColor: colors.green, backgroundColor: tint(colors.green) },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.muted, textAlign: 'center' },
  filterTextActive: { color: colors.green },
  clearChip: {
    width: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: colors.muted, fontSize: 13, fontWeight: '700' },

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
  cardDescription: { fontSize: 14, color: colors.text, lineHeight: 20, marginTop: 2 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: '700' },
  who: { flex: 1, fontSize: 12, color: colors.muted, fontWeight: '600', textAlign: 'right' },
  when: { fontSize: 11, color: colors.muted },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginTop: spacing.md },
  pageBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { color: colors.forest, fontSize: 18, fontWeight: '700' },
  pageInfo: { fontSize: 13, color: colors.text, fontWeight: '600', minWidth: 90, textAlign: 'center' },
  total: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: spacing.sm },

  pickerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface, zIndex: 20 },
  pickerPanel: { flex: 1, backgroundColor: colors.surface, paddingTop: spacing.md },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  pickerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.forest },
  pickerClose: { fontSize: 20, color: colors.muted },
  // Grows into whatever the keyboard leaves, instead of a fixed height that
  // would be half-hidden behind it.
  pickerList: { flex: 1 },
  pickerRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  pickerRowText: { fontSize: 15, color: colors.text },
  pickerRowSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  pickerRowActive: { color: colors.green, fontWeight: '700' },
  noMatches: { fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: spacing.xl },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, color: colors.forest, fontSize: 15, paddingVertical: spacing.sm + 2 },
  searchClear: { color: colors.muted, fontSize: 15, fontWeight: '700' },
});
