package expo.modules.ghostexnative

import expo.modules.kotlin.exception.CodedException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeoutException
import net.schmizz.sshj.userauth.UserAuthException

/** Error codes shared with the TS contract (GhostexNative.types.ts / ARCHITECTURE.md). */
object GhostexErrorCode {
  const val AUTH_FAILED = "E_AUTH_FAILED"
  const val HOST_KEY_MISMATCH = "E_HOST_KEY_MISMATCH"
  const val UNREACHABLE = "E_UNREACHABLE"
  const val REFUSED = "E_REFUSED"
  const val TIMEOUT = "E_TIMEOUT"
  const val NOT_CONNECTED = "E_NOT_CONNECTED"
  const val CHANNEL_FAILED = "E_CHANNEL_FAILED"
  const val SFTP_FAILED = "E_SFTP_FAILED"
}

/** A [CodedException] whose `code` is one of the Ghostex contract error codes. */
class GhostexException(
  val errorCode: String,
  message: String,
  cause: Throwable? = null
) : CodedException(errorCode, message, cause)

internal fun notConnectedException(machineId: String): GhostexException =
  GhostexException(GhostexErrorCode.NOT_CONNECTED, "No SSH connection for machine \"$machineId\".")

private fun causeChain(error: Throwable): Sequence<Throwable> = sequence {
  var current: Throwable? = error
  var hops = 0
  while (current != null && hops < 12) {
    yield(current)
    current = current.cause
    hops++
  }
}

/**
 * Map an SSH failure onto a Ghostex contract error code. [fallbackCode] is used when the
 * exception does not clearly identify auth/reachability/timeout problems (e.g. channel or
 * SFTP failures keep their phase-specific code).
 */
internal fun mapSshError(error: Throwable, fallbackCode: String): GhostexException {
  if (error is GhostexException) return error
  val chain = causeChain(error).toList()
  val message = chain.firstNotNullOfOrNull { it.message?.takeIf(String::isNotBlank) }
    ?: error.javaClass.simpleName
  val code = when {
    chain.any { it is UserAuthException } -> GhostexErrorCode.AUTH_FAILED
    chain.any { it is UnknownHostException || it is NoRouteToHostException } -> GhostexErrorCode.UNREACHABLE
    chain.any { it is ConnectException } -> GhostexErrorCode.REFUSED
    chain.any { it is SocketTimeoutException || it is TimeoutException } -> GhostexErrorCode.TIMEOUT
    chain.any { it.message?.contains("timeout", ignoreCase = true) == true } -> GhostexErrorCode.TIMEOUT
    else -> fallbackCode
  }
  return GhostexException(code, message, error)
}
