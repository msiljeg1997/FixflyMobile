import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as chatApi from '../api/chat';
import { signalRService } from '../realtime/signalr';
import { ChatThread } from '../api/types';
import type { ChatStackParamList } from '../navigation/ChatStackNavigator';
import { formatChatTimestamp } from '../utils/format';
import { colors, radius, spacing, tint } from '../theme/tokens';

// One conversation per ticket (backend W8), listed from /agent/chat/threads.
// This used to list the agent's ACTIVE TASKS instead, which was wrong twice
// over: tasks without a single message showed up as conversations (previewing
// the ticket description, then opening onto "no messages yet"), while real
// threads on returned or closed tickets were invisible.
export function ChatListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true);
    try {
      setItems(await chatApi.getThreads());
    } catch {
      setItems([]);
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

  // A new chat message can change unread counts on this list
  useEffect(() => {
    const off = signalRService.onChatMessageReceived(() => load(true));
    return off;
  }, [load]);

  /**
   * Long-press tidies an old job off this list. Worded as "remove from list"
   * and spelled out in the confirmation, because nothing is deleted — the
   * company keeps every message — and a button that said "delete" would be
   * lying to the person tapping it.
   */
  const confirmRemove = (item: ChatThread) => {
    Alert.alert(t('chat.removeFromList'), t('chat.removeFromListBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.removeFromList'),
        style: 'destructive',
        onPress: async () => {
          setItems((prev) => prev.filter((x) => x.ticketId !== item.ticketId));
          try {
            await chatApi.hideThread(item.ticketId);
          } catch {
            load(true); // put it back if the server disagreed
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: ChatThread }) => {
    const unread = item.unreadCount > 0;
    // A bare image has no text to preview — say so rather than showing nothing.
    const preview = item.lastMessageText ?? (item.lastMessageHasImage ? t('chat.photo') : '');
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onLongPress={() => confirmRemove(item)}
        onPress={() =>
          navigation.navigate('Chat', {
            ticketId: item.ticketId,
            title: item.locationName || item.location,
          })
        }
      >
        <View style={styles.icon}>
          <Text style={styles.iconText}>💬</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.rowTop}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.locationName || item.location}
            </Text>
            <Text style={styles.rowTime}>{formatChatTimestamp(item.lastMessageAt)}</Text>
          </View>
          <Text style={styles.rowTicket} numberOfLines={1}>
            {item.ticketId}
          </Text>
          <Text style={[styles.rowSub, unread && styles.rowSubUnread]} numberOfLines={1}>
            {item.lastMessageSenderName}: {preview}
          </Text>
        </View>
        {unread && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.unreadCount}</Text>
          </View>
        )}
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>{t('chat.title')}</Text>
        <Text style={styles.subtitle}>{t('chat.subtitle')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.green} size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.ticketId}
          renderItem={renderItem}
          contentContainerStyle={items.length === 0 ? styles.center : styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.green} />}
          ListEmptyComponent={<Text style={styles.muted}>{t('chat.noThreads')}</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { fontSize: 24, fontWeight: '700', color: colors.forest },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },

  list: { padding: spacing.md, gap: spacing.sm },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  muted: { color: colors.muted, fontSize: 14 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: tint(colors.green, '26'),
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: { fontSize: 18 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.forest },
  rowTime: { fontSize: 11, color: colors.muted },
  rowTicket: { fontSize: 11, color: colors.muted, marginTop: 1 },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 3 },
  rowSubUnread: { color: colors.forest, fontWeight: '600' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  chevron: { fontSize: 20, color: colors.muted },
});
