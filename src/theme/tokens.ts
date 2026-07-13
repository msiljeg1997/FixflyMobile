// Brand tokens lifted from the Fixfly web dashboard (DomagojFront `main` branch —
// NOT the Tipico white-label branch, which uses a different red palette).
// Source: src/frontend/src/app/components/report-form/report-form.component.scss

export const colors = {
  green: '#0ACC6B',
  greenDark: '#09B85F',
  forest: '#03271B', // primary dark / text-on-green
  surface: '#e8ecf0',
  white: '#FFFFFF',
  text: '#1A1A1A',
  muted: '#6B6B6B',
  border: '#E2E8F0',
  error: '#E53E3E',
  warning: '#F59E0B',
  success: '#0ACC6B',

  // Status colors (mirror TicketStatusColors in admin.models.ts on the dashboard)
  statusNew: '#3b82f6',
  statusForwarded: '#f59e0b',
  statusAccepted: '#8b5cf6',
  statusReturned: '#ef4444',
  statusDone: '#10b981',
  statusClosed: '#6b7280',
} as const;

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
