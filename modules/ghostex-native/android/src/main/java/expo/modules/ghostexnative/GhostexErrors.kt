package expo.modules.ghostexnative

import expo.modules.kotlin.exception.CodedException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeoutException
import net.schmizz.sshj.connection.channel.OpenFailException
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

  /** startPortForward: the remote accepted the request but nothing listens on that port. */
  const val PORT_NOT_LISTENING = "E_PORT_NOT_LISTENING"

  /** startPortForward: the remote sshd refuses direct-tcpip channels. */
  const val FORWARDING_PROHIBITED = "E_FORWARDING_PROHIBITED"
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
  // A reset arrives only after the TCP connection was already established, so it is the
  // remote SSH server dropping us, not an unreachable machine. ConnectException is a
  // SocketException subclass, so it must be matched first.
  val refused = chain.any { it is ConnectException }
  val reset = !refused && chain.any {
    it is SocketException && it.message?.contains("reset", ignoreCase = true) == true
  }
  val code = when {
    chain.any { it is UserAuthException } -> GhostexErrorCode.AUTH_FAILED
    chain.any { it is UnknownHostException || it is NoRouteToHostException } -> GhostexErrorCode.UNREACHABLE
    refused || reset -> GhostexErrorCode.REFUSED
    chain.any { it is SocketTimeoutException || it is TimeoutException } -> GhostexErrorCode.TIMEOUT
    chain.any { it.message?.contains("timeout", ignoreCase = true) == true } -> GhostexErrorCode.TIMEOUT
    else -> fallbackCode
  }
  if (reset) {
    return GhostexException(
      code,
      "The SSH server closed the connection (connection reset). The machine was reached, " +
        "but its SSH server dropped the TCP connection.",
      error
    )
  }
  return GhostexException(code, message, error)
}

/**
 * Map a failed direct-tcpip channel open onto the contract. The SSH_MSG_CHANNEL_OPEN_FAILURE
 * reason separates "sshd refuses forwarding at all" from "the remote's loopback refused the
 * connection because nothing is bound to that port"; everything else is a transport problem
 * and keeps the shared mapping. The port number is user-facing, the machine id is not.
 */
internal fun mapPortForwardOpenError(error: Throwable, remotePort: Int): GhostexException {
  if (error is GhostexException) return error
  val openFailure = causeChain(error).filterIsInstance<OpenFailException>().firstOrNull()
  return when (openFailure?.reason) {
    OpenFailException.Reason.ADMINISTRATIVELY_PROHIBITED -> GhostexException(
      GhostexErrorCode.FORWARDING_PROHIBITED,
      "The remote SSH server does not allow port forwarding (AllowTcpForwarding).",
      error
    )
    OpenFailException.Reason.CONNECT_FAILED -> GhostexException(
      GhostexErrorCode.PORT_NOT_LISTENING,
      "Nothing is listening on port $remotePort on the remote machine.",
      error
    )
    else -> mapSshError(error, fallbackCode = GhostexErrorCode.CHANNEL_FAILED)
  }
}
