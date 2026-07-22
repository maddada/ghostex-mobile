package expo.modules.ghostexnative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Persistent foreground-service notification, ported from the Ghostex Termux
 * fork's TermuxService: a silent ongoing notification (channel
 * "ghostex_notification_channel", id 1337) that keeps SSH connections and
 * warm terminal sessions alive while the app is backgrounded, shows the
 * remote session inventory (status dot + title per row), and offers Exit and
 * Keep-awake (PARTIAL_WAKE_LOCK + high-perf wifi lock) actions.
 */
class GhostexForegroundService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    isRunning = true
    setupNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
  }

  /** Rebuild + repost the ongoing notification (thread-safe). */
  internal fun refreshNotification() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, buildNotification())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        releaseLocks()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_WAKE_LOCK -> acquireLocks()
      ACTION_WAKE_UNLOCK -> releaseLocks()
    }
    setupNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    releaseLocks()
    isRunning = false
    instance = null
    super.onDestroy()
  }

  // region wake locks (same pairing as the Termux fork: never one without the other)

  @Suppress("DEPRECATION", "WakelockTimeout")
  private fun acquireLocks() {
    if (wakeLock != null) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ghostex:service-wakelock")
    wakeLock?.acquire()
    val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "ghostex")
    wifiLock?.acquire()
  }

  private fun releaseLocks() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    wifiLock?.let { if (it.isHeld) it.release() }
    wifiLock = null
  }

  // endregion

  // region notification

  private fun setupNotificationChannel() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW)
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, GhostexForegroundService::class.java).setAction(action)
    return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE)
  }

  private fun statusDot(status: String): String = when (status) {
    "working" -> "🟠" // orange circle
    "attention", "done" -> "🔵" // blue circle
    "sleep", "sleeping" -> "🌙" // crescent moon
    else -> "⚪" // white circle
  }

  private fun summaryText(rows: List<SessionRow>): String {
    if (rows.isEmpty()) return "Ready to connect to Ghostex sessions"
    val working = rows.count { it.status == "working" }
    val attention = rows.count { it.status == "attention" || it.status == "done" }
    val parts = mutableListOf<String>()
    parts.add(if (rows.size == 1) "1 remote terminal" else "${rows.size} remote terminals")
    if (working > 0) parts.add("$working working")
    if (attention > 0) parts.add(if (attention == 1) "1 needs attention" else "$attention need attention")
    if (wakeLock != null) parts.add("keeping connection awake")
    return parts.joinToString(" · ")
  }

  private fun buildNotification(): Notification {
    val rows = sessionRows
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_ghostex_service)
      .setColor(0xFF607D8B.toInt())
      .setContentTitle("Ghostex")
      .setContentText(summaryText(rows))
      .setOngoing(true)
      .setShowWhen(false)
      .setSilent(true)
      .setPriority(
        if (wakeLock != null) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_LOW
      )

    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setContentIntent(
        PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE)
      )
    }

    if (rows.isNotEmpty()) {
      val style = NotificationCompat.InboxStyle()
      for (row in rows.take(MAX_NOTIFICATION_ROWS)) {
        val suffix = if (row.project.isNotEmpty()) " — ${row.project}" else ""
        style.addLine("${statusDot(row.status)} ${row.title}$suffix")
      }
      if (rows.size > MAX_NOTIFICATION_ROWS) {
        style.setSummaryText("+${rows.size - MAX_NOTIFICATION_ROWS} more")
      }
      builder.setStyle(style)
      builder.setNumber(rows.size)
      builder.setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
    }

    builder.addAction(
      android.R.drawable.ic_delete,
      "Exit",
      servicePendingIntent(ACTION_STOP, 1)
    )
    builder.addAction(
      if (wakeLock != null) android.R.drawable.ic_lock_idle_lock else android.R.drawable.ic_lock_lock,
      if (wakeLock != null) "Stop keeping awake" else "Keep awake",
      servicePendingIntent(if (wakeLock != null) ACTION_WAKE_UNLOCK else ACTION_WAKE_LOCK, 2)
    )

    return builder.build()
  }

  // endregion

  companion object {
    const val NOTIFICATION_ID = 1337
    const val CHANNEL_ID = "ghostex_notification_channel"
    const val CHANNEL_NAME = "Ghostex App"
    const val ACTION_STOP = "expo.modules.ghostexnative.service.STOP"
    const val ACTION_WAKE_LOCK = "expo.modules.ghostexnative.service.WAKE_LOCK"
    const val ACTION_WAKE_UNLOCK = "expo.modules.ghostexnative.service.WAKE_UNLOCK"
    const val MAX_NOTIFICATION_ROWS = 5

    data class SessionRow(val title: String, val status: String, val project: String)

    /** Snapshot rendered into the notification; written from the module. */
    @Volatile
    var sessionRows: List<SessionRow> = emptyList()

    @Volatile
    var isRunning = false

    @Volatile
    private var instance: GhostexForegroundService? = null

    fun start(context: Context) {
      ContextCompat.startForegroundService(
        context,
        Intent(context, GhostexForegroundService::class.java)
      )
    }

    fun stop(context: Context) {
      context.startService(
        Intent(context, GhostexForegroundService::class.java).setAction(ACTION_STOP)
      )
    }

    /** Re-render the notification in place if the service is running. */
    fun update() {
      instance?.refreshNotification()
    }
  }
}
