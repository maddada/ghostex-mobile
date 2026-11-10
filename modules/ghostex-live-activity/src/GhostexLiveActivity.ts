import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * The one Ghostex Live Activity (ActivityKit, iOS 16.2+): GhostexLiveActivityModule.swift, with the views in
 * the widget extension `ios/Extension` that `plugins/withWidgets.js` adds to the app.
 * Optional on purpose: it exists only on iOS (null on Android) and in builds made after it.
 *
 * `stateJson` is the content state `src/notifications/contentState.ts` builds. The module fits it into ActivityKit's
 * 4 KB (attributes plus state) by dropping rows from the end and raising `moreCount`. No call takes an alert: the
 * activity never sounds. The activity is requested with a push token, and every token iOS issues comes as an
 * `onPushToken` event, for the computer's Live Activity pushes (`liveActivityPushTokens` in `liveActivity.ts`).
 */
/** A push token iOS issued: `update` for the running activity, `start` (iOS 17.2+) to start one by push. Hex. */
export type LiveActivityPushToken = { kind: 'update' | 'start'; token: string };

type LiveActivityEvents = {
  onPushToken: (event: LiveActivityPushToken) => void;
};

declare class GhostexLiveActivityModule extends NativeModule<LiveActivityEvents> {
  /** Whether a Ghostex activity is active or stale (not ended, not dismissed). */
  hasActivity(): boolean;
  /** Starts the activity, or updates it if one already runs. Rejects when iOS refuses it (Live Activities off). */
  start(stateJson: string, staleDateMs: number): Promise<void>;
  update(stateJson: string, staleDateMs: number): Promise<void>;
  /** Ends every Ghostex activity and removes it at once. */
  end(): Promise<void>;
  /** The latest push tokens by kind; absent in builds before Live Activity pushes. */
  pushTokens?: () => Partial<Record<LiveActivityPushToken['kind'], string>>;
}

export const GhostexLiveActivity = requireOptionalNativeModule<GhostexLiveActivityModule>('GhostexLiveActivity');
