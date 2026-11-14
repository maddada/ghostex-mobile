package expo.modules.ghostexnative

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * CDXC:RemoteMachines 2026-09-14 WHY:
 * A command join timeout excludes channel opening, writes and channel teardown.
 * Bound the whole native operation and close its socket so Retry never queues behind a dead read.
 */
internal object GhostexSshTask {
  private val deadlines = Executors.newScheduledThreadPool(2) { runnable ->
    Thread(runnable, "GhostexSshDeadline").apply { isDaemon = true }
  }

  fun deadline(timeoutMs: Long, expired: () -> Unit) =
    deadlines.schedule({ expired() }, timeoutMs, TimeUnit.MILLISECONDS)

  /**
   * [commandChannel] work waits for one of the connection's command slots first
   * (`GhostexSshConnection.withCommandChannel`); the deadline starts once it has one, so waiting
   * behind other commands never tears the transport down.
   */
  internal fun <T> run(
    connection: GhostexSshConnection,
    timeoutMs: Long,
    success: (T) -> Unit,
    failure: (Throwable) -> Unit,
    commandChannel: Boolean = false,
    probeChannel: Boolean = false,
    onDeadline: () -> Unit = { connection.abortTransport() },
    handle: GhostexExecHandle? = null,
    work: () -> T
  ) {
    val settled = AtomicBoolean(false)
    val bounded: () -> T = {
      val deadline = deadlines.schedule({
        if (!settled.get()) {
          // The operation learns it was abandoned before the timeout is published, so a command whose channel opens
          // late is never sent (GhostexSshExecChannel.kt); a connect still closes its socket here.
          onDeadline()
          if (settled.compareAndSet(false, true)) {
            failure(GhostexException(GhostexErrorCode.TIMEOUT, "The SSH operation timed out."))
          }
        }
      }, timeoutMs.coerceAtLeast(1), TimeUnit.MILLISECONDS)
      try {
        work()
      } finally {
        deadline.cancel(false)
      }
    }
    try {
      connection.workExecutor.execute {
        try {
          val result = when {
            probeChannel -> connection.withProbeChannel(handle, bounded)
            commandChannel -> connection.withCommandChannel(timeoutMs, handle, bounded)
            else -> bounded()
          }
          if (settled.compareAndSet(false, true)) success(result)
        } catch (error: Throwable) {
          if (settled.compareAndSet(false, true)) failure(error)
        }
      }
    } catch (error: Throwable) {
      if (settled.compareAndSet(false, true)) failure(error)
    }
  }
}
