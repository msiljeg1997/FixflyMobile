import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import * as tasksApi from '../api/tasks';
import type { ResolveImage } from '../api/tasks';
import { AgentRole, TaskDetail, TicketStatus } from '../api/types';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { categoryLabel } from '../utils/format';
import { colors, radius, spacing } from '../theme/tokens';

const MAX_PHOTOS = 5;

export function TaskDetailScreen() {
  const { t } = useTranslation();
  const { agent } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'TaskDetail'>>();
  const { ticketId } = route.params;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [acting, setActing] = useState(false);

  // Reject form
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Resolve form
  const [resolving, setResolving] = useState(false);
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<ResolveImage[]>([]);

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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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

  const isMineToAccept =
    task.status === TicketStatus.ForwardedToTechnician ||
    (agent?.role === AgentRole.Hausmajstor &&
      (task.status === TicketStatus.New || task.status === TicketStatus.Returned));
  const canResolve = task.status === TicketStatus.Accepted;
  const canReject = task.status === TicketStatus.ForwardedToTechnician && agent?.role === AgentRole.Technician;
  const isDone = task.status === TicketStatus.Done || task.status === TicketStatus.Closed;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        {task.isUrgent && <Text style={styles.urgentBadge}>{t('tasks.urgent')}</Text>}
      </View>

      <Text style={styles.ticketId}>{task.ticketId}</Text>
      <Text style={styles.location}>
        {task.locationName || task.location}
        {task.roomNumber ? ` · ${t('tasks.room')} ${task.roomNumber}` : ''}
      </Text>
      {task.category && <Text style={styles.category}>{categoryLabel(task.category)}</Text>}

      {task.assignmentNote && (
        <View style={[styles.section, styles.noteSection]}>
          <Text style={styles.sectionLabel}>{t('taskDetail.assignmentNote')}</Text>
          <Text style={styles.description}>{task.assignmentNote}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('taskDetail.description')}</Text>
        <Text style={styles.description}>{task.description}</Text>
      </View>

      {task.imageUrl && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('taskDetail.reporterPhoto')}</Text>
          <Image source={{ uri: task.imageUrl }} style={styles.photo} resizeMode="cover" />
        </View>
      )}

      {isDone && (task.resolutionComment || task.resolutionPhotos.length > 0) && (
        <View style={[styles.section, styles.proofSection]}>
          <Text style={styles.sectionLabel}>{t('taskDetail.resolutionProof')}</Text>
          {task.resolutionComment && <Text style={styles.description}>{task.resolutionComment}</Text>}
          <View style={styles.photoRow}>
            {task.resolutionPhotos.map((p) => (
              <Image key={p.id} source={{ uri: p.url }} style={styles.thumb} />
            ))}
          </View>
        </View>
      )}

      {/* Actions */}
      {!isDone && !resolving && !rejecting && (
        <View style={styles.actions}>
          {isMineToAccept && (
            <TouchableOpacity style={styles.primaryButton} onPress={onAccept} disabled={acting}>
              {acting ? <ActivityIndicator color={colors.white} /> : (
                <Text style={styles.primaryButtonText}>{t('taskDetail.accept')}</Text>
              )}
            </TouchableOpacity>
          )}
          {canResolve && (
            <TouchableOpacity style={styles.primaryButton} onPress={() => setResolving(true)} disabled={acting}>
              <Text style={styles.primaryButtonText}>{t('taskDetail.resolve')}</Text>
            </TouchableOpacity>
          )}
          {canReject && (
            <TouchableOpacity style={styles.dangerButton} onPress={() => setRejecting(true)} disabled={acting}>
              <Text style={styles.dangerButtonText}>{t('taskDetail.reject')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Reject form */}
      {rejecting && (
        <View style={styles.formCard}>
          <Text style={styles.sectionLabel}>{t('taskDetail.rejectReason')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('taskDetail.rejectPlaceholder')}
            value={rejectReason}
            onChangeText={setRejectReason}
            multiline
          />
          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setRejecting(false)} disabled={acting}>
              <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dangerButton, { flex: 1 }]}
              onPress={onReject}
              disabled={acting}
            >
              {acting ? <ActivityIndicator color={colors.white} /> : (
                <Text style={styles.dangerButtonText}>{t('taskDetail.rejectConfirm')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Resolve form */}
      {resolving && (
        <View style={styles.formCard}>
          <Text style={styles.sectionLabel}>{t('taskDetail.resolveComment')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('taskDetail.resolvePlaceholder')}
            value={comment}
            onChangeText={setComment}
            multiline
          />

          <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>
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

          <View style={styles.formButtons}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setResolving(false)} disabled={acting}>
              <Text style={styles.secondaryButtonText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, { flex: 1 }]}
              onPress={onResolve}
              disabled={acting || !comment.trim()}
            >
              {acting ? <ActivityIndicator color={colors.white} /> : (
                <Text style={styles.primaryButtonText}>{t('taskDetail.resolveConfirm')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, paddingTop: spacing.xl + spacing.md, paddingBottom: spacing.xl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, backgroundColor: colors.surface },
  muted: { color: colors.muted, fontSize: 14 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  back: { color: colors.forest, fontSize: 16, fontWeight: '600' },
  urgentBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },

  ticketId: { fontSize: 13, color: colors.muted, marginBottom: 2 },
  location: { fontSize: 20, fontWeight: '700', color: colors.forest },
  category: { fontSize: 14, color: colors.muted, marginTop: 2 },

  section: { marginTop: spacing.lg },
  proofSection: {
    backgroundColor: '#eafaf1',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noteSection: {
    backgroundColor: '#fff7e6',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  photo: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.border },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.border },
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

  actions: { marginTop: spacing.xl, gap: spacing.sm },
  formCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  formButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },

  primaryButton: {
    backgroundColor: colors.green,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  secondaryButtonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  dangerButton: {
    backgroundColor: colors.error,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  dangerButtonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});
