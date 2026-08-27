import type { TFunction } from 'i18next';
import { ChatMessage, ChatSenderType } from '../api/types';
import type { LocationType, TaskDetail } from '../api/types';

/**
 * The sentence for a system line on a ticket thread, in the language this
 * phone is set to.
 *
 * These arrived from the server as finished Croatian text, so a technician
 * running the app in German read Croatian on the thread and there was nothing
 * left to translate it from. The reader's language is not knowable at write
 * time either — the same person can have this app in Croatian and the web
 * dashboard in English — so the server sends the event and its names, and the
 * sentence is assembled here.
 *
 * Falls back to the stored text for every row written before the server
 * recorded events, and for any event kind this build does not know: an app on
 * an old phone must still show something true rather than an empty bubble.
 */
export function systemLine(m: ChatMessage, t: TFunction): string {
  if (m.systemEvent == null) return m.text ?? '';

  let data: Record<string, unknown> = {};
  try {
    data = m.systemEventData ? JSON.parse(m.systemEventData) : {};
  } catch {
    return m.text ?? '';
  }

  // A timeout with nobody holding the ticket has no name to print, so the
  // placeholder is written in the reader's language rather than arriving as
  // the Croatian word the server would otherwise have stamped.
  if (!data.who) data.who = t('sys.someone');

  // Some events read differently with and without their free-text tail, and
  // i18next has no "if this key is empty" — so the variant is picked here.
  const variant =
    m.systemEvent === 3 && data.reason ? '3_reason'
    : m.systemEvent === 5 && data.comment ? '5_comment'
    : m.systemEvent === 8 && data.comment ? '8_comment'
    : String(m.systemEvent);

  const key = `sys.${variant}`;
  // Cast: t() is typed to return the resource shape, which includes objects
  // for nested keys. Every sys.* key is a plain string.
  const out = t(key, data as any) as unknown as string;

  // i18next echoes the key back when it is missing; the stored sentence is
  // better than showing "sys.7" to somebody.
  return out === key ? (m.text ?? '') : out;
}

/**
 * The assignment note on a task, worded for this reader.
 *
 * The server writes it as Croatian text when the system is the author —
 * "Preuzeo hausmajstor" — which is the wrong language for a German technician
 * and, outside a building, the wrong job title: only a Zgrada has a
 * Hausmajstor, everywhere else has a manager. So the event and the venue kind
 * are rendered here instead.
 *
 * Falls back to the stored note for anything a person actually typed, and for
 * any event this build does not know.
 */
export function assignmentNote(task: TaskDetail, t: TFunction): string {
  if (task.assignmentEvent !== 1) return task.assignmentNote ?? '';

  // The venue kind is stamped on the event, so a location re-typed later does
  // not retitle what somebody did months ago. Falls back to the ticket's
  // current venue for rows written before it was stamped.
  let stamped: LocationType | null = null;
  try {
    stamped = task.assignmentEventData ? JSON.parse(task.assignmentEventData).locationType ?? null : null;
  } catch {
    stamped = null;
  }

  const kind = stamped ?? task.locationType;
  return t(kind === 'Zgrada' ? 'sys.took_caretaker' : 'sys.took_manager') as unknown as string;
}

/** What to call the author of a system line. */
export function senderLabel(m: ChatMessage, t: TFunction): string {
  return m.senderType === ChatSenderType.System ? t('sys.system') : m.senderName;
}
