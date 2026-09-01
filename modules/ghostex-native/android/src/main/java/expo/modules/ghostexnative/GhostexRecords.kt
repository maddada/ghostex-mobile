package expo.modules.ghostexnative

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Mirrors `SshConfig` in GhostexNative.types.ts. */
class SshConfigRecord : Record {
  @Field var host: String = ""
  @Field var port: Int = 22
  @Field var username: String = ""
  @Field var password: String? = null
  @Field var privateKey: String? = null
  @Field var passphrase: String? = null
  @Field var keepAliveEnabled: Boolean = true
  /** Seconds between SSH keep-alive packets; clamped to 10-120 at connect time. */
  @Field var keepAliveIntervalSec: Int = 30
  /**
   * tailcat peer token. When non-blank the connection dials a tailcat loopback
   * forward instead of [host]:[port]; host-key identity still uses [host]:[port].
   */
  @Field var tailcatToken: String = ""
}

/** Mirrors `OpenTerminalOptions` in GhostexNative.types.ts. */
class OpenTerminalOptionsRecord : Record {
  @Field var command: String? = null
  @Field var termType: String? = null
  @Field var fontSize: Double? = null
  /** True for `ghostex attach` (zmx-backed) sessions; enables the post-attach viewport refresh. */
  @Field var zmxBacked: Boolean = false
  /** Scrollback row limit for the new buffer; 500-20000 in 500-row steps, default 2000. */
  @Field var scrollbackRows: Int? = null
}

/**
 * Mirrors `TerminalRuntimeSettings` in GhostexNative.types.ts. Defaults match the
 * pre-settings behavior so terminals opened before the first setTerminalSettings
 * call render exactly as they always have.
 */
class TerminalRuntimeSettingsRecord : Record {
  @Field var autoScroll: Boolean = true
  @Field var cursorStyle: String = "bar"
  @Field var cursorBlink: Boolean = false
  @Field var softKeyboardEnabled: Boolean = true
  @Field var openUrlsOnTap: Boolean = false
}

/** Mirrors `KeyModifiers` in GhostexNative.types.ts. */
class KeyModifiersRecord : Record {
  @Field var ctrl: Boolean = false
  @Field var alt: Boolean = false
  @Field var shift: Boolean = false
  @Field var cmd: Boolean = false
  @Field var ctrlLocked: Boolean = false
  @Field var altLocked: Boolean = false
  @Field var shiftLocked: Boolean = false
}

/** Mirrors `NotificationSessionRow` in GhostexNative.types.ts. */
class NotificationSessionRecord : Record {
  @Field var title: String = ""
  @Field var status: String = ""
  @Field var project: String = ""
  @Field var machineId: String = ""
  @Field var sessionId: String = ""
}
