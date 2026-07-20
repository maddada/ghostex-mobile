package expo.modules.ghostexnative

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.InputStream
import java.security.KeyFactory
import java.security.Provider
import java.security.Security
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import net.schmizz.keepalive.KeepAliveProvider
import net.schmizz.sshj.AndroidConfig
import net.schmizz.sshj.Config
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Factory
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.connection.channel.direct.PTYMode
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.kex.KeyExchange
import net.schmizz.sshj.userauth.UserAuthException
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
  private val config: SshConfigRecord
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

  fun isConnected(): Boolean {
    val ssh = client ?: return false
    return ssh.isConnected && ssh.isAuthenticated
  }

  /** Blocking connect + auth with the fork's 8s connect timeout. Throws [GhostexException]. */
  fun connect() {
    ensureBundledBouncyCastleProvider()
    val ssh = SSHClient(createSshConfig())
    ssh.connectTimeout = CONNECT_TIMEOUT_MS
    // This client is long-lived and multiplexes idle terminal channels, so unlike the fork's
    // per-command clients it must not have a socket read timeout; keep-alives detect dead peers.
    ssh.timeout = 0
    val verifier = GhostexPersistedHostKeyVerifier(config.host, config.port, hostKeys)
    ssh.addHostKeyVerifier(verifier)
    try {
      ssh.connect(config.host, config.port)
      authenticate(ssh)
      ssh.connection.keepAlive.keepAliveInterval = KEEP_ALIVE_INTERVAL_SECONDS
      client = ssh
    } catch (error: Exception) {
      try {
        if (ssh.isConnected) ssh.disconnect() else ssh.close()
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
      throw mapSshError(error, fallbackCode = GhostexErrorCode.UNREACHABLE)
    }
  }

  private fun authenticate(ssh: SSHClient) {
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
    val ssh = client
    client = null
    try {
      ssh?.disconnect()
    } catch (ignored: Exception) {
      // Closing a dead SSH connection can throw; there is nothing actionable here.
    }
    workExecutor.shutdown()
  }

  /**
   * Run [command] in its own non-interactive session channel, collecting stdout/stderr off
   * the channel while waiting so large outputs cannot stall the remote window.
   */
  fun exec(command: String, timeoutMs: Long): ExecOutcome {
    val ssh = client ?: throw notConnectedException(machineId)
    try {
      ssh.startSession().use { session ->
        val cmd = session.exec(command)
        val stdout = StreamCollector(cmd.inputStream)
        val stderr = StreamCollector(cmd.errorStream)
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

  /** SFTP upload with 0600 permissions. Accepts `file://` URIs and plain paths. */
  fun upload(localPath: String, remotePath: String) {
    val ssh = client ?: throw notConnectedException(machineId)
    val localFile = resolveLocalFile(localPath)
    if (!localFile.isFile) {
      throw GhostexException(GhostexErrorCode.SFTP_FAILED, "Local file not found: $localPath")
    }
    try {
      ssh.newSFTPClient().use { sftp ->
        makeRemoteDirectories(sftp, remoteDirectory(remotePath))
        sftp.put(FileSystemFile(localFile), remotePath)
        sftp.chmod(remotePath, OWNER_READ_WRITE_PERMISSIONS)
      }
    } catch (error: Exception) {
      if (error is GhostexException) throw error
      throw mapSshError(error, fallbackCode = GhostexErrorCode.SFTP_FAILED)
    }
  }

  /** Open a PTY-backed shell channel on this client for an interactive terminal. */
  fun openShellChannel(
    termType: String,
    columns: Int,
    rows: Int,
    cellWidthPixels: Int,
    cellHeightPixels: Int
  ): ShellChannel {
    val ssh = client ?: throw notConnectedException(machineId)
    val session = try {
      ssh.startSession()
    } catch (error: Exception) {
      throw mapSshError(error, fallbackCode = GhostexErrorCode.CHANNEL_FAILED)
    }
    try {
      session.allocatePTY(termType, columns, rows, cellWidthPixels, cellHeightPixels, emptyMap<PTYMode, Int>())
      val shell = session.startShell()
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
    const val CONNECT_TIMEOUT_MS = 8_000
    const val DEFAULT_EXEC_TIMEOUT_MS = 20_000L
    private const val KEEP_ALIVE_INTERVAL_SECONDS = 15
    private const val STREAM_DRAIN_TIMEOUT_MS = 2_000L
    private const val OWNER_READ_WRITE_PERMISSIONS = 0b110_000_000 // 0600

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
