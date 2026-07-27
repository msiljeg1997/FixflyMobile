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
import { signalRService } from '../realtime/signalr';
import { ChatMessage, ChatSenderType } from '../api/types';
import type { TasksStackParamList } from '../navigation/TasksStackNavigator';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { getInitials } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function ChatScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<TasksStackParamList>>();
  const route = useRoute<RouteProp<TasksStackParamList, 'Chat'>>();
  const { ticketId, title } = route.params;
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    try {
      const data = await chatApi.getMessages(ticketId);
      setMessages(data);
      // Opening the thread counts as reading it — drives the other side's
      // "Seen" and clears this ticket's unread badge.
      chatApi.markRead(ticketId).catch(() => {});
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live incoming messages for THIS ticket (W7 groups / W8 events)
  useEffect(() => {
    const off = signalRService.onChatMessageReceived((evt) => {
      if (evt.ticketId !== ticketId) return;
      setMessages((prev) => (prev.some((m) => m.id === evt.message.id) ? prev : [...prev, evt.message]));
      chatApi.markRead(ticketId).catch(() => {});
    });
    return off;
  }, [ticketId]);

  const send = async (image?: ChatImage) => {
    const text = draft.trim();
    if (!text && !image) return;

    setSending(true);
    // A UUID per send makes the request idempotent server-side, so a retry
    // after a dropped connection can't post the same message twice.
    const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const saved = await chatApi.sendMessage(ticketId, clientMessageId, text || undefined, image);
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      setDraft('');
    } catch {
      // Keep the draft so the text isn't lost — the user can just hit send again.
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
      send({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType });
    }
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      send({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType });
    }
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    // "Mine" = sent from this app by an agent. Manager/WhatsApp/System rows
    // are the other side of the conversation.
    const mine = item.senderType === ChatSenderType.Technician || item.senderType === ChatSenderType.Dispatcher;
    const isLegacy = item.senderType === ChatSenderType.WhatsApp;
    const prev = messages[index - 1];
    const showDay = !prev || dayLabel(prev.sentAt) !== dayLabel(item.sentAt);

    return (
      <>
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
      </>
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
          data={messages}
          keyExtractor={(m) => String(m.id)}
          renderItem={renderMessage}
          contentContainerStyle={messages.length === 0 ? styles.center : styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.muted}>{t('chat.empty')}</Text>}
        />
      )}

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

      <ImageViewerModal uri={viewerUri} onClose={() => setViewerUri(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
