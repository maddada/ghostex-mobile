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
}

/** Mirrors `OpenTerminalOptions` in GhostexNative.types.ts. */
class OpenTerminalOptionsRecord : Record {
  @Field var command: String? = null
  @Field var termType: String? = null
  @Field var fontSize: Double? = null
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
