package expo.modules.ghostexnative

import android.os.SystemClock
import android.util.Log
import java.io.FilterInputStream
import java.io.FilterOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.atomic.AtomicLong
import javax.net.SocketFactory

/**
 * CDXC:RemoteMachines 2026-11-14 WHY:
 * Android noticed a dead link only through sshj's keep-alive, which needs 150-180 s at the default 30 s interval and
 * never fires while a bulk write is blocked: its own write waits on the transport's write lock that the blocked writer
 * holds, so an upload over a path that went silent hung until the kernel gave up (about 15 minutes). The iPhone notices
 * both in about a minute (its `checkLiveness`). This watches the socket itself: every byte read, and every 64 KB the
 * socket accepted, is proof the path still moves; with neither for twice the keep-alive interval plus 5 s the socket is
 * closed from this thread, which needs no sshj lock and frees a blocked writer too. The disconnect listener then reports
 * the drop as before. A healthy idle link reads the computer's keep-alive replies every interval; a slow upload keeps
 * crossing 64 KB. Small writes alone (a keep-alive into a dead path is accepted by the kernel) never count.
 * Every time here is `SystemClock.uptimeMillis()`, a monotonic clock that stops in deep sleep: a wall-clock correction
 * must neither close a healthy link nor postpone noticing a dead one, and the time the phone slept is not silence, so a
 * healthy link is not closed the moment the phone wakes (the app's own check on returning to the front covers a link
 * that really died meanwhile).
 * SEE-ALSO: modules/ghostex-native/ios/SSH/SSHConnection.swift (`checkLiveness`), GhostexSshConnection.kt (`connect`).
 */
internal class GhostexSshLiveness(private val machineId: String) {
  private val lastReadAt = AtomicLong(SystemClock.uptimeMillis())
  private val lastWriteProgressAt = AtomicLong(SystemClock.uptimeMillis())
  private val writtenBytes = AtomicLong(0)

  @Volatile private var watchdog: Thread? = null

  /** Creates the SSH socket so its reads and writes are seen here. */
  val socketFactory: SocketFactory =
    object : SocketFactory() {
      override fun createSocket(): Socket = WatchedSocket()

      override fun createSocket(host: String, port: Int): Socket =
        WatchedSocket().apply { connect(InetSocketAddress(host, port)) }

      override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
        WatchedSocket().apply {
          bind(InetSocketAddress(localHost, localPort))
          connect(InetSocketAddress(host, port))
        }

      override fun createSocket(host: InetAddress, port: Int): Socket =
        WatchedSocket().apply { connect(InetSocketAddress(host, port)) }

      override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket =
        WatchedSocket().apply {
          bind(InetSocketAddress(localAddress, localPort))
          connect(InetSocketAddress(address, port))
        }
    }

  /** Milliseconds since the path last proved it moves. */
  fun silentMs(now: Long = SystemClock.uptimeMillis()): Long =
    now - maxOf(lastReadAt.get(), lastWriteProgressAt.get())

  /**
   * Starts watching once the connection is up. [limitMs] of silence calls [abort] once, unless [stillOpen] is false by
   * then (the connection was closed on purpose). One watchdog per connection.
   */
  fun start(limitMs: Long, stillOpen: () -> Boolean, abort: (String) -> Unit) {
    if (watchdog != null) return
    val now = SystemClock.uptimeMillis()
    lastReadAt.set(now)
    lastWriteProgressAt.set(now)
    watchdog =
      Thread(
          {
            try {
              while (stillOpen()) {
                Thread.sleep(CHECK_EVERY_MS)
                if (!stillOpen()) break
                val silent = silentMs()
                if (silent >= limitMs) {
                  val reason = "no answer from the computer for ${silent / 1_000} s"
                  Log.i(LOG_TAG, "liveness for $machineId: $reason; closing the socket")
                  abort(reason)
                  break
                }
              }
            } catch (_: InterruptedException) {
              // Stopped with the connection.
            }
          },
          "GhostexSshLiveness-$machineId"
        )
        .apply {
          isDaemon = true
          start()
        }
  }

  fun stop() {
    watchdog?.interrupt()
  }

  private fun noteRead(count: Int) {
    if (count > 0) lastReadAt.set(SystemClock.uptimeMillis())
  }

  private fun noteWritten(count: Int) {
    if (count <= 0) return
    val before = writtenBytes.getAndAdd(count.toLong())
    if ((before + count) / WRITE_PROGRESS_BYTES != before / WRITE_PROGRESS_BYTES) {
      lastWriteProgressAt.set(SystemClock.uptimeMillis())
    }
  }

  private inner class WatchedSocket : Socket() {
    private var input: InputStream? = null
    private var output: OutputStream? = null

    @Synchronized
    override fun getInputStream(): InputStream =
      input
        ?: object : FilterInputStream(super.getInputStream()) {
            override fun read(): Int = super.read().also { if (it >= 0) noteRead(1) }

            override fun read(b: ByteArray, off: Int, len: Int): Int =
              super.read(b, off, len).also { noteRead(it) }
          }
          .also { input = it }

    @Synchronized
    override fun getOutputStream(): OutputStream =
      output
        ?: object : FilterOutputStream(super.getOutputStream()) {
            override fun write(b: Int) {
              out.write(b)
              noteWritten(1)
            }

            override fun write(b: ByteArray, off: Int, len: Int) {
              out.write(b, off, len)
              noteWritten(len)
            }
          }
          .also { output = it }
  }

  companion object {
    private const val LOG_TAG = "GhostexSsh"
    private const val CHECK_EVERY_MS = 5_000L
    /** Accepted bytes that count as the path moving (more than a keep-alive ever sends). */
    private const val WRITE_PROGRESS_BYTES = 64L * 1024

    /** Silence after which the link is dead: twice the keep-alive interval plus 5 s (65 s at the default 30 s). */
    fun limitMs(keepAliveIntervalSec: Int): Long = keepAliveIntervalSec * 2_000L + 5_000L
  }
}
