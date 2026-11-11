package expo.modules.ghostexnative

import android.content.Context
import android.util.Log
import java.io.File

/**
 * CDXC:RemotePairing 2026-11-11 WHY:
 * Review of gxserver's pairing fix (finding 6), its finding 1. This phone's Easy Connect keys (the
 * shared `client.key` and each computer's own `machines/<id>.key`) lived in `filesDir/tailcat`,
 * which Android backup carries (cloud backup and device-to-device transfer; the app does not turn
 * backup off), while the device key that pairing proves the phone with stays in the Keystore,
 * which is never backed up. A phone restored from a backup, or the app reinstalled with a cloud
 * restore, so came back with the old Easy Connect key and a new device key, and a computer now
 * refuses that pairing (the key is held by the old entry under another device key) until the user
 * removes the old entry by hand.
 *
 * The keys now live in `noBackupFilesDir/tailcat`, which Android never backs up or transfers, so no
 * configuration has to be kept in step with the manifest Expo generates. The first start of this
 * build moves an existing folder there, once, but only when this install already holds its device
 * key: a key made on this install sits beside its device key, and a folder found without one came
 * back from a backup (or another phone), so it is not kept and the phone makes keys of its own, as
 * an iPhone restored to a new phone does. If the move fails the keys stay where they are and are
 * used from there, so a phone never loses the key its pairings use.
 */
object GhostexTailcatKeyDir {
  private const val NAME = "tailcat"
  private const val TAG = "GhostexNative"
  private var settled: File? = null

  /** The folder this phone's Easy Connect keys live in. */
  @Synchronized
  fun dir(context: Context): File {
    settled?.let { return it }
    val kept = File(context.noBackupFilesDir, NAME)
    val old = File(context.filesDir, NAME)
    val chosen = try {
      when {
        !old.exists() -> kept
        // Moved already; the old folder came back from a backup made before the move.
        kept.exists() -> {
          old.deleteRecursively()
          kept
        }
        !GhostexDeviceKey.exists() -> {
          Log.i(TAG, "Easy Connect keys restored from a backup were not kept; this phone makes its own")
          old.deleteRecursively()
          kept
        }
        old.renameTo(kept) -> {
          Log.i(TAG, "Easy Connect keys moved out of Android backup")
          kept
        }
        else -> {
          Log.w(TAG, "Could not move the Easy Connect keys out of Android backup; they stay where they are")
          old
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "Could not settle the Easy Connect key folder: ${error.message}")
      if (old.exists()) old else kept
    }
    settled = chosen
    return chosen
  }
}
