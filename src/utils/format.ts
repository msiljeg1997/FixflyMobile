import type { TaskCategory } from '../api/types';

export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * Compact timestamp for a conversation list: time of day for today, date for
 * anything older. The full "27.7.2026. 13:21" doesn't fit beside a title and
 * repeats a year nobody is reading off a chat row.
 */
export function formatChatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'numeric' });
}

/**
 * Human-readable duration. Raw minutes stop being readable fast — a
 * two-week-old ticket showed as "18700 min", which nobody can parse at a
 * glance. Scales to h and d, keeping one secondary unit for precision.
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes <= 0) return '–';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;

  const hours = Math.floor(m / 60);
  const remMinutes = m % 60;
  if (hours < 24) return remMinutes > 0 ? `${hours} h ${remMinutes} min` : `${hours} h`;

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} d ${remHours} h` : `${days} d`;
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

// Category icons come from the dashboard's master admin — either an emoji
// ("🔧") or a full data:image/svg+xml;base64 URI. The data-URI form must
// never be rendered as text (it prints a wall of base64).
export function categoryLabel(category: TaskCategory | null): string | null {
  if (!category) return null;
  const icon = category.icon?.trim() ?? '';
  const isRenderableAsText = icon.length > 0 && icon.length <= 8 && !icon.startsWith('data:');
  return isRenderableAsText ? `${icon} ${category.name}` : category.name;
}
