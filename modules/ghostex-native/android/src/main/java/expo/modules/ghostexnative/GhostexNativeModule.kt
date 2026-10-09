package expo.modules.ghostexnative

import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.media.AudioManager
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewTreeObserver
import android.view.WindowManager
import com.termux.terminal.TerminalEmulator
import dev.ghostex.tailcatbridge.Tailcatbridge
import com.termux.terminal.TerminalSession
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.NetworkInterface
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
  private val connectionLock = Any()
  private var networkObserver: GhostexNetworkObserver? = null

  internal val terminalRegistry = GhostexTerminalRegistry()

  /**
   * Module-global terminal settings. Read by views (tap policy), the session client
   * (cursor style for new emulators), and applied to every registry entry on change.
   */
  @Volatile
  internal var terminalSettings = TerminalRuntimeSettingsRecord()

  private val mainHandler = Handler(Looper.getMainLooper())

  /** Lazily created for bell beeps, released in OnDestroy. Guarded by [toneGeneratorLock]. */
  private var toneGenerator: ToneGenerator? = null
  private val toneGeneratorLock = Any()

  private var visibleWindowDecorView: View? = null
  private var visibleWindowLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
  private var lastVisibleWindowBottomPx: Int? = null

  /** For blocking work not tied to one connection (key generation, teardown). */
  private val backgroundExecutor: ExecutorService = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "GhostexNativeWork").apply { isDaemon = true }
  }

  internal val safeContext: Context?
    get() = appContext.reactContext

  private fun requireAndroidContext(): Context =
    appContext.reactContext ?: throw CodedException("React context is unavailable.")

  private fun hasTailscaleNetworkAddress(): Boolean {
    return try {
      val interfaces = NetworkInterface.getNetworkInterfaces() ?: return false
      while (interfaces.hasMoreElements()) {
        val networkInterface = interfaces.nextElement()
        if (!networkInterface.isUp) continue
        val addresses = networkInterface.inetAddresses
        while (addresses.hasMoreElements()) {
          val bytes = addresses.nextElement().address
          val tailscaleIpv4 =
            bytes.size == 4 &&
              bytes[0].toInt() and 0xff == 100 &&
              bytes[1].toInt() and 0xff in 64..127
          val tailscaleIpv6 =
            bytes.size == 16 &&
              bytes[0].toInt() and 0xff == 0xfd &&
              bytes[1].toInt() and 0xff == 0x7a &&
              bytes[2].toInt() and 0xff == 0x11 &&
              bytes[3].toInt() and 0xff == 0x5c &&
              bytes[4].toInt() and 0xff == 0xa1 &&
              bytes[5].toInt() and 0xff == 0xe0
          if (tailscaleIpv4 || tailscaleIpv6) return true
        }
      }
      false
    } catch (_: Exception) {
      false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("GhostexNative")

    // Android denies Go's netlink interface lookup, so the tailcat bridge has to be handed a
    // Java enumerator before it builds its first client (see GhostexTailcatInterfaces). This
    // runs while the native module registry is being assembled, ahead of any JavaScript call,
    // so every tailcat entry point below is guaranteed to find the lister already installed.
    OnCreate { GhostexTailcatInterfaces.register() }

    Events(
      "onTerminalState",
      "onTerminalTitle",
      "onTerminalBell",
      "onFontSizeChange",
      "onKeyModifiersConsumed",
      "onVisibleWindowFrameChange",
      "onTerminalGridChange",
      "onConnectionState",
      "onNetworkChanged"
    )

    OnStartObserving("onNetworkChanged") {
      networkObserver = GhostexNetworkObserver(requireAndroidContext()) {
        sendEvent("onNetworkChanged", emptyMap<String, Any>())
      }
    }
    OnStopObserving("onNetworkChanged") {
      networkObserver?.close()
      networkObserver = null
    }

    OnStartObserving("onVisibleWindowFrameChange") {
      mainHandler.post { startVisibleWindowFrameObserver() }
    }

    OnStopObserving("onVisibleWindowFrameChange") {
      mainHandler.post { stopVisibleWindowFrameObserver() }
    }

    // region connection lifecycle

    AsyncFunction("connect") { machineId: String, config: SshConfigRecord, promise: Promise ->
      connectAsync(machineId, config, promise)
    }

    AsyncFunction("disconnect") { machineId: String, promise: Promise ->
      val connection = synchronized(connectionLock) {
        connections.remove(machineId).also {
          if (it != null) {
            retireTerminals(it)
            emitConnectionState(machineId, "disconnected", null, null)
          }
        }
      }
      if (connection == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      connection.abortTransport()
      backgroundExecutor.execute { connection.closeQuietly() }
      promise.resolve(null)
    }

    AsyncFunction("isConnected") { machineId: String ->
      connections[machineId]?.isConnected() ?: false
    }

    // Saved machines keep their forward alive across disconnects so reconnects skip the
    // rendezvous; only throwaway callers (Test Connection) stop theirs explicitly.
    AsyncFunction("stopTailcatForward") { machineId: String, promise: Promise ->
      backgroundExecutor.execute {
        Tailcatbridge.stopForward(machineId)
        promise.resolve(null)
      }
    }

    // Easy Connect pairing reaches the computer's gxserver API port through the tunnel
    // before any SSH machine exists, so it needs the forward on its own. The rendezvous
    // blocks for seconds on a cold start; it runs on the background executor.
    AsyncFunction("startTailcatForward") { forwardId: String, address: String, remotePort: Int, promise: Promise ->
      backgroundExecutor.execute {
        try {
          val localPort = Tailcatbridge.startForward(forwardId, address, remotePort.toLong()).toInt()
          promise.resolve(mapOf("localPort" to localPort))
        } catch (error: Exception) {
          promise.reject(
            GhostexException(
              GhostexErrorCode.UNREACHABLE,
              "Could not reach the computer through Easy Connect. (${error.message ?: error.javaClass.simpleName})",
              error
            )
          )
        }
      }
    }

    AsyncFunction("exec") { machineId: String, command: String, timeoutMs: Int?, promise: Promise ->
      val connection = connections[machineId]
      if (connection == null) {
        promise.reject(notConnectedException(machineId))
        return@AsyncFunction
      }
      val timeout = timeoutMs?.toLong() ?: GhostexSshConnection.DEFAULT_EXEC_TIMEOUT_MS
      execAsync(connection, command, null, timeout, promise)
    }

    AsyncFunction("execWithInput") { machineId: String, command: String, input: String, timeoutMs: Int?, promise: Promise ->
      val connection = connections[machineId]
      if (connection == null) {
        promise.reject(notConnectedException(machineId))
        return@AsyncFunction
      }
      val timeout = timeoutMs?.toLong() ?: GhostexSshConnection.DEFAULT_EXEC_TIMEOUT_MS
      execAsync(connection, command, input, timeout, promise)
    }

    // endregion

    // region local port forwarding

    // SSH local port forwarding over the machine's existing connection: a loopback listener
    // here, one direct-tcpip channel per accepted connection. Nothing is configured on the PC.
    AsyncFunction("startPortForward") { machineId: String, remotePort: Int, remoteHost: String?, promise: Promise ->
      val connection = connections[machineId]
      if (connection == null) {
        promise.reject(notConnectedException(machineId))
        return@AsyncFunction
      }
      val host = remoteHost?.takeIf { it.isNotBlank() } ?: GhostexPortForward.DEFAULT_REMOTE_HOST
      connection.workExecutor.execute {
        try {
          promise.resolve(mapOf("localPort" to connection.startPortForward(remotePort, host)))
        } catch (error: Throwable) {
          promise.reject(mapPortForwardOpenError(error, remotePort))
        }
      }
    }

    // Teardown, so a machine with no connection resolves instead of failing the caller.
    AsyncFunction("stopPortForward") { machineId: String, remotePort: Int, promise: Promise ->
      val connection = connections[machineId]
      if (connection == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      backgroundExecutor.execute {
        connection.stopPortForward(remotePort)
        promise.resolve(null)
      }
    }

    AsyncFunction("listPortForwards") { machineId: String ->
      connections[machineId]?.listPortForwards().orEmpty().map { (remotePort, localPort) ->
        mapOf("remotePort" to remotePort, "localPort" to localPort)
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
      mainHandler.post { entry.attachedView?.detachFromEntry(entry) }
      emitTerminalState(sessionKey, "closed", null, null)
      promise.resolve(null)
      backgroundExecutor.execute {
        try {
          entry.session?.finishIfRunning()
        } catch (ignored: Exception) {
          // A dead channel is fine: the terminal is being discarded.
        }
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

    // Same raw byte write as sendText on this platform; the separate name exists because the
    // iOS sendText goes through Ghostty's paste path (bracketed-paste wrapping) and the zmx
    // display announcements must reach the attach client's stdin verbatim.
    AsyncFunction("sendRawInput") { sessionKey: String, text: String, promise: Promise ->
      val session = runningSession(sessionKey, promise) ?: return@AsyncFunction
      val bytes = text.toByteArray(Charsets.UTF_8)
      session.write(bytes, 0, bytes.size)
      promise.resolve(null)
    }

    AsyncFunction("sendKey") { sessionKey: String, key: String, mods: KeyModifiersRecord?, promise: Promise ->
      val session = runningSession(sessionKey, promise) ?: return@AsyncFunction
      terminalRegistry.get(sessionKey)?.attachedView?.consumeKeyModifiersForAccessoryKey()
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
        entry.attachedView?.setKeyModifiers(
          mods.ctrl,
          mods.alt,
          mods.shift,
          mods.ctrlLocked,
          mods.altLocked,
          mods.shiftLocked
        )
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

    AsyncFunction("getTerminalGrid") { sessionKey: String, promise: Promise ->
      val entry = terminalRegistry.get(sessionKey)
      if (entry == null) {
        promise.reject(noTerminalException(sessionKey))
        return@AsyncFunction
      }
      mainHandler.post {
        val emulator = entry.session?.emulator
        promise.resolve(
          if (emulator == null) null else mapOf("cols" to emulator.mColumns, "rows" to emulator.mRows)
        )
      }
    }

    // cols/rows > 0 pins the emulator and the SSH pty to that grid and blocks the attached
    // view's layout-driven resizes; 0 hands sizing back to the view (which then reports the
    // grid it settled on through onTerminalGridChange).
    AsyncFunction("setTerminalGrid") { sessionKey: String, cols: Int, rows: Int, promise: Promise ->
      val entry = terminalRegistry.get(sessionKey)
      if (entry == null) {
        promise.reject(noTerminalException(sessionKey))
        return@AsyncFunction
      }
      mainHandler.post {
        if (cols <= 0 || rows <= 0) {
          entry.explicitGrid = null
          entry.attachedView?.resumeViewDrivenSizing()
        } else {
          entry.explicitGrid = TerminalGrid(cols, rows)
          entry.attachedView?.suspendViewDrivenSizing()
          entry.session?.updateSize(cols, rows, entry.cellWidthPx, entry.cellHeightPx)
        }
        promise.resolve(null)
      }
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

    AsyncFunction("setTerminalSettings") { settings: TerminalRuntimeSettingsRecord, promise: Promise ->
      terminalSettings = settings
      mainHandler.post {
        for (sessionKey in terminalRegistry.keys()) {
          terminalRegistry.get(sessionKey)?.let { applyTerminalSettingsToEntry(it) }
        }
        promise.resolve(null)
      }
    }

    AsyncFunction("refreshTerminalViewport") { sessionKey: String, promise: Promise ->
      val entry = terminalRegistry.get(sessionKey)
      if (entry == null) {
        promise.reject(noTerminalException(sessionKey))
        return@AsyncFunction
      }
      // performZmxViewportRefreshNow no-ops for non-zmx entries; detached views resolve as no-op.
      mainHandler.post {
        entry.attachedView?.performZmxViewportRefreshNow()
        promise.resolve(null)
      }
    }

    AsyncFunction("setKeepScreenOn") { enabled: Boolean, promise: Promise ->
      val window = appContext.currentActivity?.window
      if (window == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      mainHandler.post {
        if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        promise.resolve(null)
      }
    }

    AsyncFunction("playAlertSound") { kind: String ->
      when (kind) {
        "bell" -> playBellBeep()
        "attention" -> playAttentionSound()
      }
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

    AsyncFunction("openTailscale") {
      val context = requireAndroidContext()
      val intent = context.packageManager.getLaunchIntentForPackage(TAILSCALE_ANDROID_PACKAGE)
        ?: return@AsyncFunction false
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }

    AsyncFunction("isTailscaleConnected") {
      hasTailscaleNetworkAddress()
    }

    AsyncFunction("quitApp") {
      val context = requireAndroidContext().applicationContext
      val activity = appContext.currentActivity
      context.stopService(Intent(context, GhostexForegroundService::class.java))
      mainHandler.post {
        activity?.finishAndRemoveTask()
        android.os.Process.killProcess(android.os.Process.myPid())
      }
    }

    // endregion

    // region persistent notification (Termux-fork foreground service port)

    AsyncFunction("setPersistentNotificationEnabled") { enabled: Boolean ->
      val context = requireAndroidContext().applicationContext
      if (enabled) GhostexForegroundService.start(context)
      else GhostexForegroundService.stop(context)
    }

    AsyncFunction("updatePersistentNotification") { rows: List<NotificationSessionRecord> ->
      GhostexForegroundService.sessionRows = rows.map {
        GhostexForegroundService.Companion.SessionRow(
          it.title,
          it.status,
          it.project,
          it.machineId,
          it.sessionId
        )
      }
      GhostexForegroundService.update()
    }

    AsyncFunction("requestNotificationPermission") {
      if (android.os.Build.VERSION.SDK_INT >= 33) {
        val activity = appContext.currentActivity
        val context = requireAndroidContext()
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
          context,
          android.Manifest.permission.POST_NOTIFICATIONS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted && activity != null) {
          androidx.core.app.ActivityCompat.requestPermissions(
            activity,
            arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
            NOTIFICATION_PERMISSION_REQUEST_CODE
          )
        }
      }
    }

    // endregion

    View(GhostexTerminalView::class) {
      Events("onSingleTap", "onOpenUrl")

      Prop("sessionKey") { view: GhostexTerminalView, sessionKey: String ->
        view.setSessionKey(sessionKey)
      }

      OnViewDestroys { view: GhostexTerminalView ->
        view.releaseSessionKey()
      }
    }

    OnDestroy {
      networkObserver?.close()
      networkObserver = null
      stopVisibleWindowFrameObserver()
      synchronized(toneGeneratorLock) {
        toneGenerator?.release()
        toneGenerator = null
      }
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
    val connection = GhostexSshConnection(requireAndroidContext(), machineId, config) { dead, message ->
      retireConnection(dead, "disconnected", GhostexException(GhostexErrorCode.NOT_CONNECTED, message))
    }
    val previous = synchronized(connectionLock) {
      connections.put(machineId, connection).also {
        if (it != null) retireTerminals(it)
        emitConnectionState(machineId, "connecting", null, null)
      }
    }
    previous?.abortTransport()
    if (previous != null) backgroundExecutor.execute { previous.closeQuietly() }
    GhostexSshTask.run(connection, 60_000L, success = {
      synchronized(connectionLock) {
        if (connections[machineId] === connection && connection.isConnected()) {
          emitConnectionState(machineId, "connected", null, null)
          promise.resolve(null)
        } else {
          promise.reject(notConnectedException(machineId))
        }
      }
    }, failure = { error ->
      val coded = mapSshError(error, GhostexErrorCode.UNREACHABLE)
      retireConnection(connection, "failed", coded)
      promise.reject(coded)
    }) { connection.connect() }
  }

  private fun retireConnection(connection: GhostexSshConnection, state: String, error: GhostexException) {
    synchronized(connectionLock) {
      if (connections.remove(connection.machineId, connection)) {
        retireTerminals(connection)
        emitConnectionState(connection.machineId, state, error.message, error.errorCode)
      }
    }
    connection.abortTransport()
    backgroundExecutor.execute { connection.closeQuietly() }
  }

  private fun retireTerminals(connection: GhostexSshConnection) {
    for (key in terminalRegistry.keys()) {
      val entry = terminalRegistry.get(key) ?: continue
      if (entry.connection !== connection || !terminalRegistry.remove(entry)) continue
      entry.lifecycleEnded = true
      emitTerminalState(key, "closed", null, null)
      mainHandler.post { entry.attachedView?.detachFromEntry(entry) }
      backgroundExecutor.execute { entry.session?.finishIfRunning() }
    }
  }

  private fun execAsync(connection: GhostexSshConnection, command: String, input: String?, timeout: Long, promise: Promise) {
    GhostexSshTask.run(connection, timeout, success = { outcome: GhostexSshConnection.ExecOutcome ->
      promise.resolve(mapOf("stdout" to outcome.stdout, "stderr" to outcome.stderr, "exitCode" to outcome.exitCode))
    }, failure = { error ->
      val coded = mapSshError(error, GhostexErrorCode.CHANNEL_FAILED)
      if (coded.errorCode == GhostexErrorCode.TIMEOUT || !connection.isConnected()) {
        retireConnection(connection, "disconnected", coded)
      }
      promise.reject(coded)
    }, commandChannel = true) { connection.exec(command, timeout, input) }
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
    val entry = GhostexTerminalEntry(sessionKey, machineId, fontSize, opts.zmxBacked, connection)
    emitTerminalState(sessionKey, "opening", null, null)
    /**
     * CDXC:SessionChat 2026-10-08 WHY:
     * A slow terminal open fails only this terminal. It used to retire the whole SSH connection, which took the session's chat (and every other terminal) down with it. The JS open path probes the connection after any failed open (`ensureConnected` verify in src/terminal/sessions.ts) and replaces it only when the probe fails, so a truly wedged transport is still recovered. The late channel, if one ever opens, is closed by GhostexSshAttachProcess.start.
     */
    val openDeadline = GhostexSshTask.deadline(20_000L) {
      if (entry.openSettled.compareAndSet(false, true)) {
        entry.lifecycleEnded = true
        terminalRegistry.remove(entry)
        val error = GhostexException(GhostexErrorCode.TIMEOUT, "Opening the terminal timed out.")
        backgroundExecutor.execute { entry.session?.finishIfRunning() }
        emitTerminalState(sessionKey, "failed", error.message, error.errorCode)
        promise.reject(error)
      }
    }

    val attachProcess = GhostexSshAttachProcess(
      connection = connection,
      command = opts.command,
      termType = opts.termType?.takeIf { it.isNotBlank() } ?: DEFAULT_TERM_TYPE,
      onStarted = {
        openDeadline.cancel(false)
        if (entry.openSettled.compareAndSet(false, true)) {
          if (!entry.lifecycleEnded && terminalRegistry.get(sessionKey) === entry) {
            emitTerminalState(sessionKey, "open", null, null)
            promise.resolve(null)
          } else {
            promise.reject(noTerminalException(sessionKey))
          }
        }
      },
      onStartFailed = { error ->
        openDeadline.cancel(false)
        val removed = terminalRegistry.remove(entry)
        entry.lifecycleEnded = true
        if (entry.openSettled.compareAndSet(false, true)) {
          val coded = mapSshError(error, GhostexErrorCode.CHANNEL_FAILED)
          if (removed) emitTerminalState(sessionKey, "failed", coded.message, coded.errorCode)
          promise.reject(coded)
        }
      }
    )

    // TerminalSession's handler must bind to the main looper; the terminal starts with a
    // placeholder 80x24 geometry so warm sessions run before any view attaches, and the
    // first attached view resizes the PTY to real metrics.
    mainHandler.post {
      if (entry.lifecycleEnded) return@post
      if (connections[machineId] !== connection || !connection.isConnected()) {
        openDeadline.cancel(false)
        entry.lifecycleEnded = true
        if (entry.openSettled.compareAndSet(false, true)) {
          emitTerminalState(sessionKey, "failed", "The SSH connection was replaced.", GhostexErrorCode.NOT_CONNECTED)
          promise.reject(notConnectedException(machineId))
        }
        return@post
      }
      val client = GhostexTerminalSessionClient(entry, this)
      val session = TerminalSession(attachProcess, resolveTranscriptRows(opts.scrollbackRows), client)
      entry.session = session
      terminalRegistry.register(entry)
      // updateSize creates the emulator synchronously (cursor style comes from the session
      // client at construction); auto-scroll must be applied to the fresh emulator here so
      // warm sessions honor the current settings before any view attaches.
      session.updateSize(INITIAL_COLUMNS, INITIAL_ROWS, INITIAL_CELL_WIDTH_PX, INITIAL_CELL_HEIGHT_PX)
      applyTerminalSettingsToEntry(entry)
    }
  }

  /** Accept the settings slider's 500-row steps; stale/foreign values use the default. */
  private fun resolveTranscriptRows(requested: Int?): Int =
    if (
      requested != null &&
      requested in MIN_TRANSCRIPT_ROWS..MAX_TRANSCRIPT_ROWS &&
      requested % TRANSCRIPT_ROWS_STEP == 0
    ) requested
    else DEFAULT_TRANSCRIPT_ROWS

  /** Main thread only: push the current [terminalSettings] onto one registry entry. */
  private fun applyTerminalSettingsToEntry(entry: GhostexTerminalEntry) {
    val settings = terminalSettings
    val emulator = entry.session?.emulator ?: return
    emulator.setAutoScrollDisabled(!settings.autoScroll)
    // Re-reads the style this module now reports through the session client.
    emulator.setCursorStyle()
    entry.attachedView?.applyTerminalSettings(settings)
  }

  /** Termux cursor-style code for the current settings; read by the session client. */
  internal fun terminalCursorStyleCode(): Int = when (terminalSettings.cursorStyle) {
    "underline" -> TerminalEmulator.TERMINAL_CURSOR_STYLE_UNDERLINE
    "bar" -> TerminalEmulator.TERMINAL_CURSOR_STYLE_BAR
    else -> TerminalEmulator.TERMINAL_CURSOR_STYLE_BLOCK
  }

  // region alert sounds

  private fun playBellBeep() {
    try {
      val generator = synchronized(toneGeneratorLock) {
        toneGenerator
          ?: ToneGenerator(AudioManager.STREAM_NOTIFICATION, BELL_TONE_VOLUME).also { toneGenerator = it }
      }
      generator.startTone(ToneGenerator.TONE_PROP_BEEP, BELL_TONE_DURATION_MS)
    } catch (ignored: Exception) {
      // ToneGenerator construction throws when no audio resources are available;
      // alert sounds must never take the terminal down.
    }
  }

  private fun playAttentionSound() {
    try {
      val context = safeContext ?: return
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION) ?: return
      RingtoneManager.getRingtone(context, uri)?.play()
    } catch (ignored: Exception) {
      // A missing/unresolvable system notification sound is not actionable here.
    }
  }

  // endregion

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
    val removed = terminalRegistry.remove(entry)
    if (removed && !entry.lifecycleEnded) {
      entry.lifecycleEnded = true
      emitTerminalState(entry.sessionKey, "closed", null, null)
    }
  }

  // endregion

  // region event emission

  /**
   * Termux positions its extra-keys row against getWindowVisibleDisplayFrame instead of trusting
   * adjustResize alone. Candidate, clipboard, and extended keyboard rows can cover content without
   * being reflected in Android's resized app viewport, while the visible frame still reports the
   * real unobscured boundary.
   */
  private fun startVisibleWindowFrameObserver() {
    stopVisibleWindowFrameObserver()
    val decorView = appContext.currentActivity?.window?.decorView ?: return
    val listener = ViewTreeObserver.OnGlobalLayoutListener {
      val visibleFrame = Rect()
      decorView.getWindowVisibleDisplayFrame(visibleFrame)
      if (lastVisibleWindowBottomPx == visibleFrame.bottom) return@OnGlobalLayoutListener
      lastVisibleWindowBottomPx = visibleFrame.bottom

      val windowLocation = IntArray(2)
      decorView.getLocationOnScreen(windowLocation)
      val density = decorView.resources.displayMetrics.density
      val bottomInWindowDp = (visibleFrame.bottom - windowLocation[1]) / density
      sendEvent("onVisibleWindowFrameChange", mapOf("bottom" to bottomInWindowDp))
    }

    visibleWindowDecorView = decorView
    visibleWindowLayoutListener = listener
    decorView.viewTreeObserver.addOnGlobalLayoutListener(listener)
    listener.onGlobalLayout()
  }

  private fun stopVisibleWindowFrameObserver() {
    val decorView = visibleWindowDecorView
    val listener = visibleWindowLayoutListener
    if (decorView != null && listener != null && decorView.viewTreeObserver.isAlive) {
      decorView.viewTreeObserver.removeOnGlobalLayoutListener(listener)
    }
    visibleWindowDecorView = null
    visibleWindowLayoutListener = null
    lastVisibleWindowBottomPx = null
  }

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

  internal fun emitTerminalGridChange(sessionKey: String, cols: Int, rows: Int) {
    sendEvent("onTerminalGridChange", mapOf("sessionKey" to sessionKey, "cols" to cols, "rows" to rows))
  }

  // endregion

  companion object {
    private const val TAILSCALE_ANDROID_PACKAGE = "com.tailscale.ipn"
    /** Shared default terminal font size baseline (dp). */
    const val DEFAULT_FONT_SIZE_DP = 13
    const val MIN_FONT_SIZE_DP = 4
    const val MAX_FONT_SIZE_DP = 32

    private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 7031
    private const val DEFAULT_TERM_TYPE = "xterm-256color"
    private const val MIN_TRANSCRIPT_ROWS = 500
    private const val MAX_TRANSCRIPT_ROWS = 20_000
    private const val TRANSCRIPT_ROWS_STEP = 500
    /** Unified cross-platform scrollback default (matches iOS and the JS settings screen). */
    private const val DEFAULT_TRANSCRIPT_ROWS = 2_000

    private const val BELL_TONE_VOLUME = 80
    private const val BELL_TONE_DURATION_MS = 150
    private const val INITIAL_COLUMNS = 80
    private const val INITIAL_ROWS = 24
    private const val INITIAL_CELL_WIDTH_PX = 12
    private const val INITIAL_CELL_HEIGHT_PX = 24
  }
}
