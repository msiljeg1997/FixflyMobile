import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
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
import { isNetworkError } from '../api/client';
import { outbox } from '../offline/outbox';
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

  // A resolve sitting in the outbox for THIS ticket. Surfaced here because a
  // queue that fails quietly is worse than no queue: the technician believes
  // the job is filed and only finds out days later that it never arrived.
  const [queued, setQueued] = useState<{ failedReason?: string } | null>(null);
  useEffect(() => {
    const sync = () => { outbox.resolveFor(ticketId).then((i) => setQueued(i ?? null)); };
    sync();
    return outbox.subscribe(sync);
  }, [ticketId]);

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

  /**
   * Coordinates when the guest's report carried them, otherwise the site
   * address. A technician holding a phone with an address on it is one tap
   * from directions and was previously retyping it into another app.
   */
  const openInMaps = () => {
    if (!task) return;
    const query =
      task.latitude != null && task.longitude != null
        ? `${task.latitude},${task.longitude}`
        : task.locationAddress;
    if (!query) return;
    const encoded = encodeURIComponent(query);
    // Apple Maps on iOS, the geo: scheme elsewhere — both fall back to
    // whatever the device has set as its map app.
    Linking.openURL(Platform.OS === 'ios' ? `maps:0,0?q=${encoded}` : `geo:0,0?q=${encoded}`);
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
      // Only a dead connection is queued. A refusal from the server — wrong
      // status, no longer assigned to this technician — is a real answer and
      // gets shown; queueing it would just fail again later, quietly.
      if (isNetworkError(e)) {
        await outbox.enqueueResolve(ticketId, comment.trim(), photos);
        setResolving(false);
        setComment('');
        setPhotos([]);
        Alert.alert(t('taskDetail.resolveQueuedTitle'), t('taskDetail.resolveQueuedBody'));
      } else {
        showError(e);
      }
    } finally {
      setActing(false);
    }
  };

  const openForward = async () => {
    setForwarding(true);
    setTechniciansLoading(true);
    try {
      // Scoped to this ticket: its location filters the list, its fault
      // category decides who is recommended.
      setTechnicians(await tasksApi.getTechnicians(ticketId));
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
        {!!queued && (
          <View style={[styles.queueBanner, queued.failedReason && styles.queueBannerFailed]}>
            <Text style={styles.queueTitle}>
              {queued.failedReason ? t('taskDetail.queueFailedTitle') : t('taskDetail.queuePendingTitle')}
            </Text>
            <Text style={styles.queueBody}>
              {queued.failedReason ? t('taskDetail.queueFailedBody') : t('taskDetail.queuePendingBody')}
            </Text>
            {!!queued.failedReason && (
              <View style={styles.queueActions}>
                <TouchableOpacity style={styles.queueRetry} onPress={() => outbox.retryResolve(ticketId)}>
                  <Text style={styles.queueRetryText}>{t('common.retry')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert(t('taskDetail.queueDiscardTitle'), t('taskDetail.queueDiscardBody'), [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('taskDetail.queueDiscard'),
                        style: 'destructive',
                        onPress: () => outbox.discardResolve(ticketId),
                      },
                    ])
                  }
                >
                  <Text style={styles.queueDiscardText}>{t('taskDetail.queueDiscard')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

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
            {task.locationAddress && (
              <InfoRow
                icon="📍"
                label={t('taskDetail.locationInfo')}
                value={task.locationAddress}
                action={
                  <TouchableOpacity style={styles.callButton} onPress={openInMaps}>
                    <Text style={styles.callButtonText}>{t('taskDetail.navigate')}</Text>
                  </TouchableOpacity>
                }
              />
            )}
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
      <Modal visible={rejecting} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setRejecting(false)}>
        <KeyboardAvoidingView
          style={styles.sheet}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.sheetHeader, { paddingTop: insets.top + spacing.sm }]}>
            <TouchableOpacity onPress={() => setRejecting(false)} disabled={acting} hitSlop={12}>
              <Text style={styles.sheetCancel}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle} numberOfLines={1}>{t('taskDetail.reject')}</Text>
            <View style={styles.sheetHeaderSpacer} />
          </View>

          {/* keyboardDismissMode="on-drag" is the iOS-native way out of a
              multiline field — swiping the content down closes the keyboard,
              so no extra "Done" affordance is needed. */}
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetBodyContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.sheetHint}>{t('taskDetail.rejectHint')}</Text>
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
          </ScrollView>

          <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + spacing.md }]}>
            <TouchableOpacity
              style={[styles.sheetPrimaryButton, styles.sheetDangerButton, !rejectReason.trim() && styles.sheetButtonDisabled]}
              onPress={onReject}
              disabled={acting}
            >
              {acting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.sheetButtonText}>{t('taskDetail.rejectConfirm')}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Resolve — same sheet treatment, scrollable body for the photo grid */}
      <Modal visible={resolving} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setResolving(false)}>
        <KeyboardAvoidingView
          style={styles.sheet}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.sheetHeader, { paddingTop: insets.top + spacing.sm }]}>
            <TouchableOpacity onPress={() => setResolving(false)} disabled={acting} hitSlop={12}>
              <Text style={styles.sheetCancel}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle} numberOfLines={1}>{t('taskDetail.resolve')}</Text>
            <View style={styles.sheetHeaderSpacer} />
          </View>

          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetBodyContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
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

            <View style={styles.photoHeader}>
              <Text style={styles.sectionLabel}>{t('taskDetail.resolvePhotos')}</Text>
              <Text style={styles.photoCount}>{photos.length}/{MAX_PHOTOS}</Text>
            </View>
            <View style={styles.photoRow}>
              {photos.map((p, i) => (
                <View key={p.uri} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <TouchableOpacity
                    style={styles.thumbRemoveBtn}
                    onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    hitSlop={8}
                  >
                    <Text style={styles.thumbRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <>
                  <TouchableOpacity style={styles.addPhoto} onPress={() => pickPhoto(true)}>
                    <Text style={styles.addPhotoText}>📷</Text>
                    <Text style={styles.addPhotoLabel}>{t('taskDetail.camera')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.addPhoto} onPress={() => pickPhoto(false)}>
                    <Text style={styles.addPhotoText}>🖼️</Text>
                    <Text style={styles.addPhotoLabel}>{t('taskDetail.gallery')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </ScrollView>

          <View style={[styles.sheetFooter, { paddingBottom: insets.bottom + spacing.md }]}>
            <TouchableOpacity
              style={[styles.sheetPrimaryButton, !comment.trim() && styles.sheetButtonDisabled]}
              onPress={onResolve}
              disabled={acting || !comment.trim()}
            >
              {acting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.sheetButtonText}>{t('taskDetail.resolveConfirm')}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Forward — dispatcher picks a technician; tapping a row forwards
          immediately (a picker, not a form that needs a separate confirm) */}
      <Modal visible={forwarding} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setForwarding(false)}>
        <View style={styles.sheet}>
          <View style={[styles.sheetHeader, { paddingTop: insets.top + spacing.sm }]}>
            <TouchableOpacity onPress={() => setForwarding(false)} disabled={acting} hitSlop={12}>
              <Text style={styles.sheetCancel}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <Text style={styles.sheetTitle} numberOfLines={1}>{t('taskDetail.forward')}</Text>
            <View style={styles.sheetHeaderSpacer} />
          </View>

          <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetBodyContent}>
            {techniciansLoading ? (
              <ActivityIndicator color={colors.green} style={{ marginTop: spacing.lg }} />
            ) : technicians.length === 0 ? (
              // The list is scoped to this ticket's location, so empty means
              // "nobody covers this location" — say that rather than a bare
              // "no technicians", which reads as a broken screen.
              <Text style={styles.muted}>{t('taskDetail.noTechniciansForLocation')}</Text>
            ) : (
              technicians.map((tech, index) => {
                const available = tech.availability === AgentAvailability.Available;
                // The server orders recommended-first, so the boundary is
                // wherever matchesCategory stops being true. Headings only
                // appear when there is actually a split to explain.
                const prev = index > 0 ? technicians[index - 1] : null;
                const showRecommendedHeading =
                  index === 0 && tech.matchesCategory && technicians.some((x) => !x.matchesCategory);
                const showOthersHeading = !tech.matchesCategory && (prev === null || prev.matchesCategory);
                const availabilityLabel =
                  tech.availability === AgentAvailability.Available
                    ? t('technician.available')
                    : tech.availability === AgentAvailability.OnBreak
                      ? t('technician.onBreak')
                      : t('technician.dayOff');
                return (
                  <React.Fragment key={tech.id}>
                    {showRecommendedHeading && (
                      <Text style={styles.techGroupHeading}>{t('taskDetail.recommendedForCategory')}</Text>
                    )}
                    {showOthersHeading && (
                      <Text style={styles.techGroupHeading}>{t('taskDetail.otherTechnicians')}</Text>
                    )}
                  <TouchableOpacity
                    style={[styles.techRow, !available && styles.techRowDisabled, !tech.matchesCategory && styles.techRowOffSpec]}
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
                      {/* Trade alone is not enough to choose — without this the
                          next job tends to land on whoever is already buried. */}
                      <Text style={styles.techLoad}>{t('taskDetail.openTasks', { count: tech.openTasks })}</Text>
                    </View>
                    <View style={styles.availability}>
                      <View style={[styles.statusDot, { backgroundColor: AVAILABILITY_COLOR[tech.availability] }]} />
                      <Text style={[styles.availabilityText, { color: AVAILABILITY_COLOR[tech.availability] }]}>
                        {availabilityLabel}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  </React.Fragment>
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
  queueBanner: {
    backgroundColor: tint(colors.warning),
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  queueBannerFailed: { backgroundColor: tint(colors.error) },
  queueTitle: { fontSize: 14, fontWeight: '700', color: colors.forest },
  queueBody: { fontSize: 13, color: colors.text, marginTop: 4, lineHeight: 18 },
  queueActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.sm },
  queueRetry: {
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  queueRetryText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  queueDiscardText: { color: colors.error, fontSize: 12, fontWeight: '700' },
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
  thumb: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.card },
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
    width: 76,
    height: 76,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoText: { fontSize: 22 },

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
  // Off-specialisation but still pickable: dimmed enough to read as a second
  // choice, not so dim it looks unavailable — that meaning is already taken.
  techRowOffSpec: { opacity: 0.72 },
  techGroupHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
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
  techLoad: { fontSize: 11, color: colors.muted, marginTop: 2, fontWeight: '600' },
  techSpec: { fontSize: 12, color: colors.muted, marginTop: 2 },
  availability: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  availabilityText: { fontSize: 11, fontWeight: '700' },

  sheet: { flex: 1, backgroundColor: colors.surface },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // No fixed width — "Odustani"/"Abbrechen" wrapped to two lines at 60px.
  sheetCancel: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  // Balances the cancel link so the title reads as centred.
  sheetHeaderSpacer: { width: 64 },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.forest, textAlign: 'center' },
  sheetBody: { flex: 1 },
  sheetBodyContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  sheetHint: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: spacing.lg },
  sheetFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Deliberately NOT reusing primaryButton/dangerButton: those carry flex:1
  // for the horizontal sticky action bar, and inside the footer's column
  // that collapsed the button to a thin strip with its label clipped away.
  sheetPrimaryButton: {
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDangerButton: { backgroundColor: colors.error },
  sheetButtonDisabled: { opacity: 0.4 },
  sheetButtonText: { color: colors.white, fontSize: 16, fontWeight: '700' },

  photoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  photoCount: { fontSize: 12, color: colors.muted, fontWeight: '600', marginBottom: spacing.xs },
  thumbWrap: { position: 'relative' },
  thumbRemoveBtn: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  thumbRemoveText: { color: colors.white, fontSize: 13, fontWeight: '700', lineHeight: 15 },
  addPhotoLabel: { fontSize: 10, color: colors.muted, marginTop: 2 },
  input: {
    backgroundColor: colors.card,
    color: colors.forest,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 130,
    textAlignVertical: 'top',
  },
});
