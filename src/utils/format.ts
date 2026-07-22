import type { TaskCategory } from '../api/types';

export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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
