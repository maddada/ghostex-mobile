package expo.modules.ghostexnative

import android.content.Context
import android.net.Uri
import android.util.Log
import dev.ghostex.tailcatbridge.Tailcatbridge
import java.io.File
import java.io.InputStream
import java.security.KeyFactory
import java.security.Provider
import java.security.Security
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import net.schmizz.keepalive.KeepAliveProvider
import net.schmizz.sshj.AndroidConfig
import net.schmizz.sshj.Config
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Factory
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.connection.channel.direct.PTYMode
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.DisconnectListener
import net.schmizz.sshj.transport.kex.KeyExchange
import net.schmizz.sshj.userauth.UserAuthException
import net.schmizz.sshj.userauth.method.AuthNone
import net.schmizz.sshj.userauth.password.PasswordUtils
import net.schmizz.sshj.xfer.FileSystemFile
import org.bouncycastle.jce.provider.BouncyCastleProvider

/**
 * One long-lived, multiplexed SSHJ client per machineId. Ported from the Android fork's
 * GhostexSshTransport, restructured from per-command clients to a persistent client whose
 * channels back exec(), SFTP uploads, and interactive PTY shells.
 */
class GhostexSshConnection(
  context: Context,
  val machineId: String,
  private val config: SshConfigRecord,
  private val onTransportDeath: (GhostexSshConnection, String) -> Unit
) {

  class ExecOutcome(val stdout: String, val stderr: String, val exitCode: Int)

  class ShellChannel(val session: Session, val shell: Session.Shell)

  private val hostKeys = GhostexHostKeyStore(context)

  /** All blocking SSH work for this connection runs here, never on the main thread. */
  val workExecutor: ExecutorService = Executors.newCachedThreadPool { runnable ->
    Thread(runnable, "GhostexSsh-$machineId").apply { isDaemon = true }
  }

  @Volatile
  private var client: SSHClient? = null

  private val lifecycleLock = Any()
  private val cleanupStarted = AtomicBoolean(false)
  @Volatile private var closed = false

  /** Darwin's SSH server is more reliable with a streamed exec upload than SFTP. */
  @Volatile
  private var execUploadPreferred: Boolean? = null

  /**
   * CDXC:RemoteMachines 2026-10-06 WHY:
   * Everything the phone does on a machine shares this one SSH connection, and OpenSSH (macOS and Windows alike) refuses a session channel past `MaxSessions`, 10 by default, with the bare reason "open failed". Up to seven warm terminals each hold a channel for as long as they live, so commands and uploads opened on top of them without a limit lost the race whenever a few ran at once: a chat attachment failed with "open failed" while the chat's own polls were running. Commands and uploads therefore take one of the remaining slots and wait for a free one instead of being refused.
   * SEE-ALSO: MAX_WARM_SESSIONS in src/terminal/sessions.ts (the terminals' share of the budget).
   */
  private val commandChannelSlots = Semaphore(COMMAND_CHANNEL_SLOTS, true)

  /** Live local port forwards keyed by remote port; owned by this connection. */
  private val portForwards = ConcurrentHashMap<Int, GhostexPortForward>()

  /** Serializes start so two concurrent starts for one port cannot both bind a listener. */
  private val portForwardLock = Any()

  fun isConnected(): Boolean {
    val ssh = client ?: return false
    return !closed && ssh.isConnected && ssh.isAuthenticated
  }

  /** Blocking connect + auth with the fork's 8s connect timeout. Throws [GhostexException]. */
  fun connect() {
    ensureBundledBouncyCastleProvider()
    val ssh = SSHClient(createSshConfig())
    ssh.connectTimeout = CONNECT_TIMEOUT_MS
    // Bound the SSH greeting as well as TCP connect. Idle reads become unlimited after auth.
    ssh.timeout = CONNECT_TIMEOUT_MS
    /**
     * CDXC:RemoteMachines 2026-09-14 WHY:
     * SSHJ starts its keep-alive thread inside connect only when the interval is already nonzero.
     * Setting it after authentication left half-open mobile connections alive until force quit.
     */
    ssh.connection.keepAlive.keepAliveInterval =
      if (config.keepAliveEnabled) config.keepAliveIntervalSec.coerceIn(MIN_KEEP_ALIVE_INTERVAL_SECONDS, MAX_KEEP_ALIVE_INTERVAL_SECONDS)
      else 0
    synchronized(lifecycleLock) {
      if (closed) throw notConnectedException(machineId)
      client = ssh
    }
    // Host-key identity is always config.host:config.port, never the dial target, so a
    // tailcat machine keeps one pinned fingerprint across every loopback port it gets.
    val verifier = GhostexPersistedHostKeyVerifier(config.host, config.port, hostKeys)
    ssh.addHostKeyVerifier(verifier)
    try {
      val (dialHost, dialPort) = resolveDialTarget()
      if (closed) throw notConnectedException(machineId)
      val connectStartedAt = System.currentTimeMillis()
      Log.i(LOG_TAG, "connect $machineId -> $dialHost:$dialPort")
      ssh.connect(dialHost, dialPort)
      Log.i(
        LOG_TAG,
        "transport up for $machineId in ${System.currentTimeMillis() - connectStartedAt}ms"
      )
      authenticate(ssh)
      ssh.socket.soTimeout = 0
      installPortForwardTeardownOnTransportDeath(ssh)
      if (!isConnected()) throw notConnectedException(machineId)
    } catch (error: Exception) {
      try {
        ssh.socket?.close()
        ssh.close()
      } catch (ignored: Exception) {
        // The original connect/auth error is the actionable failure.
      }
      if (verifier.sawMismatch) {
        throw GhostexException(
          GhostexErrorCode.HOST_KEY_MISMATCH,
          "Host key for ${config.host}:${config.port} changed since it was first trusted.",
          error
        )
      }
      // A tunnel dial that fails after the loopback socket is already up can only reach
      // SSHJ as a reset; the bridge kept the cause, so report that instead. A
      // GhostexException already carries a precise message (e.g. from startForward).
      val tunnelFailure = if (error is GhostexException) null else tailcatDialFailure()
      if (tunnelFailure != null) {
        Log.w(LOG_TAG, "connect $machineId failed inside the tailcat tunnel: $tunnelFailure")
        throw GhostexException(
          GhostexErrorCode.UNREACHABLE,
          "tailcat could not reach the paired machine: $tunnelFailure",
          error
        )
      }
      Log.w(LOG_TAG, "connect $machineId failed: ${error.message ?: error.javaClass.simpleName}")
      throw mapSshError(error, fallbackCode = GhostexErrorCode.UNREACHABLE)
    }
  }

  /**
   * Where the TCP connection actually goes. Plain SSH dials the configured host; a tailcat
   * machine dials the loopback port of the forward the bridge keeps for this machineId,
   * which the bridge probes on reuse and rebuilds when it no longer answers. The first
   * call per machine, and a rebuild, perform the peer rendezvous and can block for
   * seconds; it runs on [workExecutor], never the main thread.
   */
  private fun resolveDialTarget(): Pair<String, Int> {
    val token = config.tailcatToken.trim()
    if (token.isEmpty()) return config.host to config.port
    val startedAt = System.currentTimeMillis()
    Log.i(LOG_TAG, "startForward $machineId remotePort=${config.port} tokenLength=${token.length}")
    val localPort = try {
      Tailcatbridge.startForward(machineId, token, config.port.toLong()).toInt()
    } catch (error: Exception) {
      Log.w(
        LOG_TAG,
        "startForward $machineId failed after ${System.currentTimeMillis() - startedAt}ms: " +
          (error.message ?: error.javaClass.simpleName)
      )
      // The machine id is an internal identifier: it stays in the log lines above, never in
      // text the app shows, where the user already knows which machine they are connecting to.
      throw GhostexException(
        GhostexErrorCode.UNREACHABLE,
        "tailcat could not reach the paired machine. Check that the remote's tailcat sidecar " +
          "is enabled and that its token is current. (${error.message ?: error.javaClass.simpleName})",
        error
      )
    }
    Log.i(
      LOG_TAG,
      "startForward $machineId ready on 127.0.0.1:$localPort in " +
        "${System.currentTimeMillis() - startedAt}ms"
    )
    return TAILCAT_LOOPBACK_HOST to localPort
  }

  /** The tunnel's own last dial failure for this machine, or null when there is none. */
  private fun tailcatDialFailure(): String? {
    if (config.tailcatToken.trim().isEmpty()) return null
    return Tailcatbridge.lastError(machineId)?.takeIf { it.isNotBlank() }
  }

  private fun authenticate(ssh: SSHClient) {
    if (config.authMethod == "none") {
      // Tailscale SSH: the tailnet policy authenticates, so only the "none" method is offered.
      ssh.auth(config.username, AuthNone())
      return
    }
    val privateKey = config.privateKey?.takeIf { it.isNotBlank() }
    val password = config.password?.takeIf { it.isNotEmpty() }
    if (privateKey == null && password == null) {
      throw GhostexException(
        GhostexErrorCode.AUTH_FAILED,
        "No password or private key provided for ${config.username}@${config.host}."
      )
    }
    if (privateKey != null) {
      val passphraseFinder = config.passphrase
        ?.takeIf { it.isNotEmpty() }
        ?.let { PasswordUtils.createOneOff(it.toCharArray()) }
      val keyProvider = ssh.loadKeys(privateKey, null, passphraseFinder)
      try {
        ssh.authPublickey(config.username, keyProvider)
        return
      } catch (error: UserAuthException) {
        if (password == null) throw error
      }
    }
    if (password != null) {
      ssh.authPassword(config.username, password)
    }
  }

  /** Disconnect and stop the executor. Safe to call multiple times, never throws. */
  fun closeQuietly() {
    if (!cleanupStarted.compareAndSet(false, true)) return
    val ssh = abortTransport()
    /*
     * The transport goes first. Closing a direct-tcpip channel on a live session
     * makes sshj wait up to 30s for the remote's close confirmation, once per
     * channel, which is long enough to stall the reconnect that follows a
     * disconnect; with the transport already gone those closes return at once.
     * It also releases a startPortForward that is holding the port-forward lock
     * while it waits on a probe, so the teardown below cannot block behind it.
     */
    try {
      ssh?.disconnect()
    } catch (ignored: Exception) {
      // Closing a dead SSH connection can throw; there is nothing actionable here.
    }
    // Forwards dial through this client, so they die with it: listPortForwards must never
    // report a forward whose channels can no longer be opened.
    closeAllPortForwards()
    workExecutor.shutdown()
  }

  /** Close TCP without waiting for SSH channel acknowledgements or the forwarding lock. */
  fun abortTransport(): SSHClient? {
    val ssh = synchronized(lifecycleLock) {
      closed = true
      client
    }
    try {
      ssh?.socket?.close()
    } catch (_: Exception) {
      // Already closed by a competing deadline or the peer.
    }
    return ssh
  }

  /**
   * Run [work], which opens one short-lived session channel, inside a command slot. It waits up to
   * [waitMs] for a free slot; a wait that runs out fails this call only, never the connection.
   */
  fun <T> withCommandChannel(waitMs: Long, work: () -> T): T {
    if (!commandChannelSlots.tryAcquire(waitMs.coerceAtLeast(1), TimeUnit.MILLISECONDS)) {
      throw GhostexException(
        GhostexErrorCode.CHANNEL_FAILED,
        "The computer is still busy with other commands. Try again in a moment."
      )
    }
    try {
      return work()
    } finally {
      commandChannelSlots.release()
    }
  }

  /**
   * Run [command] in its own non-interactive session channel, collecting stdout/stderr off
   * the channel while waiting so large outputs cannot stall the remote window.
   */
  fun exec(command: String, timeoutMs: Long, input: String? = null): ExecOutcome {
    val ssh = client ?: throw notConnectedException(machineId)
    try {
      ssh.startSession().use { session ->
        val cmd = session.exec(command)
        val stdout = StreamCollector(cmd.inputStream)
        val stderr = StreamCollector(cmd.errorStream)
        if (input != null) {
          cmd.outputStream.use { it.write(input.toByteArray(Charsets.UTF_8)) }
        }
        // A join timeout carries java.util.concurrent.TimeoutException in its cause chain,
        // which mapSshError turns into E_TIMEOUT; other join failures stay channel errors.
        cmd.join(timeoutMs, TimeUnit.MILLISECONDS)
        stdout.await(STREAM_DRAIN_TIMEOUT_MS)
        stderr.await(STREAM_DRAIN_TIMEOUT_MS)
        val exitStatus = cmd.exitStatus
          ?: throw GhostexException(
            GhostexErrorCode.TIMEOUT,
            "Command did not finish within ${timeoutMs}ms on $machineId."
          )
        return ExecOutcome(stdout.text(), stderr.text(), exitStatus)
      }
    } catch (error: Exception) {
      throw mapSshError(error, fallbackCode = GhostexErrorCode.CHANNEL_FAILED)
    }
  }

  /**
   * Upload with 0600 permissions. Darwin uses a streamed exec channel, matching the iOS
   * transport; other hosts use SFTP. Accepts `file://` URIs and plain paths.
   */
  fun upload(localPath: String, remotePath: String) {
    val ssh = client ?: throw notConnectedException(machineId)
    val localFile = resolveLocalFile(localPath)
    if (!localFile.isFile) {
      throw GhostexException(GhostexErrorCode.SFTP_FAILED, "Local file not found: $localPath")
    }
    try {
      val viaExec = prefersExecUpload()
      withCommandChannel(DEFAULT_EXEC_TIMEOUT_MS) {
        if (viaExec) uploadViaExec(ssh, localFile, remotePath)
        else uploadViaSftp(ssh, localFile, remotePath)
      }
    } catch (error: Exception) {
      if (error is GhostexException) throw error
      throw mapSshError(error, fallbackCode = GhostexErrorCode.SFTP_FAILED)
    }
  }

  /** Cache the remote platform after the first upload; session identity does not change. */
  private fun prefersExecUpload(): Boolean {
    execUploadPreferred?.let { return it }
    val outcome = withCommandChannel(DEFAULT_EXEC_TIMEOUT_MS) {
      exec("uname -s", REMOTE_PLATFORM_DETECTION_TIMEOUT_MS)
    }
    val preferred = outcome.exitCode == 0 && outcome.stdout.trim() == "Darwin"
    execUploadPreferred = preferred
    return preferred
  }

  /**
   * Stream bytes over an exec channel on Darwin. The remote shell verifies the exact byte
   * count before keeping the file, so a broken channel cannot leave a truncated attachment.
   */
  private fun uploadViaExec(ssh: SSHClient, localFile: File, remotePath: String) {
    if (remotePath.isEmpty()) {
      throw GhostexException(GhostexErrorCode.SFTP_FAILED, "Upload path is empty.")
    }
    val quotedPath = shellQuote(remotePath)
    val expectedBytes = localFile.length()
    val command = listOf(
      "upload_path=$quotedPath",
      "cleanup() { rm -f \"\$upload_path\"; }",
      "trap cleanup EXIT HUP INT TERM",
      "cat > \"\$upload_path\" || exit 1",
      "actual_bytes=\$(wc -c < \"\$upload_path\" | tr -d '[:space:]')",
      "[ \"\$actual_bytes\" = \"$expectedBytes\" ] || exit 1",
      "chmod 600 \"\$upload_path\" || exit 1",
      "trap - EXIT HUP INT TERM"
    ).joinToString("\n")

    ssh.startSession().use { session ->
      val cmd = session.exec(command)
      val stdout = StreamCollector(cmd.inputStream)
      val stderr = StreamCollector(cmd.errorStream)
      localFile.inputStream().use { input ->
        cmd.outputStream.use { output -> input.copyTo(output) }
      }
      cmd.join(UPLOAD_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      stdout.await(STREAM_DRAIN_TIMEOUT_MS)
      stderr.await(STREAM_DRAIN_TIMEOUT_MS)
      val exitStatus = cmd.exitStatus
        ?: throw GhostexException(
          GhostexErrorCode.TIMEOUT,
          "Upload did not finish within ${UPLOAD_TIMEOUT_MS}ms on $machineId."
        )
      if (exitStatus != 0) {
        val detail = stderr.text().trim().takeIf { it.isNotEmpty() }
          ?: stdout.text().trim().takeIf { it.isNotEmpty() }
          ?: "Remote upload command exited with status $exitStatus."
        throw GhostexException(GhostexErrorCode.SFTP_FAILED, detail)
      }
    }
  }

  /** SFTP upload for non-Darwin hosts; remove the reserved path if any phase fails. */
  private fun uploadViaSftp(ssh: SSHClient, localFile: File, remotePath: String) {
    ssh.newSFTPClient().use { sftp ->
      try {
        makeRemoteDirectories(sftp, remoteDirectory(remotePath))
        sftp.put(FileSystemFile(localFile), remotePath)
        sftp.chmod(remotePath, OWNER_READ_WRITE_PERMISSIONS)
      } catch (error: Exception) {
        try {
          sftp.rm(remotePath)
        } catch (ignored: Exception) {
          // Preserve the transfer error; cleanup can also fail when the channel is gone.
        }
        throw error
      }
    }
  }

  /** Open a PTY-backed shell channel on this client for an interactive terminal. */
  fun openShellChannel(
    termType: String,
    columns: Int,
    rows: Int,
    cellWidthPixels: Int,
    cellHeightPixels: Int,
    command: String? = null
  ): ShellChannel {
    val ssh = client ?: throw notConnectedException(machineId)
    val session = try {
      ssh.startSession()
    } catch (error: Exception) {
      throw mapSshError(error, fallbackCode = GhostexErrorCode.CHANNEL_FAILED)
    }
    try {
      session.allocatePTY(termType, columns, rows, cellWidthPixels, cellHeightPixels, emptyMap<PTYMode, Int>())
      // SSHJ's SessionChannel implements both Command and Shell, including PTY resize.
      // Execute prepared commands directly: injecting `exec ...` into a login shell
      // breaks Windows cmd/PowerShell and can race interactive startup prompts.
      val shell = if (command.isNullOrEmpty()) session.startShell()
        else session.exec(command) as Session.Shell
      return ShellChannel(session, shell)
    } catch (error: Exception) {
      try {
        session.close()
      } catch (ignored: Exception) {
        // The PTY/shell error above is the useful failure.
      }
      throw mapSshError(error, fallbackCode = GhostexErrorCode.CHANNEL_FAILED)
    }
  }

  // region local port forwarding

  /**
   * Start (or reuse) the loopback forward for `localhost:[remotePort]` on the machine and
   * return the port it listens on here. One probe channel is opened and closed first so a
   * port nothing is bound to, and an sshd that refuses forwarding, fail here instead of
   * leaving the app with a listener that can never carry a byte.
   */
  fun startPortForward(remotePort: Int): Int {
    if (remotePort !in MIN_TCP_PORT..MAX_TCP_PORT) {
      throw GhostexException(
        GhostexErrorCode.CHANNEL_FAILED,
        "Port $remotePort is outside the valid TCP port range."
      )
    }
    val ssh = client?.takeIf { isConnected() } ?: throw notConnectedException(machineId)
    portForwards[remotePort]?.let { return it.localPort }
    synchronized(portForwardLock) {
      portForwards[remotePort]?.let { return it.localPort }
      Log.i(LOG_TAG, "startPortForward $machineId remotePort=$remotePort")
      probeRemotePort(ssh, remotePort)
      val forward = try {
        GhostexPortForward(machineId, remotePort) { client }
      } catch (error: Exception) {
        throw GhostexException(
          GhostexErrorCode.CHANNEL_FAILED,
          "Could not open a local listener for port $remotePort: " +
            (error.message ?: error.javaClass.simpleName),
          error
        )
      }
      forward.start()
      portForwards[remotePort] = forward
      return forward.localPort
    }
  }

  /**
   * Close the forward for [remotePort], including its in-flight channels. No-op when absent.
   *
   * Takes the same lock as [startPortForward]: a stop that overlaps a start for
   * the same port has to see the listener the start is about to publish, or the
   * start would insert it straight after the removal and leave it bound forever.
   */
  fun stopPortForward(remotePort: Int) {
    synchronized(portForwardLock) {
      portForwards.remove(remotePort)?.close()
    }
  }

  /** Live forwards as (remotePort, localPort) pairs. */
  fun listPortForwards(): List<Pair<Int, Int>> =
    portForwards.values.map { it.remotePort to it.localPort }.sortedBy { it.first }

  /**
   * A forward is only reachable while the transport that carries its channels is
   * alive, and the transport can die on its own — a keep-alive that goes
   * unanswered, or the OS tearing TCP down while the app is suspended — without
   * anyone calling [closeQuietly]. Without this, [listPortForwards] would keep
   * naming loopback listeners whose every accepted socket is dropped, which is
   * exactly what its contract says it never reports.
   */
  private fun installPortForwardTeardownOnTransportDeath(ssh: SSHClient) {
    ssh.transport.disconnectListener = DisconnectListener { reason, message ->
      Log.i(LOG_TAG, "transport for $machineId went down ($reason): ${message.orEmpty()}")
      onTransportDeath(this, message ?: "The SSH connection was lost.")
      /*
       * Never inline: this runs on sshj's reader thread, and the teardown takes
       * the port-forward lock that an in-flight start holds while it waits for a
       * channel-open reply that only this thread can deliver.
       */
      try {
        workExecutor.execute { closeAllPortForwards() }
      } catch (ignored: RejectedExecutionException) {
        // The executor is only shut down by closeQuietly, which closes them itself.
      }
    }
  }

  /** Same lock as [stopPortForward], for the same reason. */
  private fun closeAllPortForwards() {
    synchronized(portForwardLock) {
      val forwards = portForwards.values.toList()
      portForwards.clear()
      for (forward in forwards) forward.close()
    }
  }

  /**
   * Open one direct-tcpip channel to the remote's `localhost:[remotePort]` and close it
   * immediately, purely to turn the SSH_MSG_CHANNEL_OPEN_FAILURE reason into a specific
   * error before the caller believes the forward works.
   */
  private fun probeRemotePort(ssh: SSHClient, remotePort: Int) {
    val probe = try {
      ssh.newDirectConnection(REMOTE_LOOPBACK_HOST, remotePort)
    } catch (error: Exception) {
      Log.w(
        LOG_TAG,
        "startPortForward $machineId remotePort=$remotePort probe failed: " +
          (error.message ?: error.javaClass.simpleName)
      )
      throw mapPortForwardOpenError(error, remotePort)
    }
    try {
      probe.close()
    } catch (ignored: Exception) {
      // The probe already proved the remote accepts the channel; closing it is best effort.
    }
  }

  // endregion

  private fun makeRemoteDirectories(sftp: net.schmizz.sshj.sftp.SFTPClient, remoteDirectory: String) {
    if (remoteDirectory.isEmpty() || remoteDirectory == "." || remoteDirectory == "/") return
    val current = StringBuilder(if (remoteDirectory.startsWith("/")) "/" else "")
    for (part in remoteDirectory.split("/")) {
      if (part.isEmpty()) continue
      if (current.length > 1) current.append('/')
      current.append(part)
      try {
        sftp.mkdir(current.toString())
      } catch (ignored: Exception) {
        // Existing remote directories are expected on repeated file uploads.
      }
    }
  }

  private class StreamCollector(stream: InputStream?) {
    private val output = java.io.ByteArrayOutputStream()
    private val done = CountDownLatch(1)

    init {
      if (stream == null) {
        done.countDown()
      } else {
        Thread {
          try {
            val buffer = ByteArray(8192)
            while (true) {
              val count = stream.read(buffer)
              if (count == -1) break
              synchronized(output) { output.write(buffer, 0, count) }
            }
          } catch (ignored: Exception) {
            // Channel teardown interrupts the read; keep whatever was collected.
          } finally {
            done.countDown()
          }
        }.apply {
          name = "GhostexExecStream"
          isDaemon = true
          start()
        }
      }
    }

    fun await(timeoutMs: Long) {
      try {
        done.await(timeoutMs, TimeUnit.MILLISECONDS)
      } catch (ignored: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }

    fun text(): String = synchronized(output) { output.toString("UTF-8") }
  }

  companion object {
    /** Connection diagnostics land in logcat under this tag, next to "GhostexTerminal". */
    private const val LOG_TAG = "GhostexSsh"
    const val CONNECT_TIMEOUT_MS = 8_000
    const val DEFAULT_EXEC_TIMEOUT_MS = 20_000L
    private const val REMOTE_PLATFORM_DETECTION_TIMEOUT_MS = 5_000L
    private const val UPLOAD_TIMEOUT_MS = 120_000L
    private const val MIN_KEEP_ALIVE_INTERVAL_SECONDS = 10
    private const val MAX_KEEP_ALIVE_INTERVAL_SECONDS = 120
    private const val STREAM_DRAIN_TIMEOUT_MS = 2_000L
    private const val OWNER_READ_WRITE_PERMISSIONS = 0b110_000_000 // 0600

    /** OpenSSH's default `MaxSessions` (10) less the seven warm terminals `MAX_WARM_SESSIONS` allows. */
    private const val COMMAND_CHANNEL_SLOTS = 3

    /** tailcat forwards listen on loopback only; the tunnel itself carries the traffic. */
    private const val TAILCAT_LOOPBACK_HOST = "127.0.0.1"

    /** direct-tcpip target host for port forwards, resolved on the remote machine. */
    private const val REMOTE_LOOPBACK_HOST = "localhost"
    private const val MIN_TCP_PORT = 1
    private const val MAX_TCP_PORT = 65_535

    private fun remoteDirectory(remotePath: String): String {
      val slashIndex = remotePath.lastIndexOf('/')
      return if (slashIndex <= 0) "." else remotePath.substring(0, slashIndex)
    }

    private fun resolveLocalFile(localPath: String): File {
      if (localPath.startsWith("file:")) {
        val path = Uri.parse(localPath).path
        if (path != null) return File(path)
      }
      return File(localPath)
    }

    /** POSIX single-quote escaping for the Darwin exec-upload path. */
    private fun shellQuote(value: String): String =
      "'" + value.replace("'", "'\"'\"'") + "'"

    /**
     * Ported from the fork's GhostexSshTransport: replace Android's stale platform "BC"
     * provider with the bundled BouncyCastle so SSHJ can build Ed25519/EC primitives.
     */
    @JvmStatic
    @Synchronized
    fun ensureBundledBouncyCastleProvider() {
      val providerName = BouncyCastleProvider.PROVIDER_NAME
      val provider: Provider? = Security.getProvider(providerName)
      if (provider !is BouncyCastleProvider) {
        if (provider != null) Security.removeProvider(providerName)
        Security.insertProviderAt(BouncyCastleProvider(), 1)
      }
      SecurityUtils.setSecurityProvider(providerName)
      validateBundledBouncyCastleProvider()
    }

    private fun validateBundledBouncyCastleProvider() {
      try {
        val provider = Security.getProvider(BouncyCastleProvider.PROVIDER_NAME)
        check(provider is BouncyCastleProvider) { "Bundled BouncyCastle provider is not installed." }
        check(SecurityUtils.getKeyFactory("Ed25519").provider is BouncyCastleProvider) {
          "SSHJ Ed25519 KeyFactory did not resolve to bundled BouncyCastle."
        }
        check(KeyFactory.getInstance("EC", BouncyCastleProvider.PROVIDER_NAME).provider is BouncyCastleProvider) {
          "SSHJ EC KeyFactory did not resolve to bundled BouncyCastle."
        }
      } catch (error: Exception) {
        throw IllegalStateException("Ghostex Android SSH crypto provider is unavailable.", error)
      }
    }

    /**
     * Ported from the fork: AndroidConfig without curve25519 KEX factories, which fail on
     * Android's provider stack, plus keep-alives for the persistent client.
     */
    fun createSshConfig(): Config {
      val config = AndroidConfig()
      val supportedFactories = ArrayList<Factory.Named<KeyExchange>>()
      for (factory in config.keyExchangeFactories) {
        if (!isUnsupportedAndroidKeyExchange(factory.name)) supportedFactories.add(factory)
      }
      config.keyExchangeFactories = supportedFactories
      config.keepAliveProvider = KeepAliveProvider.KEEP_ALIVE
      return config
    }

    private fun isUnsupportedAndroidKeyExchange(name: String?): Boolean =
      name != null && name.lowercase(Locale.ROOT).contains("curve25519")
  }
}
