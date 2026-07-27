import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import * as tasksApi from '../api/tasks';
import type { ResolveImage } from '../api/tasks';
import { AgentAvailability, AgentRole, TaskDetail, TaskHistoryEvent, TechnicianOption, TicketStatus } from '../api/types';
import type { TasksStackParamList } from '../navigation/TasksStackNavigator';
import { categoryLabel, formatDateTime, getInitials } from '../utils/format';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { colors, radius, spacing, tint } from '../theme/tokens';

const MAX_PHOTOS = 5;

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

function InfoRow({
  icon,
  label,
  value,
  action,
  last,
}: {
  icon: string;
  label: string;
  value: string;
  action?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowDivider]}>
      <Text style={styles.infoIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
      {action}
    </View>
  );
}

export function TaskDetailScreen() {
  const { t } = useTranslation();
  const { agent } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<TasksStackParamList>>();
  const route = useRoute<RouteProp<TasksStackParamList, 'TaskDetail'>>();
  const { ticketId } = route.params;
  const insets = useSafeAreaInsets();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [acting, setActing] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  // Read-only activity timeline
  const [history, setHistory] = useState<TaskHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Reject sheet
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Resolve sheet
  const [resolving, setResolving] = useState(false);
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<ResolveImage[]>([]);

  // Forward sheet (Dispatcher/Hausmajstor only) — hand the task to a technician
  const [forwarding, setForwarding] = useState(false);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setTask(await tasksApi.getTask(ticketId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await tasksApi.getTaskHistory(ticketId));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [ticketId]);

  useFocusEffect(
    useCallback(() => {
      load();
      loadHistory();
    }, [load, loadHistory])
  );

  const callContact = () => {
    if (task?.locationContactPhone) Linking.openURL(`tel:${task.locationContactPhone}`);
  };

  const callReporter = () => {
    if (task?.reporterPhone) Linking.openURL(`tel:${task.reporterPhone}`);
  };

  const statusLabel = (s: TicketStatus) => t(`status.${TicketStatus[s]}`);

  const showError = (e: unknown) => {
    const msg =
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
      t('taskDetail.actionError');
    Alert.alert(t('taskDetail.errorTitle'), msg);
  };

  const onAccept = async () => {
    setActing(true);
    try {
      setTask(await tasksApi.acceptTask(ticketId));
    } catch (e) {
      showError(e);
    } finally {
      setActing(false);
    }
  };

  const onReject = async () => {
    if (!rejectReason.trim()) {
      Alert.alert(t('taskDetail.rejectReasonRequiredTitle'), t('taskDetail.rejectReasonRequiredBody'));
      return;
    }
    setActing(true);
    try {
      await tasksApi.rejectTask(ticketId, rejectReason.trim());
      navigation.goBack();
    } catch (e) {
      showError(e);
      setActing(false);
    }
  };

  const pickPhoto = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });

    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      setPhotos((prev) =>
        prev.length >= MAX_PHOTOS ? prev : [...prev, { uri: a.uri, fileName: a.fileName, mimeType: a.mimeType }]
      );
    }
  };

  const onResolve = async () => {
    if (!comment.trim()) return;
    setActing(true);
    try {
      setTask(await tasksApi.resolveTask(ticketId, comment.trim(), photos));
      setResolving(false);
      setComment('');
      setPhotos([]);
    } catch (e) {
      showError(e);
    } finally {
      setActing(false);
    }
  };

  const openForward = async () => {
    setForwarding(true);
    setTechniciansLoading(true);
    try {
      setTechnicians(await tasksApi.getTechnicians());
    } catch {
      setTechnicians([]);
    } finally {
      setTechniciansLoading(false);
    }
  };

  const onForward = async (technicianId: number) => {
    setActing(true);
    try {
      setTask(await tasksApi.forwardTask(ticketId, technicianId));
      setForwarding(false);
    } catch (e) {
      showError(e);
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green} size="large" />
      </View>
    );
  }

  if (error || !task) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t('tasks.loadError')}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={load}>
          <Text style={styles.primaryButtonText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isDispatcher = agent?.role === AgentRole.Hausmajstor;
  const isMineToAccept =
    task.status === TicketStatus.ForwardedToTechnician ||
    (isDispatcher && (task.status === TicketStatus.New || task.status === TicketStatus.Returned));
  const canResolve = task.status === TicketStatus.Accepted;
  const canReject = task.status === TicketStatus.ForwardedToTechnician && agent?.role === AgentRole.Technician;
  const canForward =
    isDispatcher &&
    task.status !== TicketStatus.ForwardedToTechnician &&
    task.status !== TicketStatus.Done &&
    task.status !== TicketStatus.Closed;
  const isDone = task.status === TicketStatus.Done || task.status === TicketStatus.Closed;
  const statusColor = STATUS_COLORS[task.status];

  // A dispatcher's primary job is routing work, not doing it — Forward leads
  // when a technician hasn't been picked yet; once they've personally
  // accepted, Resolve becomes the lead action and Forward is still offered
  // as a secondary escape hatch. Technicians keep the original Accept/Reject.
  type Action = { key: string; label: string; onPress: () => void; variant: 'primary' | 'secondary' | 'danger' };
  const actions: Action[] = [];
  if (isDispatcher) {
    if (canResolve) {
      actions.push({ key: 'resolve', label: t('taskDetail.resolve'), onPress: () => setResolving(true), variant: 'primary' });
      if (canForward) actions.push({ key: 'forward', label: t('taskDetail.forward'), onPress: openForward, variant: 'secondary' });
    } else if (isMineToAccept) {
      actions.push({ key: 'forward', label: t('taskDetail.forward'), onPress: openForward, variant: 'primary' });
      actions.push({ key: 'accept', label: t('taskDetail.accept'), onPress: onAccept, variant: 'secondary' });
    }
  } else {
    if (isMineToAccept) actions.push({ key: 'accept', label: t('taskDetail.accept'), onPress: onAccept, variant: 'primary' });
    if (canResolve) actions.push({ key: 'resolve', label: t('taskDetail.resolve'), onPress: () => setResolving(true), variant: 'primary' });
    if (canReject) actions.push({ key: 'reject', label: t('taskDetail.reject'), onPress: () => setRejecting(true), variant: 'danger' });
  }
  const hasFooter = actions.length > 0;

  const hasMeta = task.forwardedAt || task.acceptedAt || task.assignedByName;
  const hasLocationInfo = task.locationAddress || task.locationContactName || task.locationContactPhone;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: hasFooter ? spacing.lg : insets.bottom + spacing.xl },
        ]}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.back}>‹ {t('common.back')}</Text>
          </TouchableOpacity>
          <View style={[styles.statusPill, { backgroundColor: tint(statusColor) }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel(task.status)}</Text>
          </View>
        </View>

        <Text style={styles.ticketId}>{task.ticketId}</Text>
        <Text style={styles.location}>
          {task.locationName || task.location}
          {task.roomNumber ? ` · ${t('tasks.room')} ${task.roomNumber}` : ''}
        </Text>
        {task.category && <Text style={styles.category}>{categoryLabel(task.category)}</Text>}

        <TouchableOpacity
          style={styles.chatButton}
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('Chat', { ticketId: task.ticketId, title: task.locationName || task.location })
          }
        >
          <Text style={styles.chatButtonIcon}>💬</Text>
          <Text style={styles.chatButtonText}>{t('taskDetail.openChat')}</Text>
          {task.unreadChatCount > 0 && (
            <View style={styles.chatBadge}>
              <Text style={styles.chatBadgeText}>{task.unreadChatCount}</Text>
            </View>
          )}
          <Text style={styles.chatChevron}>›</Text>
        </TouchableOpacity>

        {task.isUrgent && (
          <View style={styles.urgentBanner}>
            <Text style={styles.urgentBannerText}>⚠ {t('tasks.urgent')}</Text>
          </View>
        )}

        {hasMeta && (
          <View style={styles.card}>
            <InfoRow icon="📅" label={t('taskDetail.reportedAt')} value={formatDateTime(task.createdAt) ?? '—'} />
            {(task.forwardedAt || task.acceptedAt) && (
              <InfoRow
                icon="⏱"
                label={t('taskDetail.assignedAt')}
                value={formatDateTime(task.forwardedAt ?? task.acceptedAt) ?? '—'}
              />
            )}
            {task.assignedByName && (
              <InfoRow icon="👷" label={t('taskDetail.assignedBy')} value={task.assignedByName} last />
            )}
          </View>
        )}

        {hasLocationInfo && (
          <View style={styles.card}>
            {task.locationAddress && <InfoRow icon="📍" label={t('taskDetail.locationInfo')} value={task.locationAddress} />}
            {(task.locationContactName || task.locationContactPhone) && (
              <InfoRow
                icon="☎️"
                label={t('taskDetail.contact')}
                value={[task.locationContactName, task.locationContactPhone].filter(Boolean).join(' · ')}
                last
                action={
                  task.locationContactPhone ? (
                    <TouchableOpacity style={styles.callButton} onPress={callContact}>
                      <Text style={styles.callButtonText}>{t('taskDetail.call')}</Text>
                    </TouchableOpacity>
                  ) : undefined
                }
              />
            )}
          </View>
        )}

        {task.assignmentNote && (
          <View style={[styles.card, styles.noteCard]}>
            <Text style={styles.sectionLabel}>{t('taskDetail.assignmentNote')}</Text>
            <Text style={styles.description}>{task.assignmentNote}</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t('taskDetail.description')}</Text>
          <Text style={styles.description}>{task.description}</Text>
        </View>

        {task.reporterPhone && (
          <View style={styles.card}>
            <InfoRow
              icon="🙋"
              label={t('taskDetail.reporter')}
              value={task.reporterPhone}
              last
              action={
                <TouchableOpacity style={styles.callButton} onPress={callReporter}>
                  <Text style={styles.callButtonText}>{t('taskDetail.call')}</Text>
                </TouchableOpacity>
              }
            />
          </View>
        )}

        {task.imageUrl && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>{t('taskDetail.reporterPhoto')}</Text>
            <TouchableOpacity onPress={() => setViewerUri(task.imageUrl)} activeOpacity={0.85}>
              <Image source={{ uri: task.imageUrl }} style={styles.photo} resizeMode="cover" />
            </TouchableOpacity>
          </View>
        )}

        {isDone && (task.resolutionComment || task.resolutionPhotos.length > 0) && (
          <View style={[styles.card, styles.proofCard]}>
            <Text style={styles.sectionLabel}>{t('taskDetail.resolutionProof')}</Text>
            {task.resolutionComment && <Text style={styles.description}>{task.resolutionComment}</Text>}
            <View style={styles.photoRow}>
              {task.resolutionPhotos.map((p) => (
                <TouchableOpacity key={p.id} onPress={() => setViewerUri(p.url)} activeOpacity={0.85}>
                  <Image source={{ uri: p.url }} style={styles.thumb} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={styles.historySection}>
          <Text style={styles.sectionLabel}>{t('taskDetail.history')}</Text>
          {historyLoading ? (
            <ActivityIndicator color={colors.muted} style={{ marginTop: spacing.sm }} />
          ) : history.length === 0 ? (
            <Text style={styles.muted}>{t('taskDetail.historyEmpty')}</Text>
          ) : (
            <View style={styles.historyBubble}>
              <ScrollView
                style={styles.historyScroll}
                nestedScrollEnabled
                showsVerticalScrollIndicator={history.length > 5}
              >
                {history.map((h, i) => (
                  <View key={h.id} style={[styles.historyItem, i === history.length - 1 && styles.historyItemLast]}>
                    <Text style={styles.historyStatus}>{statusLabel(h.newStatus)}</Text>
                    <Text style={styles.historyMeta}>
                      {formatDateTime(h.changedAt)} · {h.changedByName}
                      {h.targetAgentName ? ` → ${h.targetAgentName}` : ''}
                    </Text>
                    {h.notes && <Text style={styles.historyNote}>{h.notes}</Text>}
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Sticky action bar — always reachable without scrolling, instead of
          being buried at the bottom of a long page. */}
      {hasFooter && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          {actions.map((a) => (
            <TouchableOpacity
              key={a.key}
              style={
                a.variant === 'primary' ? styles.primaryButton : a.variant === 'danger' ? styles.dangerButtonOutline : styles.secondaryButtonOutline
              }
              onPress={a.onPress}
              disabled={acting}
            >
              {acting && a.variant === 'primary' ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text
                  style={
                    a.variant === 'primary'
                      ? styles.primaryButtonText
                      : a.variant === 'danger'
                        ? styles.dangerButtonOutlineText
                        : styles.secondaryButtonOutlineText
                  }
                >
                  {a.label}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Reject — focused modal sheet instead of an inline form at the
          bottom of the scroll */}
      <Modal visible={rejecting} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setRejecting(false)}>
        <View style={[styles.sheet, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.sheetHeader}>
            <TouchableOpacity onPress={() => setRejecting(false)} disabled={acting}>
              <Text style={styles.sheetCancel}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>{t('taskDetail.reject')}</Text>
            <View style={styles.sheetHeaderSpacer} />
          </View>

          <View style={styles.sheetBody}>
            <Text style={styles.sectionLabel}>{t('taskDetail.rejectReason')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('taskDetail.rejectPlaceholder')}
              placeholderTextColor={colors.muted}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              autoFocus
            />
          </View>

          <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + spacing.md }]}>
            <TouchableOpacity style={styles.dangerButton} onPress={onReject} disabled={acting}>
              {acting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.dangerButtonText}>{t('taskDetail.rejectConfirm')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Resolve — same sheet treatment, scrollable body for the photo grid */}
      <Modal visible={resolving} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setResolving(false)}>
        <View style={[styles.sheet, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.sheetHeader}>
            <TouchableOpacity onPress={() => setResolving(false)} disabled={acting}>
              <Text style={styles.sheetCancel}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>{t('taskDetail.resolve')}</Text>
            <View style={styles.sheetHeaderSpacer} />
          </View>

          <ScrollView style={styles.sheetBody}>
            <Text style={styles.sectionLabel}>{t('taskDetail.resolveComment')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('taskDetail.resolvePlaceholder')}
              placeholderTextColor={colors.muted}
              value={comment}
              onChangeText={setComment}
              multiline
              autoFocus
            />

            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
              {t('taskDetail.resolvePhotos')} ({photos.length}/{MAX_PHOTOS})
            </Text>
            <View style={styles.photoRow}>
              {photos.map((p, i) => (
                <TouchableOpacity key={p.uri} onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <Text style={styles.thumbRemove}>×</Text>
                </TouchableOpacity>
              ))}
              {photos.length < MAX_PHOTOS && (
                <>
                  <TouchableOpacity style={styles.addPhoto} onPress={() => pickPhoto(true)}>
                    <Text style={styles.addPhotoText}>📷</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.addPhoto} onPress={() => pickPhoto(false)}>
                    <Text style={styles.addPhotoText}>🖼️</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </ScrollView>

          <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + spacing.md }]}>
            <TouchableOpacity style={styles.primaryButton} onPress={onResolve} disabled={acting || !comment.trim()}>
              {acting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>{t('taskDetail.resolveConfirm')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Forward — dispatcher picks a technician; tapping a row forwards
          immediately (a picker, not a form that needs a separate confirm) */}
      <Modal visible={forwarding} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setForwarding(false)}>
        <View style={[styles.sheet, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.sheetHeader}>
            <TouchableOpacity onPress={() => setForwarding(false)} disabled={acting}>
              <Text style={styles.sheetCancel}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle}>{t('taskDetail.forward')}</Text>
            <View style={styles.sheetHeaderSpacer} />
          </View>

          <ScrollView style={styles.sheetBody}>
            {techniciansLoading ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.lg }} />
            ) : technicians.length === 0 ? (
              <Text style={styles.muted}>{t('taskDetail.noTechnicians')}</Text>
            ) : (
              technicians.map((tech) => {
                const available = tech.availability === AgentAvailability.Available;
                const availabilityLabel =
                  tech.availability === AgentAvailability.Available
                    ? t('technician.available')
                    : tech.availability === AgentAvailability.OnBreak
                      ? t('technician.onBreak')
                      : t('technician.dayOff');
                return (
                  <TouchableOpacity
                    key={tech.id}
                    style={[styles.techRow, !available && styles.techRowDisabled]}
                    onPress={() => onForward(tech.id)}
                    disabled={!available || acting}
                    activeOpacity={0.6}
                  >
                    <View style={styles.techAvatar}>
                      <Text style={styles.techAvatarText}>{getInitials(tech.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.techName}>{tech.name}</Text>
                      {tech.technicianSpecializations && (
                        <Text style={styles.techSpec} numberOfLines={1}>
                          {tech.technicianSpecializations.split('|').join(', ')}
                        </Text>
                      )}
                    </View>
                    <View style={styles.availability}>
                      <View style={[styles.statusDot, { backgroundColor: AVAILABILITY_COLOR[tech.availability] }]} />
                      <Text style={[styles.availabilityText, { color: AVAILABILITY_COLOR[tech.availability] }]}>
                        {availabilityLabel}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      <ImageViewerModal uri={viewerUri} onClose={() => setViewerUri(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: colors.surface },
  muted: { color: colors.muted, fontSize: 14 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: colors.forest, fontSize: 16, fontWeight: '600' },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },

  ticketId: { fontSize: 13, color: colors.muted, marginTop: spacing.sm, marginBottom: 2 },
  location: { fontSize: 22, fontWeight: '700', color: colors.forest },
  category: { fontSize: 14, color: colors.muted, marginTop: 2 },

  chatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  chatButtonIcon: { fontSize: 16 },
  chatButtonText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.forest },
  chatBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  chatBadgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  chatChevron: { fontSize: 20, color: colors.muted },

  urgentBanner: {
    backgroundColor: tint(colors.error, '20'),
    borderWidth: 1,
    borderColor: tint(colors.error, '55'),
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  urgentBannerText: { color: colors.error, fontSize: 13, fontWeight: '700' },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  noteCard: { backgroundColor: tint(colors.warning, '1A'), borderColor: tint(colors.warning, '40') },
  proofCard: { backgroundColor: tint(colors.green, '1A'), borderColor: tint(colors.green, '40') },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  infoRowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  infoLabel: { fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  infoValue: { fontSize: 14, color: colors.text, fontWeight: '600', marginTop: 2 },
  callButton: { backgroundColor: colors.green, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  callButtonText: { color: colors.white, fontSize: 12, fontWeight: '700' },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  photo: { width: '100%', height: 200, borderRadius: radius.sm, backgroundColor: colors.surface, marginTop: spacing.xs },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    color: colors.white,
    textAlign: 'center',
    lineHeight: 19,
    fontSize: 14,
    fontWeight: '700',
    overflow: 'hidden',
  },
  addPhoto: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.muted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoText: { fontSize: 24 },

  historySection: {},
  historyBubble: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 340,
    overflow: 'hidden',
  },
  historyScroll: { padding: spacing.md },
  historyItem: { borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: spacing.md, paddingBottom: spacing.md },
  historyItemLast: { paddingBottom: 0 },
  historyStatus: { fontSize: 14, fontWeight: '700', color: colors.forest },
  historyMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  historyNote: { fontSize: 13, color: colors.text, marginTop: 4, fontStyle: 'italic' },

  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  dangerButton: {
    backgroundColor: colors.error,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  dangerButtonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  dangerButtonOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.error,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  dangerButtonOutlineText: { color: colors.error, fontSize: 15, fontWeight: '700' },
  secondaryButtonOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  secondaryButtonOutlineText: { color: colors.text, fontSize: 15, fontWeight: '700' },

  techRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  techRowDisabled: { opacity: 0.45 },
  techAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tint(colors.statusAccepted, '2A'),
    justifyContent: 'center',
    alignItems: 'center',
  },
  techAvatarText: { fontSize: 14, fontWeight: '700', color: colors.forest },
  techName: { fontSize: 15, fontWeight: '600', color: colors.forest },
  techSpec: { fontSize: 12, color: colors.muted, marginTop: 2 },
  availability: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  availabilityText: { fontSize: 11, fontWeight: '700' },

  sheet: { flex: 1, backgroundColor: colors.surface },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  sheetCancel: { color: colors.muted, fontSize: 15, fontWeight: '600', width: 60 },
  sheetHeaderSpacer: { width: 60 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.forest },
  sheetBody: { flex: 1, paddingHorizontal: spacing.lg },
  sheetFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    backgroundColor: colors.card,
    color: colors.forest,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
    minHeight: 110,
    textAlignVertical: 'top',
  },
});
