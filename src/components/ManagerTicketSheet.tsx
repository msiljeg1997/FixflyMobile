import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as inboxApi from '../api/inbox';
import type { ForwardOption } from '../api/inbox';
import { AdminTicketDetail, AgentAvailability, TicketStatus } from '../api/types';
import { formatDateTime, getInitials } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

const STATUS_COLORS: Record<TicketStatus, string> = {
  [TicketStatus.New]: colors.statusNew,
  [TicketStatus.ForwardedToTechnician]: colors.statusForwarded,
  [TicketStatus.Accepted]: colors.statusAccepted,
  [TicketStatus.Returned]: colors.statusReturned,
  [TicketStatus.Done]: colors.statusDone,
  [TicketStatus.Closed]: colors.statusClosed,
};

const AVAILABILITY_COLOR: Record<AgentAvailability, string> = {
  [AgentAvailability.Available]: colors.green,
  [AgentAvailability.OnBreak]: colors.warning,
  [AgentAvailability.DayOff]: colors.muted,
};

/**
 * A manager's view of one ticket, and the actions on it.
 *
 * The inbox card carries only enough to decide whether to look; deciding what
 * to DO needs the rest — who reported it and how to reach them, what the
 * technician said when handing it back, and for a resolved ticket the proof
 * photos, which are the entire reason a manager is asked to close it.
 */
