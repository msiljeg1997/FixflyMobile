import type { TFunction } from 'i18next';
import { ChatMessage, ChatSenderType } from '../api/types';

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

/** What to call the author of a system line. */
export function senderLabel(m: ChatMessage, t: TFunction): string {
  return m.senderType === ChatSenderType.System ? t('sys.system') : m.senderName;
}
