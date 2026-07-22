package expo.modules.ghostexnative

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.termux.terminal.TerminalSession
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Android implementation of the ghostex-native contract (docs/ARCHITECTURE.md):
 * SSHJ connection registry per machineId, Termux-terminal registry per sessionKey, and the
 * GhostexTerminalView host. PTY bytes never cross the JS bridge — SSH shell channels are
 * piped into Termux TerminalSessions entirely natively; JS only orchestrates.
 */
class GhostexNativeModule : Module() {

  private val connections = ConcurrentHashMap<String, GhostexSshConnection>()

  internal val terminalRegistry = GhostexTerminalRegistry()

  private val mainHandler = Handler(Looper.getMainLooper())

  /** For blocking work not tied to one connection (key generation, teardown). */
  private val backgroundExecutor: ExecutorService = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "GhostexNativeWork").apply { isDaemon = true }
  }

  internal val safeContext: Context?
    get() = appContext.reactContext

  private fun requireAndroidContext(): Context =
    appContext.reactContext ?: throw CodedException("React context is unavailable.")

  override fun definition() = ModuleDefinition {
    Name("GhostexNative")

    Events(
      "onTerminalState",
      "onTerminalTitle",
      "onTerminalBell",
      "onFontSizeChange",
      "onKeyModifiersConsumed",
      "onConnectionState"
    )

    // region connection lifecycle

    AsyncFunction("connect") { machineId: String, config: SshConfigRecord, promise: Promise ->
      connectAsync(machineId, config, promise)
    }

    AsyncFunction("disconnect") { machineId: String, promise: Promise ->
      val connection = connections.remove(machineId)
      if (connection == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      backgroundExecutor.execute {
        connection.closeQuietly()
        emitConnectionState(machineId, "disconnected", null, null)
        promise.resolve(null)
      }
    }

    AsyncFunction("isConnected") { machineId: String ->
      connections[machineId]?.isConnected() ?: false
    }

    AsyncFunction("exec") { machineId: String, command: String, timeoutMs: Int?, promise: Promise ->
      val connection = connections[machineId]
      if (connection == null) {
        promise.reject(notConnectedException(machineId))
        return@AsyncFunction
      }
      val timeout = timeoutMs?.toLong() ?: GhostexSshConnection.DEFAULT_EXEC_TIMEOUT_MS
      connection.workExecutor.execute {
        try {
          val outcome = connection.exec(command, timeout)
          promise.resolve(
            mapOf(
              "stdout" to outcome.stdout,
              "stderr" to outcome.stderr,
              "exitCode" to outcome.exitCode
            )
          )
        } catch (error: Throwable) {
          promise.reject(mapSshError(error, GhostexErrorCode.CHANNEL_FAILED))
        }
      }
    }

    // endregion

    // region terminal registry

    AsyncFunction("openTerminal") { sessionKey: String, machineId: String, opts: OpenTerminalOptionsRecord, promise: Promise ->
      openTerminalAsync(sessionKey, machineId, opts, promise)
    }

    AsyncFunction("closeTerminal") { sessionKey: String, promise: Promise ->
      val entry = terminalRegistry.remove(sessionKey)
      if (entry == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      entry.lifecycleEnded = true
      mainHandler.post { entry.attachedView?.detachFromEntry() }
      backgroundExecutor.execute {
        try {
          entry.session?.finishIfRunning()
        } catch (ignored: Exception) {
          // A dead channel is fine: the terminal is being discarded.
        }
        emitTerminalState(sessionKey, "closed", null, null)
        promise.resolve(null)
      }
    }

    AsyncFunction("listTerminals") {
      terminalRegistry.keys()
    }

    AsyncFunction("sendText") { sessionKey: String, text: String, promise: Promise ->
      val session = runningSession(sessionKey, promise) ?: return@AsyncFunction
      val bytes = text.toByteArray(Charsets.UTF_8)
      session.write(bytes, 0, bytes.size)
      promise.resolve(null)
    }

    AsyncFunction("sendKey") { sessionKey: String, key: String, mods: KeyModifiersRecord?, promise: Promise ->
      val session = runningSession(sessionKey, promise) ?: return@AsyncFunction
      terminalRegistry.get(sessionKey)?.attachedView?.clearKeyModifiers()
      val handled = GhostexKeyMapper.writeKey(
        session,
        key,
        ctrl = mods?.ctrl ?: false,
        alt = mods?.alt ?: false,
        shift = mods?.shift ?: false
      )
      if (!handled) {
        promise.reject(GhostexException(GhostexErrorCode.CHANNEL_FAILED, "Unsupported key: \"$key\"."))
        return@AsyncFunction
      }
      promise.resolve(null)
    }

    AsyncFunction("setKeyModifiers") { sessionKey: String, mods: KeyModifiersRecord, promise: Promise ->
      val entry = terminalRegistry.get(sessionKey)
      if (entry == null) {
        promise.reject(noTerminalException(sessionKey))
        return@AsyncFunction
      }
      mainHandler.post {
        entry.attachedView?.setKeyModifiers(mods.ctrl, mods.alt, mods.shift)
      }
      promise.resolve(null)
    }

    AsyncFunction("setFontSize") { sessionKey: String, size: Double, promise: Promise ->
      val entry = terminalRegistry.get(sessionKey)
      if (entry == null) {
        promise.reject(noTerminalException(sessionKey))
        return@AsyncFunction
      }
      val clamped = size.roundToInt().coerceIn(MIN_FONT_SIZE_DP, MAX_FONT_SIZE_DP)
      entry.fontSizeDp = clamped
      mainHandler.post { entry.attachedView?.applyFontSize(clamped) }
      promise.resolve(null)
    }

    AsyncFunction("scrollToBottom") { sessionKey: String, promise: Promise ->
      val entry = terminalRegistry.get(sessionKey)
      if (entry == null) {
        promise.reject(noTerminalException(sessionKey))
        return@AsyncFunction
      }
      mainHandler.post { entry.attachedView?.scrollTerminalToBottom() }
      promise.resolve(null)
    }

    AsyncFunction("focusTerminal") { sessionKey: String, promise: Promise ->
      val entry = terminalRegistry.get(sessionKey)
      if (entry == null) {
        promise.reject(noTerminalException(sessionKey))
        return@AsyncFunction
      }
      // No-op when no view is attached (warm background session).
      mainHandler.post { entry.attachedView?.focusTerminal() }
      promise.resolve(null)
    }

    AsyncFunction("blurTerminal") { sessionKey: String, promise: Promise ->
      val entry = terminalRegistry.get(sessionKey)
      if (entry == null) {
        promise.reject(noTerminalException(sessionKey))
        return@AsyncFunction
      }
      mainHandler.post { entry.attachedView?.blurTerminal() }
      promise.resolve(null)
    }

    // endregion

    // region files + keys

    AsyncFunction("uploadFile") { machineId: String, localPath: String, remotePath: String, promise: Promise ->
      val connection = connections[machineId]
      if (connection == null) {
        promise.reject(notConnectedException(machineId))
        return@AsyncFunction
      }
      connection.workExecutor.execute {
        try {
          connection.upload(localPath, remotePath)
          promise.resolve(null)
        } catch (error: Throwable) {
          promise.reject(mapSshError(error, GhostexErrorCode.SFTP_FAILED))
        }
      }
    }

    AsyncFunction("generateSshKey") { type: String, comment: String, passphrase: String?, promise: Promise ->
      backgroundExecutor.execute {
        try {
          GhostexSshConnection.ensureBundledBouncyCastleProvider()
          val generated = GhostexSshKeyGenerator.generate(type, comment, passphrase)
          promise.resolve(
            mapOf(
              "privateKey" to generated.privateKey,
              "publicKey" to generated.publicKey,
              "fingerprint" to generated.fingerprint
            )
          )
        } catch (error: Throwable) {
          promise.reject(CodedException("E_KEYGEN_FAILED", error.message ?: "SSH key generation failed.", error))
        }
      }
    }

    AsyncFunction("resetHostKey") { host: String, port: Int ->
      GhostexHostKeyStore(requireAndroidContext()).reset(host, port)
    }

    // endregion

    View(GhostexTerminalView::class) {
      Events("onSingleTap")

      Prop("sessionKey") { view: GhostexTerminalView, sessionKey: String ->
        view.setSessionKey(sessionKey)
      }

      OnViewDestroys { view: GhostexTerminalView ->
        view.detachFromEntry()
      }
    }

    OnDestroy {
      val toClose = connections.values.toList()
      connections.clear()
      Thread({
        for (connection in toClose) connection.closeQuietly()
      }, "GhostexNativeShutdown").apply {
        isDaemon = true
        start()
      }
    }
  }

  // region connection helpers

  private fun connectAsync(machineId: String, config: SshConfigRecord, promise: Promise) {
    val previous = connections.remove(machineId)
    val connection = GhostexSshConnection(requireAndroidContext(), machineId, config)
    connections[machineId] = connection
    emitConnectionState(machineId, "connecting", null, null)
    connection.workExecutor.execute {
      previous?.closeQuietly()
      try {
        connection.connect()
        emitConnectionState(machineId, "connected", null, null)
        promise.resolve(null)
      } catch (error: Throwable) {
        connections.remove(machineId, connection)
        val coded = mapSshError(error, GhostexErrorCode.UNREACHABLE)
        emitConnectionState(machineId, "failed", coded.message, coded.errorCode)
        promise.reject(coded)
      }
    }
  }

  // endregion

  // region terminal helpers

  private fun openTerminalAsync(
    sessionKey: String,
    machineId: String,
    opts: OpenTerminalOptionsRecord,
    promise: Promise
  ) {
    val connection = connections[machineId]
    if (connection == null) {
      promise.reject(notConnectedException(machineId))
      return
    }
    if (terminalRegistry.get(sessionKey) != null) {
      // Warm entry already exists; reattaching a view is enough.
      promise.resolve(null)
      return
    }

    val fontSize = opts.fontSize?.roundToInt()?.coerceIn(MIN_FONT_SIZE_DP, MAX_FONT_SIZE_DP)
      ?: DEFAULT_FONT_SIZE_DP
    val entry = GhostexTerminalEntry(sessionKey, machineId, fontSize)
    emitTerminalState(sessionKey, "opening", null, null)

    val attachProcess = GhostexSshAttachProcess(
      connection = connection,
      command = opts.command,
      termType = opts.termType?.takeIf { it.isNotBlank() } ?: DEFAULT_TERM_TYPE,
      onStarted = {
        if (entry.openSettled.compareAndSet(false, true)) {
          emitTerminalState(sessionKey, "open", null, null)
          promise.resolve(null)
        }
      },
      onStartFailed = { error ->
        terminalRegistry.remove(sessionKey)
        entry.lifecycleEnded = true
        if (entry.openSettled.compareAndSet(false, true)) {
          val coded = mapSshError(error, GhostexErrorCode.CHANNEL_FAILED)
          emitTerminalState(sessionKey, "failed", coded.message, coded.errorCode)
          promise.reject(coded)
        }
      }
    )

    // TerminalSession's handler must bind to the main looper; the terminal starts with a
    // placeholder 80x24 geometry so warm sessions run before any view attaches, and the
    // first attached view resizes the PTY to real metrics.
    mainHandler.post {
      val client = GhostexTerminalSessionClient(entry, this)
      val session = TerminalSession(attachProcess, TRANSCRIPT_ROWS, client)
      entry.session = session
      terminalRegistry.register(entry)
      session.updateSize(INITIAL_COLUMNS, INITIAL_ROWS, INITIAL_CELL_WIDTH_PX, INITIAL_CELL_HEIGHT_PX)
    }
  }

  private fun runningSession(sessionKey: String, promise: Promise): TerminalSession? {
    val entry = terminalRegistry.get(sessionKey)
    val session = entry?.session
    if (session == null) {
      promise.reject(noTerminalException(sessionKey))
      return null
    }
    return session
  }

  private fun noTerminalException(sessionKey: String): GhostexException =
    GhostexException(GhostexErrorCode.NOT_CONNECTED, "No terminal for session \"$sessionKey\".")

  /** Called by the session client (main thread) when the remote shell/channel ends. */
  internal fun onTerminalFinished(entry: GhostexTerminalEntry) {
    terminalRegistry.remove(entry.sessionKey)
    if (!entry.lifecycleEnded) {
      entry.lifecycleEnded = true
      emitTerminalState(entry.sessionKey, "closed", null, null)
    }
  }

  // endregion

  // region event emission

  internal fun emitTerminalState(sessionKey: String, state: String, error: String?, errorCode: String?) {
    val body = mutableMapOf<String, Any?>("sessionKey" to sessionKey, "state" to state)
    if (error != null) body["error"] = error
    if (errorCode != null) body["errorCode"] = errorCode
    sendEvent("onTerminalState", body)
  }

  internal fun emitConnectionState(machineId: String, state: String, error: String?, errorCode: String?) {
    val body = mutableMapOf<String, Any?>("machineId" to machineId, "state" to state)
    if (error != null) body["error"] = error
    if (errorCode != null) body["errorCode"] = errorCode
    sendEvent("onConnectionState", body)
  }

  internal fun emitTerminalTitle(sessionKey: String, title: String) {
    sendEvent("onTerminalTitle", mapOf("sessionKey" to sessionKey, "title" to title))
  }

  internal fun emitTerminalBell(sessionKey: String) {
    sendEvent("onTerminalBell", mapOf("sessionKey" to sessionKey))
  }

  internal fun emitFontSizeChange(sessionKey: String, fontSizeDp: Int) {
    sendEvent("onFontSizeChange", mapOf("sessionKey" to sessionKey, "fontSize" to fontSizeDp))
  }

  internal fun emitKeyModifiersConsumed(sessionKey: String) {
    sendEvent("onKeyModifiersConsumed", mapOf("sessionKey" to sessionKey))
  }

  // endregion

  companion object {
    /** Termux's default terminal font size baseline (dp). */
    const val DEFAULT_FONT_SIZE_DP = 12
    const val MIN_FONT_SIZE_DP = 4
    const val MAX_FONT_SIZE_DP = 32

    private const val DEFAULT_TERM_TYPE = "xterm-256color"
    private const val TRANSCRIPT_ROWS = 2_000
    private const val INITIAL_COLUMNS = 80
    private const val INITIAL_ROWS = 24
    private const val INITIAL_CELL_WIDTH_PX = 12
    private const val INITIAL_CELL_HEIGHT_PX = 24
  }
}
