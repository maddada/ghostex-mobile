package expo.modules.ghostexnative

import android.util.Log
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import net.schmizz.sshj.SSHClient

/**
 * One SSH local port forward on top of an existing, already-authenticated connection: a
 * loopback listener on the phone whose every accepted socket gets its own direct-tcpip
 * channel to `localhost:<remotePort>` on the machine, with bytes piped both ways.
 *
 * The forward is owned by [GhostexSshConnection]; it is closed when that connection is
 * disconnected, reconnected, or replaced, so a stale listener can never outlive the SSH
 * session it dials through. A per-connection failure closes only that socket and its
 * channel — the listener keeps serving.
 */
internal class GhostexPortForward(
  private val machineId: String,
  val remotePort: Int,
  private val clientProvider: () -> SSHClient?
) {

  private val serverSocket =
    ServerSocket(ANY_LOCAL_PORT, ACCEPT_BACKLOG, InetAddress.getByName(LOOPBACK_HOST))

  /** OS-assigned loopback port the app connects to. */
  val localPort: Int = serverSocket.localPort

  private val closed = AtomicBoolean(false)

  /** Live per-connection socket/channel pairs, closed together when the forward stops. */
  private val liveConnections: MutableSet<ForwardedConnection> =
    Collections.newSetFromMap(ConcurrentHashMap<ForwardedConnection, Boolean>())

  /** One accept thread plus two pump threads per in-flight connection. */
  private val workers: ExecutorService = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "GhostexPortForward-$machineId-$remotePort").apply { isDaemon = true }
  }

  /** Begin accepting on the loopback listener. */
  fun start() {
    Log.i(LOG_TAG, "portForward $machineId:$remotePort listening on $LOOPBACK_HOST:$localPort")
    submit { acceptLoop() }
  }

  /** Close the listener and every in-flight connection. Safe to call repeatedly. */
  fun close() {
    if (!closed.compareAndSet(false, true)) return
    Log.i(LOG_TAG, "stopPortForward $machineId remotePort=$remotePort")
    closeQuietly(serverSocket)
    /*
     * The set is not cleared: a pump thread that is finishing its own connection
     * right now still has to find it here, and `remove` returning false is what
     * tells that thread the close below already happened. Every entry removes
     * itself in [finish].
     */
    for (connection in liveConnections.toList()) connection.close()
    workers.shutdownNow()
  }

  private fun acceptLoop() {
    while (!closed.get()) {
      val socket = try {
        serverSocket.accept()
      } catch (error: IOException) {
        if (!closed.get()) {
          Log.w(
            LOG_TAG,
            "portForward $machineId:$remotePort stopped accepting: " +
              (error.message ?: error.javaClass.simpleName)
          )
        }
        break
      }
      if (!submit { serveConnection(socket) }) closeQuietly(socket)
    }
  }

  /**
   * Give one accepted socket its own direct-tcpip channel and pipe both directions until
   * either side ends. Every failure here is local to this connection.
   */
  private fun serveConnection(socket: Socket) {
    val ssh = clientProvider()
    if (ssh == null || !ssh.isConnected) {
      Log.w(LOG_TAG, "portForward $machineId:$remotePort dropped a connection: SSH session is gone")
      closeQuietly(socket)
      return
    }
    val channel = try {
      ssh.newDirectConnection(REMOTE_LOOPBACK_HOST, remotePort)
    } catch (error: Exception) {
      Log.w(
        LOG_TAG,
        "portForward $machineId:$remotePort dial failed: " +
          (error.message ?: error.javaClass.simpleName)
      )
      closeQuietly(socket)
      return
    }

    val connection = ForwardedConnection(socket, channel)
    liveConnections.add(connection)
    /*
     * [close] may have swept the set between the dial above and this add, in
     * which case nothing else will ever close this pair. Re-checking here is the
     * only place that can catch it.
     */
    if (closed.get()) {
      finish(connection)
      return
    }
    try {
      socket.tcpNoDelay = true
    } catch (ignored: IOException) {
      // Nagle stays on; the forward still works.
    }

    // Remote -> local on a worker, local -> remote on this thread. Whichever direction
    // ends first tears the pair down, which unblocks the other pump's read.
    val remoteToLocalStarted = submit {
      pump(channel.inputStream, socket.getOutputStream())
      finish(connection)
    }
    if (!remoteToLocalStarted) {
      finish(connection)
      return
    }
    pump(socket.getInputStream(), channel.outputStream)
    finish(connection)
  }

  /**
   * Retire one connection. [ForwardedConnection.close] is idempotent, so it is
   * called whether or not this thread was the one to take the entry out of the
   * set — otherwise the loser of a race between the two pump threads, or between
   * a pump thread and [close], would drop a socket and a channel unclosed.
   */
  private fun finish(connection: ForwardedConnection) {
    liveConnections.remove(connection)
    connection.close()
  }

  private fun submit(work: () -> Unit): Boolean {
    return try {
      workers.execute(work)
      true
    } catch (ignored: RejectedExecutionException) {
      // The forward is being torn down; the caller closes what it holds.
      false
    }
  }

  /** One socket paired with the direct-tcpip channel that carries it. */
  private class ForwardedConnection(val socket: Socket, val channel: Closeable) {
    private val closed = AtomicBoolean(false)

    fun close() {
      if (!closed.compareAndSet(false, true)) return
      closeQuietly(socket)
      closeQuietly(channel)
    }
  }

  companion object {
    /** Same logcat tag as the rest of the SSH transport. */
    private const val LOG_TAG = "GhostexSsh"

    /** The forward is reachable from this device only; the SSH channel carries the traffic. */
    private const val LOOPBACK_HOST = "127.0.0.1"

    /** direct-tcpip target host, resolved on the remote machine. */
    private const val REMOTE_LOOPBACK_HOST = "localhost"

    /** 0 asks the OS for a free port, which [localPort] then reports. */
    private const val ANY_LOCAL_PORT = 0
    private const val ACCEPT_BACKLOG = 32
    private const val PUMP_BUFFER_BYTES = 32 * 1024

    private fun pump(input: InputStream, output: OutputStream) {
      val buffer = ByteArray(PUMP_BUFFER_BYTES)
      try {
        while (true) {
          val count = input.read(buffer)
          if (count == -1) break
          output.write(buffer, 0, count)
          output.flush()
        }
      } catch (ignored: IOException) {
        // Either end closing mid-transfer is ordinary teardown for a forwarded connection.
      }
    }

    private fun closeQuietly(closeable: Closeable) {
      try {
        closeable.close()
      } catch (ignored: Exception) {
        // Closing an already-dead socket or channel is not actionable.
      }
    }
  }
}
