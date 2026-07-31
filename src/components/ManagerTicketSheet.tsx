import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
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
}: {
  ticketId: string | null;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
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

  const run = async (action: () => Promise<unknown>, close = false) => {
    setBusy(true);
    try {
      await action();
      onChanged();
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
        onPress: () => run(() => inboxApi.closeTicket(ticketId!), true),
      },
    ]);
  };

  const statusColor = ticket ? STATUS_COLORS[ticket.status] : colors.muted;
  const canAct = !!ticket && ticket.status !== TicketStatus.Closed;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {ticket?.location || ''}
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
            {ticket.reporterPhone && <Field label={t('inbox.field.reporter')} value={ticket.reporterPhone} />}
            {ticket.assignedAgent && (
              <Field
                label={t('inbox.field.assigned')}
                value={`${ticket.assignedAgent.name} · ${ticket.assignedAgent.phoneNumber}`}
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
          </ScrollView>
        )}

        {canAct && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.secondaryButton, ticket!.isUrgent && styles.secondaryButtonActive]}
                onPress={() => run(() => inboxApi.setUrgent(ticketId!, !ticket!.isUrgent))}
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
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => setAssignOpen(true)}
              disabled={busy}
            >
              <Text style={styles.primaryText}>{t('inbox.action.assign')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {busy && (
          <View style={styles.busyOverlay}><ActivityIndicator color={colors.green} size="large" /></View>
        )}

        <AssignSheet
          ticketId={ticketId}
          visible={assignOpen}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => {
            setAssignOpen(false);
            onChanged();
            onClose();
          }}
        />
      </View>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
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
  onAssigned: () => void;
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

  const assign = async (agentId: number) => {
    setBusy(true);
    try {
      await inboxApi.forwardTicket(ticketId!, agentId);
      onAssigned();
    } catch (err: any) {
      Alert.alert(t('common.error'), err?.response?.data?.message || t('inbox.actionError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
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
                    onPress={() => assign(o.id)}
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
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

  field: { marginBottom: spacing.sm },
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
  availability: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  availabilityText: { fontSize: 11, fontWeight: '700' },
});
