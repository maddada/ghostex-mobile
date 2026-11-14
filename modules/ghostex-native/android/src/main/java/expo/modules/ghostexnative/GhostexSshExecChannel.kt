package expo.modules.ghostexnative

import java.nio.charset.Charset
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import net.schmizz.concurrent.Event
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.Message
import net.schmizz.sshj.common.SSHPacket
import net.schmizz.sshj.connection.Connection
import net.schmizz.sshj.connection.ConnectionException
import net.schmizz.sshj.connection.channel.direct.SessionChannel

/**
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * A command past its deadline ends that command only. It used to close the whole connection's socket (taking every
 * terminal, forward and the chat with it), because `SSHClient.startSession()` creates, attaches and opens the channel
 * in one call and hands it back only after the open succeeded: a command stuck in its open left nothing to cancel.
 * `exec` now builds the channel itself, registers it here, and only then opens it. This one handle decides every race:
 * - The caller's deadline marks the handle `ABANDONED` before the timeout is published (`GhostexSshTask`), and an open
 *   that is confirmed later can no longer become `OPEN`: the command is never sent, the channel is only closed.
 * - sshj's own open timeout, then a late confirmation: the worker waits for it and closes the channel at once. One that
 *   comes after the worker stopped waiting is closed by the reader's hook (`stopWaitingForLateOpen`), exactly once.
 * - OPEN_FAILURE: sshj detaches the channel.
 * - Neither a confirmation nor a failure within sshj's timeout plus `LATE_OPEN_GRACE_MS` from the open's start: the
 *   transport is aborted (the one case that still ends the connection). That timer runs on its own, so an open stuck
 *   writing its request (a full send buffer, sshj's write lock) is bounded too.
 * - The exec request is sent under `sendLock`, and only while the handle is `OPEN`; the deadline's close waits for a send
 *   in progress. OpenSSH ends the whole connection on a request for a channel it already freed ("unknown channel"), so
 *   a request must never follow our CLOSE.
 * - The command slot (or the check's lane) is given back only when sshj detaches the channel (the computer's CLOSE, an
 *   open refusal, or the transport's end), never because a close stopped waiting: a close the computer does not
 *   answer keeps its slot, so timed-out commands cannot push the computer past its MaxSessions. Those closes are
 *   reported by `sshChannelStats`, which the phone's planned reset reads (src/remote/channelPressure.ts).
 * SEE-ALSO: GhostexSshTask.kt (`beforeTimeout`), GhostexSshConnection.exec, GhostexNativeModule.execAsync.
 */
internal class GhostexExecHandle {
  enum class State { OPENING, OPEN, ABANDONED, CLOSED }

  val state = AtomicReference(State.OPENING)
  private val openSettled = CountDownLatch(1)
  private val detached = AtomicBoolean(false)
  private val pendingRelease = AtomicReference<(() -> Unit)?>(null)
  private val stoppedWaiting = AtomicBoolean(false)
  private val lateCloseClaimed = AtomicBoolean(false)
  private val sendLock = Any()

  @Volatile
  var confirmed = false
    private set

  @Volatile
  var channel: GhostexOwnedSessionChannel? = null

  /** Runs a blocking close off the caller's thread (sshj's close waits for a reply only its reader delivers). */
  @Volatile
  var closeLater: (GhostexOwnedSessionChannel) -> Unit = { }

  /** When our CLOSE went out (0 before); a close unanswered 30 s later is stuck (`sshChannelStats`). */
  @Volatile
  var closeSentAt = 0L

  /** The independent bound on the open (`armOpenBound`). */
  @Volatile
  var openBound: ScheduledFuture<*>? = null

  val openIsSettled: Boolean get() = openSettled.count == 0L

