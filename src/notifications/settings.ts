/**
 * The notification switches in `settings.v1` (`notifications`): one master switch plus
 * one each for finished, waiting and error. All four start off and stay off until the one-time ask is answered
 * (`askedAt`). The waiting switch also governs "has a question" (only the wording differs). Kept free of React Native
 * so the rules are testable under `bun test`.
 */

/** How a kind of notice reaches the phone: with the notification sound, shown without a sound, or not at all. */
export type AlertChoice = 'sound' | 'silent' | 'off';

/**
 * The kinds the person chooses for: something needs them (a question, an approval, a wait); a session they talk to
 * finished its turn; a session stopped on an error (or is stuck or blocked); a thread under a coordinator finished a
 * turn (it reports to its coordinator, not to the person).
 */
export type AlertKindKey = 'needsYou' | 'finished' | 'errors' | 'threadReports';

export type AlertChoices = Record<AlertKindKey, AlertChoice>;

export const ALERT_KIND_KEYS: readonly AlertKindKey[] = ['needsYou', 'finished', 'errors', 'threadReports'];

/*
CDXC:Notifications 2026-11-11 DECISION: User: "fam we're showing so many notifications on iphone. hope we can reduce
this by default and only play sound when something finishes or when something needs the user instead as the user
configures it in settings (should have nice settings for this)". Each kind has Sound, Silent or Off; by default the
phone hears, with sound, only what needs the person, the turns they wait for and errors, and nothing of a thread's
turns under a coordinator. A setting stored before the choices keeps an Off switch Off and takes the defaults
otherwise. The finished, waiting and error switches stay, kept in step with the choices (not Off is on), for the code
and the computers that read them.
*/
export const DEFAULT_ALERT_CHOICES: AlertChoices = {
  needsYou: 'sound',
  finished: 'sound',
  errors: 'sound',
  threadReports: 'off',
};

export type NotificationSettings = {
  /** The master switch. */
  enabled: boolean;
  /** Kept in step with `choices.finished` (on unless Off). */
  finished: boolean;
  /** Waiting for you, including approvals and "has a question"; kept in step with `choices.needsYou`. */
  waiting: boolean;
  /** Kept in step with `choices.errors`. */
  error: boolean;
  /** Sound, Silent or Off for each kind. */
  choices: AlertChoices;
  /** When the first-launch ask was answered (ISO time); absent until then. */
  askedAt?: string;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  finished: false,
  waiting: false,
  error: false,
  choices: { ...DEFAULT_ALERT_CHOICES },
};

function isAlertChoice(value: unknown): value is AlertChoice {
  return value === 'sound' || value === 'silent' || value === 'off';
}

/** `settings` with `choices`, the finished, waiting and error switches following them. */
export function withAlertChoices(settings: NotificationSettings, choices: AlertChoices): NotificationSettings {
  return {
    ...settings,
    choices,
    finished: choices.finished !== 'off',
    waiting: choices.needsYou !== 'off',
    error: choices.errors !== 'off',
  };
}

/** The choice for a notice of `kind` (the phone's attention kinds; "has a question" is a wait). */
export function alertChoiceFor(
  kind: 'finished' | 'waiting' | 'question' | 'failed' | 'threadReport',
  settings: NotificationSettings,
): AlertChoice {
  switch (kind) {
    case 'finished':
      return settings.choices.finished;
    case 'failed':
      return settings.choices.errors;
    case 'threadReport':
      return settings.choices.threadReports;
    default:
      return settings.choices.needsYou;
  }
}

/**
 * A stored value as the app may use it. Anything malformed falls back to "not asked, all off"; a switch
 * stored on without `askedAt` is off, because nothing may notify before the ask.
 */
export function sanitizeNotificationSettings(value: unknown): NotificationSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  // The cast holds: `value` is a non-null object; each field taken from it is checked (`askedAt`, `=== true`).
  const record = value as Record<string, unknown>;
  const askedAt =
    typeof record.askedAt === 'string' && !Number.isNaN(Date.parse(record.askedAt)) ? record.askedAt : undefined;
  if (askedAt === undefined) return { ...DEFAULT_NOTIFICATION_SETTINGS };
  const bool = (key: 'enabled' | 'finished' | 'waiting' | 'error'): boolean => record[key] === true;
  const stored =
    typeof record.choices === 'object' && record.choices !== null ? (record.choices as Record<string, unknown>) : null;
  // Before the choices: an Off switch stays Off, every other kind takes its default.
  const before: AlertChoices = {
    needsYou: bool('waiting') ? DEFAULT_ALERT_CHOICES.needsYou : 'off',
    finished: bool('finished') ? DEFAULT_ALERT_CHOICES.finished : 'off',
    errors: bool('error') ? DEFAULT_ALERT_CHOICES.errors : 'off',
    threadReports: DEFAULT_ALERT_CHOICES.threadReports,
  };
  const choices = Object.fromEntries(
    ALERT_KIND_KEYS.map((key) => {
      const value = stored?.[key];
      return [key, isAlertChoice(value) ? value : before[key]];
    }),
  ) as AlertChoices;
  return withAlertChoices({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: bool('enabled'), askedAt }, choices);
}
