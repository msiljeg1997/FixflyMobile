import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as chatApi from '../api/chat';
import type { ChatImage } from '../api/chat';
import { isNetworkError } from '../api/client';
import { outbox, OutboxItem } from '../offline/outbox';
import { signalRService } from '../realtime/signalr';
import { useUnread } from '../context/UnreadContext';
import { useAuth } from '../context/AuthContext';
import { ChatAccess, ChatMessage, ChatPeriod, ChatRoom, ChatSenderType } from '../api/types';
import type { TasksStackParamList } from '../navigation/TasksStackNavigator';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { shrinkForUpload } from '../utils/image';
import { getInitials } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/**
 * Rows for the thread: system events and live messages inline, each PAST
 * technician folded into one line.
 *
 * A manager opening a ticket that has changed hands twice wants the story,
 * not a replay of three conversations — and the folded header usually
 * answers the question on its own ("Ivan · 6 poruka · odbio: nema dijela").
 * A technician has one stretch and no cast, so this collapses to a plain
 * list for him without a special case.
 */
type Row =
  | { kind: 'msg'; message: ChatMessage }
  | { kind: 'period'; period: ChatPeriod; messages: ChatMessage[] };

function buildRows(messages: ChatMessage[], periods: ChatPeriod[]): Row[] {
  const closed = periods.filter((p) => p.to !== null);
  if (closed.length === 0) return messages.map((m) => ({ kind: 'msg' as const, message: m }));

  const rows: Row[] = [];
  let open: { period: ChatPeriod; messages: ChatMessage[] } | null = null;

  for (const m of messages) {
    // Only a FINISHED stretch folds. The one still running is the live
    // conversation — folding it would hide what somebody came to read, and
    // pulling its messages out of order to do so is how the urgent notices
    // ended up below a reply that came after them.
    const at = new Date(m.sentAt).getTime();
    const period =
      m.senderType === ChatSenderType.System
        ? undefined
        : closed.find(
            (x) => at >= new Date(x.from).getTime() && at <= new Date(x.to!).getTime()
          );

    if (!period) {
      // A system row (or anything outside a closed stretch) ends the current
      // block, so what follows cannot be pulled back above it.
      open = null;
      rows.push({ kind: 'msg', message: m });
      continue;
    }

    if (!open || open.period !== period) {
      open = { period, messages: [] };
      rows.push({ kind: 'period', period, messages: open.messages });
    }
    open.messages.push(m);
  }

  return rows.filter((r) => r.kind !== 'period' || r.messages.length > 0);
}

