package expo.modules.ghostexnative

import java.nio.charset.Charset
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import net.schmizz.sshj.common.Message
import net.schmizz.sshj.common.SSHPacket
import net.schmizz.sshj.connection.Connection
import net.schmizz.sshj.connection.channel.direct.SessionChannel

/**
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * A command past its deadline ends that command only. It used to close the whole connection's socket (taking every
 * terminal, forward and the chat with it), because `SSHClient.startSession()` creates, attaches and opens the channel
 * in one call and hands it back only after the open succeeded: a command stuck in its open left nothing to cancel.
 * `exec` now builds the channel itself, registers it here, and only then opens it, so every race settles exactly once:
 * - Our deadline before the confirmation: the caller fails at once with E_TIMEOUT (`GhostexSshTask`), the channel is
 *   `ABANDONED`, and its command slot stays held until the open settles.
 * - sshj's own open timeout, then a late confirmation: the channel is still attached to the connection; the worker
 *   waits for that confirmation (the hook below) and closes the channel the moment it arrives.
 * - OPEN_FAILURE: sshj detaches the channel and the slot is freed.
 * - Neither a confirmation nor a failure within sshj's timeout plus `LATE_OPEN_GRACE_MS`: the channel can no longer be
 *   accounted for, so the transport is aborted (the one case that still ends the connection).
 * - Our deadline while the command runs: the channel is closed; its slot frees when the close returns.
 * SEE-ALSO: GhostexSshTask.kt (`onDeadline`), GhostexSshConnection.exec, GhostexNativeModule.execAsync.
 */
internal class GhostexExecHandle {
  enum class State { OPENING, OPEN, ABANDONED, CLOSED }

  val state = AtomicReference(State.OPENING)
  private val openSettled = CountDownLatch(1)

  @Volatile
  var confirmed = false
    private set

  @Volatile
  var channel: GhostexOwnedSessionChannel? = null

  /** Runs a blocking close off sshj's reader thread (the close waits for a reply only that thread delivers). */
  @Volatile
  var closeLater: (GhostexOwnedSessionChannel) -> Unit = { }

  /**
   * sshj's reader thread: the computer confirmed the open, maybe after sshj's own wait gave up. The worker is still
   * waiting for it then (`awaitLateOpen`) and closes it at once; past that wait the transport is aborted anyway.
   */
  fun onConfirmed() {
    confirmed = true
    openSettled.countDown()
  }

  /** sshj's reader thread: the computer refused the open; sshj has already detached the channel. */
  fun onOpenFailed() {
    state.set(State.CLOSED)
    openSettled.countDown()
  }

  /** Waits for a confirmation or a failure that has not come yet; true when one came. */
  fun awaitLateOpen(timeoutMs: Long): Boolean = openSettled.await(timeoutMs, TimeUnit.MILLISECONDS)

  /**
   * The caller's deadline passed. Returns the state it found: `OPENING` leaves the open to settle (the worker closes
   * whatever it gets), `OPEN` closes the channel now so the command ends.
   */
  fun abandon(): State {
    while (true) {
      val current = state.get()
      if (current == State.ABANDONED || current == State.CLOSED) return current
      if (state.compareAndSet(current, State.ABANDONED)) {
        if (current == State.OPEN) channel?.let(closeLater)
        return current
      }
    }
  }

  /** The worker's open returned: false when the deadline already abandoned it (the worker closes the channel). */
  fun markOpen(): Boolean = state.compareAndSet(State.OPENING, State.OPEN)

  companion object {
    /** After sshj's own open timeout, how long a late confirmation or failure is still waited for. */
    const val LATE_OPEN_GRACE_MS = 5_000L
  }
}

/** A session channel whose open confirmation and refusal reach [handle] (sshj has no other hook for a late one). */
internal class GhostexOwnedSessionChannel(
  connection: Connection,
  remoteCharset: Charset,
  private val handle: GhostexExecHandle
) : SessionChannel(connection, remoteCharset) {
  override fun gotUnknown(cmd: Message, buf: SSHPacket) {
    super.gotUnknown(cmd, buf)
    when (cmd) {
      Message.CHANNEL_OPEN_CONFIRMATION -> handle.onConfirmed()
      Message.CHANNEL_OPEN_FAILURE -> handle.onOpenFailed()
      else -> Unit
    }
  }
}
