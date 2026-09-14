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

  fun <T> run(
    connection: GhostexSshConnection,
    timeoutMs: Long,
    success: (T) -> Unit,
    failure: (Throwable) -> Unit,
    work: () -> T
  ) {
    val settled = AtomicBoolean(false)
    val deadline = deadlines.schedule({
      if (settled.compareAndSet(false, true)) {
        // Settle before teardown: transport callbacks may also report this failure.
        failure(GhostexException(GhostexErrorCode.TIMEOUT, "The SSH operation timed out."))
        connection.abortTransport()
      }
    }, timeoutMs.coerceAtLeast(1), TimeUnit.MILLISECONDS)
    try {
      connection.workExecutor.execute {
        try {
          val result = work()
          if (settled.compareAndSet(false, true)) success(result)
        } catch (error: Throwable) {
          if (settled.compareAndSet(false, true)) failure(error)
        } finally {
          deadline.cancel(false)
        }
      }
    } catch (error: Throwable) {
      deadline.cancel(false)
      if (settled.compareAndSet(false, true)) failure(error)
    }
  }
}
