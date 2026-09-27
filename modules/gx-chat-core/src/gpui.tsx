/**
 * The GPUI chat transcript: the desktop's own chat renderer and Rust chat host (`packages/gpui-mobile`
 * in the Ghostex main repo), linked into the phone library by `packages/gx-chat-mobile/build.sh
 * --gpui` and drawn into {@link GpuiView}.
 *
 * GPUI runs for the life of the process: {@link startGpui} launches it once, {@link gpuiCommand}
 * queues a JSON command for it, and events come back through the view's `onEvent`, already parsed.
 * The command and event protocol is `packages/gpui-mobile/host/src/chat_root.rs`:
 * - commands: `setEndpoint {machineId, baseUrl, authToken}`, `openSession {machineId, projectId,
 *   sessionId}`, `closeSession`, `action {action}`, `forwardSnapshots {enabled}`, `scrollToEnd`,
 *   `state`, ...
 * - events: `ready {gpu}`, `snapshot {snapshot}`, `summary {summary}`, `hostAction {action,
 *   message}`, `toast {message, error}`, `copy {text}`, `request {request}`, `error {message}`.
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import * as React from 'react';
import type { ViewProps } from 'react-native';

export type GpuiEvent = { type: string; [field: string]: unknown };
export type GpuiCommand = { type: string; [field: string]: unknown };

/** `surface`: a SurfaceView (its own compositor layer). `texture`: a TextureView (composed like a view). */
export type GpuiSurfaceType = 'surface' | 'texture';

type NativeGpui = {
  isAvailable(): boolean;
  start(configJson: string): boolean;
  command(json: string): void;
};

type NativeViewProps = ViewProps & {
  surfaceType?: GpuiSurfaceType;
  onGpuiEvent?: (event: { nativeEvent: { json: string } }) => void;
};

const native = requireOptionalNativeModule<NativeGpui>('GpuiView');

let available: boolean | undefined;

/** Whether this build carries the GPUI transcript (a `--gpui` phone library). */
export function isGpuiAvailable(): boolean {
  if (available === undefined) {
    try {
      available = native?.isAvailable() ?? false;
    } catch {
      available = false;
    }
  }
  return available;
}

let NativeView: React.ComponentType<NativeViewProps> | null = null;

function nativeView(): React.ComponentType<NativeViewProps> {
  NativeView ??= requireNativeView<NativeViewProps>('GpuiView');
  return NativeView;
}

/** Launches GPUI with `config` (once per process); false when it was already running. */
export function startGpui(config: Record<string, unknown>): boolean {
  if (!native || !isGpuiAvailable()) throw new Error('This build has no GPUI transcript.');
  return native.start(JSON.stringify(config));
}

/** Queues one command for the GPUI content. Throws on a malformed command or before `startGpui`. */
export function gpuiCommand(message: GpuiCommand): void {
  if (!native || !isGpuiAvailable()) throw new Error('This build has no GPUI transcript.');
  native.command(JSON.stringify(message));
}

export type GpuiViewProps = ViewProps & {
  surfaceType?: GpuiSurfaceType;
  onEvent?: (event: GpuiEvent) => void;
};

/** Where GPUI draws. Mount it only when {@link isGpuiAvailable}. */
export function GpuiView({ onEvent, surfaceType = 'surface', ...props }: GpuiViewProps) {
  const onGpuiEvent = React.useCallback(
    (event: { nativeEvent: { json: string } }) => {
      let parsed: GpuiEvent;
      try {
        parsed = JSON.parse(event.nativeEvent.json) as GpuiEvent;
      } catch {
        return;
      }
      onEvent?.(parsed);
    },
    [onEvent]
  );
  const View = nativeView();
  return <View {...props} surfaceType={surfaceType} onGpuiEvent={onGpuiEvent} />;
}