export function ChatScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TasksStackParamList>>();
  const route = useRoute<RouteProp<TasksStackParamList, 'Chat'>>();
  const { ticketId, title } = route.params;
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Row>>(null);
  const { refresh: refreshUnread, setActiveThread } = useUnread();
  const { agent, manager } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [room, setRoom] = useState<ChatRoom>(ChatRoom.Work);
  const [access, setAccess] = useState<ChatAccess | null>(null);
  // Past stretches start folded. The one still running is what somebody
  // opening this screen came to read.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setError(false);
    try {
      const data = await chatApi.getMessages(ticketId, undefined, 50, room);
      setMessages(data);
      // Opening the thread counts as reading it — drives the other side's
      // "Seen" and clears this ticket's unread badge.
      chatApi.markRead(ticketId).then(() => refreshUnread()).catch(() => {});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [ticketId, refreshUnread, room]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    chatApi
      .getAccess(ticketId)
      .then((a) => {
        setAccess(a);
        setExpanded(new Set(a.periods.filter((x) => x.to === null).map((x) => x.agentId)));
      })
      // A failure here must not block the thread: the safe fallback is the
      // narrow one — work room only, and no internal tab.
      .catch(() => setAccess({ canSeeInternal: false, canWrite: true, periods: [] }));
  }, [ticketId]);

  // Suppress the in-app banner for the thread currently on screen.
  useEffect(() => {
    setActiveThread(ticketId);
    // The server suppresses pushes for a thread that is open, so it has to
    // be told — and told again on reconnect, since presence lives with the
    // socket that reported it.
    signalRService.enterThread(ticketId);
    return () => {
      setActiveThread(null);
      signalRService.leaveThread(ticketId);
    };
  }, [ticketId, setActiveThread]);

  // Mirror the outbox so queued-but-unsent messages stay visible in the
  // thread (greyed, with a clock) instead of vanishing until they land.
  useEffect(() => {
    const sync = () => {
      outbox.pendingFor(ticketId).then(setPending);
    };
    sync();
    return outbox.subscribe(sync);
  }, [ticketId]);

  // Live incoming messages for THIS ticket (W7 groups / W8 events)
  useEffect(() => {
    const off = signalRService.onChatMessageReceived((evt) => {
      if (evt.ticketId !== ticketId) return;
      // The event carries no room, so only refetch what is on screen rather
      // than appending an internal message into the work thread.
      if (room !== ChatRoom.Work) { load(); return; }
      // The broadcast is one payload for everybody and says mine=false.
      // Only this device knows who it is, so it answers that here —
      // otherwise a message landed on the wrong side until the screen was
      // closed and reopened.
      const incoming: ChatMessage = {
        ...evt.message,
        mine:
          (agent != null && evt.message.senderAgentId === agent.id) ||
          (manager != null && evt.message.senderUserId === manager.id),
      };
      setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
      chatApi.markRead(ticketId).then(() => refreshUnread()).catch(() => {});
    });
    return off;
  }, [ticketId, room, load, agent, manager]);

  const send = async (image?: ChatImage) => {
    const text = draft.trim();
    if (!text && !image) return;

    setSending(true);
    // A UUID per send makes the request idempotent server-side, so a retry
    // after a dropped connection can't post the same message twice.
    const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const saved = await chatApi.sendMessage(ticketId, clientMessageId, text || undefined, image, room);
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      setDraft('');
    } catch (e) {
      if (isNetworkError(e)) {
        // Offline: queue it and clear the composer — the same
        // clientMessageId gets retried when connectivity returns, and the
        // backend de-dupes if it actually landed before the drop.
        await outbox.enqueue({ id: clientMessageId, ticketId, text: text || undefined, image });
        setDraft('');
      }
      // A real server rejection keeps the draft so nothing is lost.
    } finally {
      setSending(false);
    }
  };

  const attachImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      send(await shrinkForUpload({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType, width: a.width, height: a.height }));
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      send(await shrinkForUpload({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType, width: a.width, height: a.height }));
    }
  };

  const rows = buildRows(messages, access?.periods ?? []);

  const endReasonLabel = (r: string | null) => {
    switch (r) {
      case 'Rejected': return t('chat.periodRejected');
      case 'TimedOut': return t('chat.periodTimedOut');
      case 'Reassigned': return t('chat.periodReassigned');
      case 'TicketClosed': return t('chat.periodClosed');
      default: return t('chat.periodActive');
    }
  };

  const renderBubble = (item: ChatMessage, prev?: ChatMessage) => {
    // "Mine" = sent from this app by an agent. Manager/WhatsApp rows are the
    // other side; system rows are neither and get their own centred style.
    const isSystem = item.senderType === ChatSenderType.System;
    const mine = item.mine;
    const isLegacy = item.senderType === ChatSenderType.WhatsApp;
    const showDay = !prev || dayLabel(prev.sentAt) !== dayLabel(item.sentAt);

    if (isSystem) {
      return (
        <View key={item.id}>
          {showDay && (
            <View style={styles.dayDivider}>
              <Text style={styles.dayText}>{dayLabel(item.sentAt)}</Text>
            </View>
          )}
          <View style={styles.systemRow}>
            <Text style={styles.systemText}>{item.text}</Text>
            <Text style={styles.systemTime}>{timeLabel(item.sentAt)}</Text>
          </View>
        </View>
      );
    }

    return (
      <View key={item.id}>
        {showDay && (
          <View style={styles.dayDivider}>
            <Text style={styles.dayText}>{dayLabel(item.sentAt)}</Text>
          </View>
        )}
        <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
          {!mine && (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(item.senderName || '?')}</Text>
            </View>
          )}
          <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs, isLegacy && styles.bubbleLegacy]}>
            {!mine && <Text style={styles.senderName}>{item.senderName}</Text>}
            {isLegacy && <Text style={styles.legacyTag}>{t('chat.viaWhatsApp')}</Text>}
            {item.imageUrl && (
              <TouchableOpacity onPress={() => setViewerUri(item.imageUrl)} activeOpacity={0.85}>
                <Image source={{ uri: item.imageUrl }} style={styles.messageImage} resizeMode="cover" />
              </TouchableOpacity>
            )}
            {item.text && <Text style={[styles.messageText, mine && styles.messageTextMine]}>{item.text}</Text>}
            <View style={styles.metaRow}>
              <Text style={[styles.time, mine && styles.timeMine]}>{timeLabel(item.sentAt)}</Text>
              {mine && item.seen && <Text style={styles.seen}>✓✓</Text>}
            </View>
          </View>
        </View>
      </View>
    );
  };

  const renderRow = ({ item, index }: { item: Row; index: number }) => {
    if (item.kind === 'msg') {
      const prevRow = rows[index - 1];
      const prev = prevRow?.kind === 'msg' ? prevRow.message : undefined;
      return renderBubble(item.message, prev);
    }

    const { period, messages: inside } = item;
    const open = expanded.has(period.agentId);
    return (
      <View style={styles.periodBlock}>
        <TouchableOpacity
          style={styles.periodHeader}
          activeOpacity={0.7}
          onPress={() =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(period.agentId)) next.delete(period.agentId);
              else next.add(period.agentId);
              return next;
            })
          }
        >
          <Text style={styles.periodChevron}>{open ? '▾' : '▸'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.periodName} numberOfLines={1}>{period.agentName}</Text>
            <Text style={styles.periodMeta} numberOfLines={1}>
              {t('chat.periodCount', { count: inside.length })} · {endReasonLabel(period.endReason)}
            </Text>
          </View>
        </TouchableOpacity>
        {open && <View style={styles.periodBody}>{inside.map((m, i) => renderBubble(m, inside[i - 1]))}</View>}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.back}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title ?? t('chat.title')}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {ticketId}
          </Text>
        </View>
      </View>

      {/* Two rooms, not a picker above the keyboard: you write into the room
          you are standing in, so there is no control to misread and no way
          to put an internal remark in front of the technician. He is never
          shown this switch at all. */}
      {access?.canSeeInternal && (
        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentItem, room === ChatRoom.Work && styles.segmentItemActive]}
            onPress={() => setRoom(ChatRoom.Work)}
          >
            <Text style={[styles.segmentText, room === ChatRoom.Work && styles.segmentTextActive]}>
              {t('chat.roomWork')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentItem, room === ChatRoom.Internal && styles.segmentItemActive]}
            onPress={() => setRoom(ChatRoom.Internal)}
          >
            <Text style={[styles.segmentText, room === ChatRoom.Internal && styles.segmentTextActive]}>
              🔒 {t('chat.roomInternal')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {room === ChatRoom.Internal && (
        <Text style={styles.internalHint}>{t('chat.internalHint')}</Text>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{t('chat.loadError')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r, i) => (r.kind === 'msg' ? `m${r.message.id}` : `p${r.period.agentId}-${i}`)}
          renderItem={renderRow}
          contentContainerStyle={messages.length === 0 ? styles.center : styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.muted}>{t('chat.empty')}</Text>}
          ListFooterComponent={
            pending.length > 0 ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {pending.map((p) => (
                  <View key={p.id} style={[styles.row, styles.rowMine]}>
                    <View style={[styles.bubble, styles.bubbleMine, styles.bubblePending]}>
                      {p.image && <Image source={{ uri: p.image.uri }} style={styles.messageImage} resizeMode="cover" />}
                      {p.text && <Text style={[styles.messageText, styles.messageTextMine]}>{p.text}</Text>}
                      <View style={styles.metaRow}>
                        <Text style={styles.pendingLabel}>🕐 {t('chat.queued')}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null
          }
        />
      )}

      {access && !access.canWrite ? (
        // He keeps his own history — the photos he took and what he was told
        // — but the job is somebody else's now, and a message from him would
        // arrive where nobody is expecting one.
        <View style={[styles.readOnly, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Text style={styles.readOnlyText}>{t('chat.readOnly')}</Text>
        </View>
      ) : (
      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TouchableOpacity style={styles.attachButton} onPress={takePhoto} disabled={sending}>
          <Text style={styles.attachIcon}>📷</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachButton} onPress={attachImage} disabled={sending}>
          <Text style={styles.attachIcon}>🖼️</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
          onPress={() => send()}
          disabled={!draft.trim() || sending}
        >
          {sending ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.sendIcon}>➤</Text>}
        </TouchableOpacity>
      </View>
      )}

      <ImageViewerModal uri={viewerUri} onClose={() => setViewerUri(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segmentItem: { flex: 1, paddingVertical: spacing.xs + 3, borderRadius: radius.pill, alignItems: 'center' },
  segmentItemActive: { backgroundColor: colors.green },
  segmentText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  segmentTextActive: { color: colors.white },
  internalHint: {
    fontSize: 11,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },

  systemRow: { alignItems: 'center', paddingVertical: spacing.xs, gap: 2 },
  systemText: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: spacing.lg,
  },
  systemTime: { fontSize: 10, color: colors.muted },

  periodBlock: { marginVertical: spacing.xs },
  periodHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  periodChevron: { fontSize: 13, color: colors.muted },
  periodName: { fontSize: 14, fontWeight: '700', color: colors.forest },
  periodMeta: { fontSize: 11, color: colors.muted, marginTop: 1 },
  periodBody: { marginTop: spacing.sm, gap: spacing.xs },

  readOnly: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  readOnlyText: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 18 },

  root: { flex: 1, backgroundColor: colors.surface },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  muted: { color: colors.muted, fontSize: 14 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.forest, fontSize: 28, fontWeight: '600', marginTop: -4 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.forest },
  headerSub: { fontSize: 12, color: colors.muted, marginTop: 1 },

  list: { padding: spacing.md, gap: spacing.sm },

  dayDivider: { alignItems: 'center', marginVertical: spacing.sm },
  dayText: {
    fontSize: 11,
    color: colors.muted,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },

  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, maxWidth: '85%' },
  rowMine: { alignSelf: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start' },

  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: tint(colors.statusAccepted, '2A'),
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { fontSize: 10, fontWeight: '700', color: colors.forest },

  bubble: { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  bubbleMine: { backgroundColor: colors.green, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  bubbleLegacy: { borderStyle: 'dashed' },
  bubblePending: { opacity: 0.55 },
  pendingLabel: { fontSize: 10, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },

  senderName: { fontSize: 11, fontWeight: '700', color: colors.muted, marginBottom: 2 },
  legacyTag: { fontSize: 10, color: colors.warning, fontStyle: 'italic', marginBottom: 2 },
  messageText: { fontSize: 15, color: colors.text, lineHeight: 20 },
  messageTextMine: { color: colors.white },
  messageImage: { width: 200, height: 150, borderRadius: radius.sm, marginBottom: 4, backgroundColor: colors.surface },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2 },
  time: { fontSize: 10, color: colors.muted },
  timeMine: { color: 'rgba(255,255,255,0.75)' },
  seen: { fontSize: 10, color: 'rgba(255,255,255,0.9)', fontWeight: '700' },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachButton: { padding: spacing.sm },
  attachIcon: { fontSize: 20 },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.forest,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    maxHeight: 110,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendIcon: { color: colors.white, fontSize: 16, fontWeight: '700' },

  retryButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.green,
  },
  retryText: { color: colors.white, fontWeight: '700' },
});
