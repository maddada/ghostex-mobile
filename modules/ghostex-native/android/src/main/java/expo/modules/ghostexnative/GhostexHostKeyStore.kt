package expo.modules.ghostexnative

import android.content.Context
import android.content.SharedPreferences
import android.util.Base64
import java.security.MessageDigest
import java.security.PublicKey
import net.schmizz.sshj.transport.verification.HostKeyVerifier

/**
 * App-private persistence of accepted SSH host keys, ported from the Android fork's
 * GhostexSshTransport: OpenSSH `StrictHostKeyChecking=accept-new` semantics. Keys are stored
 * as SHA-256 fingerprints keyed by `host:port`; a changed key is rejected until
 * `resetHostKey(host, port)` clears the saved entry.
 */
class GhostexHostKeyStore(context: Context) {

  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(HOST_KEY_PREFS, Context.MODE_PRIVATE)

  fun savedFingerprint(host: String, port: Int): String? =
    prefs.getString(storageKey(host, port), null)?.takeIf { it.isNotEmpty() }

  fun saveFingerprint(host: String, port: Int, fingerprint: String) {
    prefs.edit().putString(storageKey(host, port), fingerprint).apply()
  }

  fun reset(host: String, port: Int) {
    prefs.edit().remove(storageKey(host, port)).apply()
  }

  companion object {
    private const val HOST_KEY_PREFS = "ghostex_ssh_host_keys"

    private fun storageKey(host: String, port: Int): String = "$host:$port"

    fun fingerprint(key: PublicKey): String = try {
      val digest = MessageDigest.getInstance("SHA-256").digest(key.encoded)
      Base64.encodeToString(digest, Base64.NO_WRAP)
    } catch (error: Exception) {
      key.algorithm + ":" + key.hashCode()
    }
  }
}

/**
 * SSHJ host key verifier backed by [GhostexHostKeyStore]. First connection trusts and persists
 * the key; a mismatch flips [sawMismatch] so the connect error can be reported as
 * `E_HOST_KEY_MISMATCH` (SSHJ itself only surfaces a generic transport error).
 */
class GhostexPersistedHostKeyVerifier(
  private val configuredHost: String,
  private val configuredPort: Int,
  private val store: GhostexHostKeyStore
) : HostKeyVerifier {

  @Volatile
  var sawMismatch: Boolean = false
    private set

  override fun verify(hostname: String?, port: Int, key: PublicKey): Boolean {
    val fingerprint = GhostexHostKeyStore.fingerprint(key)
    val saved = store.savedFingerprint(configuredHost, configuredPort)
    if (saved.isNullOrEmpty()) {
      store.saveFingerprint(configuredHost, configuredPort, fingerprint)
      return true
    }
    if (saved == fingerprint) return true
    sawMismatch = true
    return false
  }

  override fun findExistingAlgorithms(hostname: String?, port: Int): List<String> = emptyList()
}