  /**
   * sshj's reader thread: the computer confirmed the open, maybe after sshj's own wait gave up. The worker is still
   * waiting for it then (`awaitLateOpen`) and closes it at once; once it stopped waiting, the close is ours (off this
   * thread, `closeLater`), because the confirmation also cancelled the open's bound.
   */
  fun onConfirmed() {
    confirmed = true
    settleOpen()
    if (stoppedWaiting.get() && lateCloseClaimed.compareAndSet(false, true)) channel?.let(closeLater)
  }

  /** sshj's reader thread: the computer refused the open (sshj detaches the channel next). */
  fun onOpenFailed() {
    state.set(State.CLOSED)
    settleOpen()
  }

  /** sshj detached the channel: the computer's CLOSE, an open refusal, or the transport's end. Frees its slot. */
  fun onDetached() {
    detached.set(true)
    settleOpen()
    pendingRelease.getAndSet(null)?.invoke()
  }

  private fun settleOpen() {
    openSettled.countDown()
    openBound?.cancel(false)
  }

  /** Waits for a confirmation or a failure that has not come yet; true when one came. */
  fun awaitLateOpen(timeoutMs: Long): Boolean = openSettled.await(timeoutMs, TimeUnit.MILLISECONDS)

  /**
   * The worker is done waiting for a late answer. True when the open was confirmed and the worker closes the channel
   * now; a confirmation that comes later is closed by [onConfirmed]. Each confirmed channel is closed exactly once.
   */
  fun stopWaitingForLateOpen(): Boolean {
    stoppedWaiting.set(true)
    return confirmed && lateCloseClaimed.compareAndSet(false, true)
  }

  /**
   * Sends the exec request only while the handle is `OPEN`; null (nothing sent) once the deadline abandoned it. Holding
   * [sendLock] across the write orders it before the deadline's close ([awaitSendDone]).
   */
  fun <T> sendIfOpen(send: () -> T): T? = synchronized(sendLock) {
    if (state.get() == State.OPEN) send() else null
  }

  /**
   * The deadline's close calls this first: a send already past its `OPEN` check finishes writing, and any later one
   * sees `ABANDONED` (set before the close was scheduled) and sends nothing.
   */
  fun awaitSendDone() {
    synchronized(sendLock) { }
  }

  /**
   * Gives the slot back now when no channel holds it (never built, or already detached), else when sshj detaches it.
   * True when it was given back now. Exactly once either way.
   */
  fun releaseWhenDetached(release: () -> Unit): Boolean {
    if (channel == null) {
      release()
      return true
    }
    pendingRelease.set(release)
    if (detached.get()) {
      pendingRelease.getAndSet(null)?.invoke()
      return true
    }
    return pendingRelease.get() == null
  }

  /** The slot is still held by a channel that has not been detached. */
  val holdsSlot: Boolean get() = pendingRelease.get() != null

  /**
   * The caller's deadline passed. Called before the timeout is published. `OPENING` leaves the open to settle (the
   * worker closes whatever it gets), `OPEN` closes the channel now (after a send in progress) so the command ends.
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

  /** The worker's open returned: false when the deadline already abandoned it (the worker only closes the channel). */
  fun markOpen(): Boolean = state.compareAndSet(State.OPENING, State.OPEN)

  /** The command finished: a deadline that fires now has nothing to end. */
  fun markClosed() {
    state.set(State.CLOSED)
  }

  companion object {
    /** After sshj's own open timeout, how long a late confirmation or failure is still waited for. */
    const val LATE_OPEN_GRACE_MS = 5_000L
  }
}

/** A session channel whose open confirmation, refusal and detachment reach [handle] (sshj has no other hook). */
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

  /** `SessionChannel.exec`'s request, sent here so the write and the wait for its reply can be split (`sendIfOpen`). */
  fun sendExecRequest(command: String): Event<ConnectionException> =
    sendChannelRequest("exec", true, Buffer.PlainBuffer().putString(command, remoteCharset) as Buffer.PlainBuffer)

  override fun finishOff() {
    super.finishOff()
    handle.onDetached()
  }
}
