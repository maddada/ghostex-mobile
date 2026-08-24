package expo.modules.ghostexnative

import com.termux.terminal.TerminalSession
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors
import net.schmizz.sshj.connection.channel.direct.Session

/**
 * Interactive SSH PTY shell piped into a Termux [TerminalSession] via its
 * ExternalTerminalProcess seam. Ported from the Android fork's GhostexSshAttachProcess with
 * two structural changes: the channel is opened on the shared per-machine
 * [GhostexSshConnection] (instead of a private SSHClient), and the command is expected to be
 * fully quoted/login-shell wrapped by the JS layer (ARCHITECTURE.md `commands/`), so no
 * native login-shell wrapping happens here. The fork's resize coalescing worker is kept:
 * SSHJ sends `window-change` on the network socket, and Android invokes terminal resize from
 * the UI/layout path, so remote resizes are dispatched on a single background worker.
 */
class GhostexSshAttachProcess(
  private val connection: GhostexSshConnection,
  private val command: String?,
  private val termType: String,
  private val onStarted: () -> Unit,
  private val onStartFailed: (Throwable) -> Unit
) : TerminalSession.ExternalTerminalProcess {

  private val resizeExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "GhostexSshAttachResize").apply { isDaemon = true }
  }
  private val resizeLock = Object()

  @Volatile
  private var session: Session? = null

  @Volatile
  private var shell: Session.Shell? = null

  private var pendingResize: ResizeRequest? = null
  private var resizeWorkerRunning = false
  private var closed = false

  @Throws(Exception::class)
  override fun start(columns: Int, rows: Int, cellWidthPixels: Int, cellHeightPixels: Int) {
    try {
      val channel = connection.openShellChannel(termType, columns, rows, cellWidthPixels, cellHeightPixels)
      if (!command.isNullOrEmpty()) {
        // This is Ghostex-injected terminal input, not a command the user typed.
        // Keep the leading space so Atuin and shells configured with ignore-space
        // history rules do not persist attach/reconnect bootstrap commands.
        val shellCommand = " exec $command\n"
        channel.shell.outputStream.write(shellCommand.toByteArray(StandardCharsets.UTF_8))
        channel.shell.outputStream.flush()
      }
      session = channel.session
      shell = channel.shell
      onStarted()
    } catch (error: Exception) {
      onStartFailed(error)
      throw error
    }
  }

  override fun getInputStream(): InputStream {
    val activeShell = shell ?: throw IllegalStateException("Ghostex SSH attach has not started.")
    return activeShell.inputStream
  }

  override fun getOutputStream(): OutputStream {
    val activeShell = shell ?: throw IllegalStateException("Ghostex SSH attach has not started.")
    return activeShell.outputStream
  }

  override fun resize(columns: Int, rows: Int, cellWidthPixels: Int, cellHeightPixels: Int) {
    if (shell == null) return
    synchronized(resizeLock) {
      pendingResize = ResizeRequest(columns, rows, cellWidthPixels, cellHeightPixels)
      if (closed) return
      if (resizeWorkerRunning) return
      resizeWorkerRunning = true
    }
    resizeExecutor.execute(this::drainResizeRequests)
  }

  @Throws(Exception::class)
  override fun waitFor(): Int {
    val activeShell = shell ?: return 1
    activeShell.join()
    return 0
  }

  @Throws(Exception::class)
  override fun close() {
    synchronized(resizeLock) {
      closed = true
      pendingResize = null
    }
    resizeExecutor.shutdownNow()
    var firstError: Exception? = null
    try {
      shell?.close()
    } catch (error: Exception) {
      firstError = error
    }
    try {
      session?.close()
    } catch (error: Exception) {
      if (firstError == null) firstError = error
    }
    // The SSH client itself is shared across terminals and exec channels for this machine,
    // so it is NOT disconnected here; GhostexSshConnection owns its lifecycle.
    if (firstError != null) throw firstError
  }

  private fun drainResizeRequests() {
    while (true) {
      val request: ResizeRequest = synchronized(resizeLock) {
        val next = pendingResize
        pendingResize = null
        if (next == null || closed) {
          resizeWorkerRunning = false
          return
        }
        next
      }
      val activeShell = shell ?: continue
      try {
        activeShell.changeWindowDimensions(
          request.columns,
          request.rows,
          request.cellWidthPixels,
          request.cellHeightPixels
        )
      } catch (ignored: Exception) {
        // A dead channel will surface through the reader thread; resize failures are not fatal.
      }
    }
  }

  private class ResizeRequest(
    val columns: Int,
    val rows: Int,
    val cellWidthPixels: Int,
    val cellHeightPixels: Int
  )
}
