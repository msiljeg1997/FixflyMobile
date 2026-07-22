// Dark, professional theme (redesign 2026-07-21). Palette follows the
// GitHub Dark / Linear school of dark UI: a near-black (not pure black)
// base, one step of "card" elevation, soft low-opacity borders instead of
// shadows (shadows don't read on dark surfaces), and the Fixfly brand
// green kept as the sole strong accent so it still pops.
//
// Token roles (keep these separate — collapsing them is what broke the
// light theme when text and backgrounds accidentally shared a token):
//   surface -> app/screen background
//   card    -> elevated surface (cards, inputs, sheets, tab bar)
//   forest  -> primary/heading text (brightest neutral)
//   text    -> body text (slightly dimmer than forest)
//   muted   -> secondary/tertiary text, placeholders, disabled
//   white   -> text/icon color ON a solid colored fill (buttons, pills) —
//              NOT a background token; use `card` for backgrounds.
//   border  -> hairline dividers and input borders

export const colors = {
  surface: '#0D1117', // app background
  card: '#161B22', // elevated surface: cards, inputs, tab bar, sheets
  cardAlt: '#1C232C', // slightly lighter card, for nesting on top of `card`

  forest: '#F0F3F6', // primary/heading text
  text: '#C9D1D9', // body text
  muted: '#8B949E', // secondary text, placeholders
  white: '#FFFFFF', // text/icon on solid colored fills

  border: '#2A313C',

  green: '#0ACC6B',
  greenDark: '#09B85F',
  success: '#0ACC6B',
  error: '#F85149',
  warning: '#D29922',

  // Status colors (mirror TicketStatusColors in admin.models.ts on the dashboard)
  statusNew: '#3b82f6',
  statusForwarded: '#f59e0b',
  statusAccepted: '#a371f7',
  statusReturned: '#f85149',
  statusDone: '#3fb950',
  statusClosed: '#6e7681',
} as const;

// Low-opacity tint of a status color, for "soft chip" backgrounds (text
// stays the full-strength color on top) — reads calmer than a solid fill
// on a dark surface.
export function tint(hex: string, alpha = '26'): string {
  return `${hex}${alpha}`;
}

export const fonts = {
  family: 'Montserrat',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;
