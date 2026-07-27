import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as tasksApi from '../api/tasks';
import { signalRService } from '../realtime/signalr';
import { TaskListItem } from '../api/types';
import type { ChatStackParamList } from '../navigation/ChatStackNavigator';
import { colors, radius, spacing, tint } from '../theme/tokens';

// One conversation per ticket (backend W8). The threads a technician cares
// about are exactly their active tasks, so this lists those rather than
// inventing a separate conversation index the backend doesn't have.
export function ChatListScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ChatStackParamList>>();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (asRefresh = false) => {
    if (asRefresh) setRefreshing(true);
    try {
      const res = await tasksApi.getTasks('active');
      setItems(res.items);
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

  const renderItem = ({ item }: { item: TaskListItem }) => (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.7}
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
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.locationName || item.location}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {item.description}
        </Text>
      </View>
      {item.unreadChatCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.unreadChatCount}</Text>
        </View>
      )}
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

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
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.forest },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
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