export function ManagerTicketSheet({
  ticketId,
  visible,
  onClose,
  onChanged,
  onOpenChat,
}: {
  ticketId: string | null;
  visible: boolean;
  onClose: () => void;
  /** Optional message the caller shows as a confirmation. */
  onChanged: (message?: string) => void;
  /** Handed up because the chat lives in another tab — the sheet must be
   *  dismissed before navigating, or iOS is left presenting over nothing. */
  onOpenChat: (ticketId: string, title: string) => void;
}) {
  const { t } = useTranslation();
  const { isVenueManager } = useAuth();
  const insets = useSafeAreaInsets();

  const [ticket, setTicket] = useState<AdminTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      setTicket(await inboxApi.getTicket(ticketId));
    } catch {
      setTicket(null);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const run = async (action: () => Promise<unknown>, close = false, message?: string) => {
    setBusy(true);
    try {
      await action();
      onChanged(message);
      if (close) onClose();
      else await load();
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.message || t('inbox.actionError'));
    } finally {
      setBusy(false);
    }
  };

  const confirmClose = () => {
    Alert.alert(t('inbox.action.close'), t('inbox.closeConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('inbox.action.close'),
        style: 'destructive',
        onPress: () => run(() => inboxApi.closeTicket(ticketId!), true, t('inbox.toastClosed')),
      },
    ]);
  };

  const statusColor = ticket ? STATUS_COLORS[ticket.status] : colors.muted;
  const canAct = !!ticket && ticket.status !== TicketStatus.Closed && !isVenueManager;
  // A venue manager still gets the chat button — it is the whole point of
  // their app. It sits alone rather than inside the action footer, which
  // they never see.
  const chatOnly = !!ticket && isVenueManager;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {ticket?.locationName || ticket?.location || ''}
          </Text>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.green} size="large" /></View>
        ) : !ticket ? (
          <View style={styles.center}><Text style={styles.muted}>{t('inbox.loadError')}</Text></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 140 }}>
            <View style={styles.topRow}>
              <View style={[styles.statusPill, { backgroundColor: tint(statusColor) }]}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {t(`status.${TicketStatus[ticket.status]}`)}
                </Text>
              </View>
              {ticket.isUrgent && <Text style={styles.urgentBadge}>{t('tasks.urgent')}</Text>}
            </View>

            <Text style={styles.ticketId}>{ticket.ticketId}</Text>
            <Text style={styles.description}>{ticket.description}</Text>

            {ticket.category && <Field label={t('inbox.field.category')} value={ticket.category.name} />}
            {ticket.roomNumber && <Field label={t('tasks.room')} value={ticket.roomNumber} />}
            {!!ticket.locationAddress && (
              <Field label={t('taskDetail.locationInfo')} value={ticket.locationAddress} />
            )}
            {/* Every phone number here is one a manager rings while standing
                somewhere — so each is a tap, not a number to memorise. */}
            {!!(ticket.locationContactName || ticket.locationContactPhone) && (
              <Field
                label={t('taskDetail.contact')}
                value={[ticket.locationContactName, ticket.locationContactPhone].filter(Boolean).join(' · ')}
                phone={ticket.locationContactPhone}
                callLabel={t('taskDetail.call')}
              />
            )}
            {ticket.reporterPhone && (
              <Field
                label={t('inbox.field.reporter')}
                value={ticket.reporterPhone}
                phone={ticket.reporterPhone}
                callLabel={t('taskDetail.call')}
              />
            )}
            {ticket.assignedAgent && (
              <Field
                label={t('inbox.field.assigned')}
                value={`${ticket.assignedAgent.name} · ${ticket.assignedAgent.phoneNumber}`}
                phone={ticket.assignedAgent.phoneNumber}
                callLabel={t('taskDetail.call')}
              />
            )}

            {/* Why it came back is the manager's whole decision on an unowned
                ticket — never buried below the timeline. */}
            {!!ticket.returnReason && (
              <View style={styles.calloutWarn}>
                <Text style={styles.calloutLabel}>{t('inbox.field.returnReason')}</Text>
                <Text style={styles.calloutText}>{ticket.returnReason}</Text>
              </View>
            )}

            {!!ticket.imageUrl && (
              <>
                <Text style={styles.sectionLabel}>{t('inbox.field.guestPhoto')}</Text>
                <Image source={{ uri: ticket.imageUrl }} style={styles.photo} resizeMode="cover" />
              </>
            )}

            {(!!ticket.resolutionComment || ticket.resolutionPhotos.length > 0) && (
              <View style={styles.calloutOk}>
                <Text style={styles.calloutLabel}>{t('inbox.field.resolution')}</Text>
                {!!ticket.resolutionComment && (
                  <Text style={styles.calloutText}>{ticket.resolutionComment}</Text>
                )}
                {ticket.resolutionPhotos.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
                    {ticket.resolutionPhotos.map((p) => (
                      <Image key={p.id} source={{ uri: p.url }} style={styles.proofPhoto} resizeMode="cover" />
                    ))}
                  </ScrollView>
                )}
              </View>
            )}

            <Text style={styles.sectionLabel}>{t('inbox.field.timeline')}</Text>
            <TimeRow label={t('inbox.time.created')} value={ticket.createdAt} />
            <TimeRow label={t('inbox.time.forwarded')} value={ticket.forwardedAt} />
            <TimeRow label={t('inbox.time.accepted')} value={ticket.acceptedAt} />
            <TimeRow label={t('inbox.time.done')} value={ticket.doneAt} />

            {/* The same activity trail the technician and dispatcher see. It
                carries the forwarding comments and rejection notes, which is
                where the story of a stuck ticket actually lives — the status
                timestamps above only say when, never why. Boxed and scrollable
                so a long history doesn't push the actions off the screen. */}
            {ticket.history.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>{t('taskDetail.history')}</Text>
                <ScrollView style={styles.historyBox} nestedScrollEnabled>
                  {ticket.history.map((h, i) => (
                    <View key={h.id} style={[styles.historyRow, i > 0 && styles.historyRowDivider]}>
                      <View style={[styles.historyDot, { backgroundColor: STATUS_COLORS[h.newStatus] }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.historyStatus}>
                          {t(`status.${TicketStatus[h.newStatus]}`)}
                          {h.targetAgentName ? ` → ${h.targetAgentName}` : ''}
                        </Text>
                        <Text style={styles.historyMeta}>
                          {h.changedByName || t('taskDetail.system')} · {formatDateTime(h.changedAt)}
                        </Text>
                        {!!h.notes && <Text style={styles.historyNote}>{h.notes}</Text>}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
          </ScrollView>
        )}

        {canAct && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.secondaryButton, ticket!.isUrgent && styles.secondaryButtonActive]}
                onPress={() =>
                  run(
                    () => inboxApi.setUrgent(ticketId!, !ticket!.isUrgent),
                    false,
                    ticket!.isUrgent ? t('inbox.toastUrgentOff') : t('inbox.toastUrgentOn')
                  )
                }
                disabled={busy}
              >
                <Text style={[styles.secondaryText, ticket!.isUrgent && styles.secondaryTextActive]}>
                  {ticket!.isUrgent ? t('inbox.action.unsetUrgent') : t('inbox.action.setUrgent')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dangerButton} onPress={confirmClose} disabled={busy}>
                <Text style={styles.dangerText}>{t('inbox.action.close')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={styles.chatButton}
                onPress={() => onOpenChat(ticketId!, ticket!.locationName || ticket!.location)}
                disabled={busy}
              >
                <Text style={styles.chatButtonText}>💬 {t('taskDetail.openChat')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setAssignOpen(true)}
              disabled={busy}
            >
              <Text style={styles.primaryText}>{t('inbox.action.assign')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {chatOnly && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <TouchableOpacity
              style={styles.chatButton}
              onPress={() => onOpenChat(ticketId!, ticket!.locationName || ticket!.location)}
            >
              <Text style={styles.chatButtonText}>💬 {t('taskDetail.openChat')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {busy && (
          <View style={styles.busyOverlay}><ActivityIndicator color={colors.green} size="large" /></View>
        )}

        {!isVenueManager && <AssignSheet
          ticketId={ticketId}
          visible={assignOpen}
          onClose={() => setAssignOpen(false)}
          onAssigned={(agentName) => {
            setAssignOpen(false);
            onChanged(t('inbox.toastAssigned', { name: agentName }));
            onClose();
          }}
        />}
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  phone,
  callLabel,
}: {
  label: string;
  value: string;
  phone?: string | null;
  callLabel?: string;
}) {
  return (
    <View style={styles.field}>
      <View style={{ flex: 1 }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
      {!!phone && (
        <TouchableOpacity style={styles.callButton} onPress={() => Linking.openURL(`tel:${phone}`)}>
          <Text style={styles.callButtonText}>{callLabel ?? '📞'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function TimeRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.timeRow}>
      <Text style={styles.timeLabel}>{label}</Text>
      <Text style={styles.timeValue}>{formatDateTime(value)}</Text>
    </View>
  );
}

/**
 * The same list a dispatcher gets when forwarding: scoped to the ticket's
 * location, recommended-first by fault category, with each person's trades and
 * availability on show. A bare name is not enough to choose between five
 * technicians.
 */
function AssignSheet({
  ticketId,
  visible,
  onClose,
  onAssigned,
}: {
  ticketId: string | null;
  visible: boolean;
  onClose: () => void;
  onAssigned: (agentName: string) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [options, setOptions] = useState<ForwardOption[] | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible || !ticketId) return;
    setOptions(null);
    inboxApi
      .getForwardOptions(ticketId)
      .then((res) => {
        setOptions(res.options);
        setCategoryName(res.categoryName);
      })
      .catch(() => setOptions([]));
  }, [visible, ticketId]);

  const assign = async (agentId: number, agentName: string) => {
    setBusy(true);
    try {
      await inboxApi.forwardTicket(ticketId!, agentId);
      onAssigned(agentName);
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.message || t('inbox.actionError'));
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  // An overlay inside the ticket modal, NOT a Modal of its own. Nesting one
  // Modal in another and dismissing both in the same commit — which assigning
  // does, since it closes the picker and the ticket together — leaves iOS with
  // an orphaned presented window: a black screen that survives navigation and
  // clears only on an app restart.
  return (
    <View style={styles.overlay}>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('inbox.action.assign')}</Text>
        </View>

        {options === null ? (
          <View style={styles.center}><ActivityIndicator color={colors.green} /></View>
        ) : options.length === 0 ? (
          <View style={styles.center}><Text style={styles.muted}>{t('inbox.noAssignees')}</Text></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
            {!!categoryName && (
              <Text style={styles.assignHint}>{t('inbox.assignCategoryHint', { category: categoryName })}</Text>
            )}
            {options.map((o, i) => {
              const prev = i > 0 ? options[i - 1] : null;
              const showRecommended =
                i === 0 && o.matchesCategory && options.some((x) => !x.matchesCategory);
              const showOthers = !o.matchesCategory && (prev === null || prev.matchesCategory);
              const available = o.availability === AgentAvailability.Available;
              const availabilityLabel =
                o.availability === AgentAvailability.Available
                  ? t('technician.available')
                  : o.availability === AgentAvailability.OnBreak
                    ? t('technician.onBreak')
                    : t('technician.dayOff');
              return (
                <React.Fragment key={o.id}>
                  {showRecommended && (
                    <Text style={styles.groupHeading}>{t('taskDetail.recommendedForCategory')}</Text>
                  )}
                  {showOthers && (
                    <Text style={styles.groupHeading}>{t('taskDetail.otherTechnicians')}</Text>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.techRow,
                      !available && styles.techRowDisabled,
                      !o.matchesCategory && styles.techRowOffSpec,
                    ]}
                    onPress={() => assign(o.id, o.name)}
                    disabled={!available || busy}
                    activeOpacity={0.7}
                  >
                    <View style={styles.techAvatar}>
                      <Text style={styles.techAvatarText}>{getInitials(o.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.techName}>{o.name}</Text>
                      {!!o.technicianSpecializations && (
                        <Text style={styles.techSpec} numberOfLines={2}>
                          {o.technicianSpecializations.split('|').join(', ')}
                        </Text>
                      )}
                      <Text style={styles.techLoad}>{t('taskDetail.openTasks', { count: o.openTasks })}</Text>
                    </View>
                    <View style={styles.availability}>
                      <View style={[styles.statusDot, { backgroundColor: AVAILABILITY_COLOR[o.availability as AgentAvailability] }]} />
                      <Text style={[styles.availabilityText, { color: AVAILABILITY_COLOR[o.availability as AgentAvailability] }]}>
                        {availabilityLabel}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </ScrollView>
        )}

        {busy && (
          <View style={styles.busyOverlay}><ActivityIndicator color={colors.green} size="large" /></View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  // Covers the ticket sheet completely, so it reads as its own screen without
  // being a second Modal — see the comment on AssignSheet's return.
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface, zIndex: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  muted: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0D111799',
    justifyContent: 'center',
    alignItems: 'center',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  close: { fontSize: 20, color: colors.muted, width: 24 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.forest },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },
  urgentBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
    backgroundColor: tint(colors.error),
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },

  ticketId: { fontSize: 12, color: colors.muted, marginBottom: spacing.xs },
  description: { fontSize: 16, color: colors.forest, lineHeight: 23, marginBottom: spacing.md },

  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  // Same pill the technician screen uses, so a call looks like a call
  // everywhere in the app.
  callButton: {
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  callButtonText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  fieldLabel: { fontSize: 11, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontSize: 14, color: colors.text, marginTop: 2 },

  sectionLabel: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },

  calloutWarn: {
    backgroundColor: tint(colors.error),
    borderRadius: radius.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  calloutOk: {
    backgroundColor: tint(colors.statusDone),
    borderRadius: radius.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  calloutLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.muted,
    marginBottom: 4,
  },
  calloutText: { fontSize: 14, color: colors.forest, lineHeight: 20 },

  photo: { width: '100%', height: 200, borderRadius: radius.sm, backgroundColor: colors.card },
  proofPhoto: { width: 110, height: 110, borderRadius: radius.sm, marginRight: spacing.sm, backgroundColor: colors.card },

  // Capped height: a ticket bounced half a dozen times would otherwise push
  // the action buttons somewhere nobody scrolls to.
  historyBox: {
    maxHeight: 260,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  historyRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.sm },
  historyRowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  historyDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  historyStatus: { fontSize: 13, fontWeight: '700', color: colors.forest },
  historyMeta: { fontSize: 11, color: colors.muted, marginTop: 1 },
  historyNote: { fontSize: 13, color: colors.text, marginTop: 4, lineHeight: 18, fontStyle: 'italic' },

  timeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  timeLabel: { fontSize: 13, color: colors.muted },
  timeValue: { fontSize: 13, color: colors.text, fontWeight: '600' },

  footer: {
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  primaryButton: {
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    flex: 1,
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonActive: { borderColor: colors.warning, backgroundColor: tint(colors.warning) },
  secondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  secondaryTextActive: { color: colors.warning },
  dangerButton: {
    flex: 1,
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: { color: colors.error, fontSize: 14, fontWeight: '700' },
  chatButton: {
    flex: 1,
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatButtonText: { color: colors.forest, fontSize: 14, fontWeight: '600' },

  assignHint: { fontSize: 13, color: colors.muted, marginBottom: spacing.md, lineHeight: 19 },
  groupHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  techRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  techRowDisabled: { opacity: 0.45 },
  techRowOffSpec: { opacity: 0.72 },
  techAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tint(colors.green),
    alignItems: 'center',
    justifyContent: 'center',
  },
  techAvatarText: { color: colors.green, fontWeight: '700', fontSize: 14 },
  techName: { fontSize: 15, fontWeight: '700', color: colors.forest },
  techSpec: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },
  techLoad: { fontSize: 11, color: colors.muted, marginTop: 2, fontWeight: '600' },
  availability: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  availabilityText: { fontSize: 11, fontWeight: '700' },
});
