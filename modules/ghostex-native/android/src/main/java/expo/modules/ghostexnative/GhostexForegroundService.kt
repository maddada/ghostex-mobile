package expo.modules.ghostexnative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.IBinder
import android.os.PowerManager
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlin.math.abs

/**
 * Persistent foreground-service notification, ported from the Ghostex Termux
 * fork's TermuxService: a silent ongoing notification (channel
 * "ghostex_notification_channel", id 1337) that keeps SSH connections and
 * warm terminal sessions alive while the app is backgrounded, shows the
 * remote session inventory (status dot + title per row), and offers Exit and
 * Keep-awake (PARTIAL_WAKE_LOCK + high-perf wifi lock) actions.
 *
 * CDXC:VoiceMode 2026-10-20 WHY: A voice conversation with the manager voice agent turns the same
 * service and notification into "Voice mode on" (Hang up and Mute actions) and adds the `microphone`
 * service type, so the conversation keeps going with the screen locked; it does not add a second
 * service or notification (docs/2026-10-20/voice-mode/read-aloud-extension-spec.md, section 6.3,
 * which Read aloud reuses for its `mediaPlayback` type). Android only lets a service take the
 * microphone type while the app is in front, which it is: the user just tapped the Voice button.
 *
 * CDXC:VoiceMode 2026-10-20 DECISION: User: on the phone, auto-read keeps working while the phone is locked or Ghostex is in the background, through an Android foreground service with a "Voice mode on" notification.
 * CDXC:VoiceMode 2026-10-22 WHY: Auto-read reuses this service and notification (spec 6.3): turning it on adds the `mediaPlayback` type, from the ⋯ menu while the app is in front as Android requires; the notification reads "Reading <session> aloud" with Pause / Resume while a reply plays and Stop, which stops the speech and turns Auto-read off, and tapping it opens that chat. A voice agent call and Auto-read share the one notification: the call's line wins while both run and the service keeps both types. The expanded view keeps the session rows.
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
    enterForeground()
  }

  /**
   * (Re)enters the foreground with the service types the current mode needs: `specialUse` for the
   * session notification, plus `microphone` while a voice conversation runs.
   */
  private fun enterForeground() {
    var types = if (android.os.Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    if (voiceLine != null && android.os.Build.VERSION.SDK_INT >= 30 &&
      ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    ) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    if (readAloud != null && android.os.Build.VERSION.SDK_INT >= 29) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    }
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), types)
    } catch (error: RuntimeException) {
      // The microphone and media types are refused from the background; keep the notification.
      val background = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), types and background.inv())
    }
  }

  /** Rebuild + repost the ongoing notification (thread-safe). */
  internal fun refreshNotification() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, buildNotification())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        // Exit ends everything, a voice conversation and Auto-read included.
        if (voiceLine != null) GhostexVoice.end("conversation")
        voiceLine = null
        if (readAloud != null) GhostexSpeech.stopVoiceMode()
        readAloud = null
        persistentWanted = false
        return shutDown()
      }
      ACTION_PERSISTENT_OFF -> {
        persistentWanted = false
        if (voiceLine == null && readAloud == null) return shutDown()
      }
      ACTION_VOICE_OFF -> if (!persistentWanted && readAloud == null) return shutDown()
      ACTION_READ_ALOUD_OFF -> if (!persistentWanted && voiceLine == null) return shutDown()
      ACTION_READ_ALOUD_STOP -> {
        GhostexSpeech.stopVoiceMode()
        readAloud = null
        if (!persistentWanted && voiceLine == null) return shutDown()
      }
      ACTION_READ_ALOUD_PAUSE -> {
        GhostexSpeech.togglePauseByUser()
        return START_NOT_STICKY
      }
      ACTION_VOICE_HANG_UP -> {
        GhostexVoice.end("conversation")
        return START_NOT_STICKY
      }
      ACTION_VOICE_MUTE -> {
        GhostexVoice.setMuted(!voiceMuted)
        return START_NOT_STICKY
      }
      ACTION_VOICE_TALK -> {
        GhostexVoice.toggleTalking()
        return START_NOT_STICKY
      }
      ACTION_WAKE_LOCK -> acquireLocks()
      ACTION_WAKE_UNLOCK -> releaseLocks()
    }
    setupNotificationChannel()
    enterForeground()
    return START_NOT_STICKY
  }

  private fun shutDown(): Int {
    releaseLocks()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
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
    // "Voice mode on" sits with the user's alerts rather than in the collapsed Silent group, so
    // Hang up and Mute are one pull away; it never makes a sound or vibrates itself.
    val voice = NotificationChannel(VOICE_CHANNEL_ID, VOICE_CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT)
    voice.setShowBadge(false)
    voice.setSound(null, null)
    voice.enableVibration(false)
    manager.createNotificationChannel(voice)
  }

  private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, GhostexForegroundService::class.java).setAction(action)
    return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_IMMUTABLE)
  }

  /**
   * Status dot tint, matching the old fork's notification row colors; a Failed session (the bell's Failed section,
   * persistentNotificationRows.ts) is red.
   */
  private fun dotColor(status: String): Int = when (status) {
    "working" -> 0xFFF59E0B.toInt()
    "attention", "done" -> 0xFF95D7F6.toInt()
    "failed" -> 0xFFEF4444.toInt()
    "sleep", "sleeping" -> 0xFF6E7684.toInt()
    else -> 0xFF9CA3AF.toInt()
  }

  /** Deep-link tap target for one session row (ghostex:// scheme). */
  private fun rowPendingIntent(row: SessionRow, index: Int): PendingIntent? {
    if (row.sessionId.isEmpty() || row.machineId.isEmpty()) return null
    val uri = Uri.Builder()
      .scheme("ghostex")
      .authority("session")
      .appendQueryParameter("machineId", row.machineId)
      .appendQueryParameter("sessionId", row.sessionId)
      .appendQueryParameter("title", row.title)
      // The tap opens the session as the bell's row does: its rows are marked read (deepLinkHandler.ts).
      .appendQueryParameter("source", "notification")
      .build()
    val intent = Intent(Intent.ACTION_VIEW, uri)
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val requestCode = 10_000 + index + abs(row.sessionId.hashCode() % 10_000)
    return PendingIntent.getActivity(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  /** Fill one shared row slot (dot color + text + tap intent) or hide it. */
  private fun bindRows(views: RemoteViews, rows: List<SessionRow>, slotCount: Int) {
    for (slot in 0 until slotCount) {
      val rowId = ROW_IDS[slot]
      val dotId = ROW_DOT_IDS[slot]
      val textId = ROW_TEXT_IDS[slot]
      val row = rows.getOrNull(slot)
      if (row == null) {
        views.setViewVisibility(rowId, android.view.View.GONE)
        continue
      }
      views.setViewVisibility(rowId, android.view.View.VISIBLE)
      views.setTextViewText(dotId, "●")
      views.setTextColor(dotId, dotColor(row.status))
      val suffix = if (row.project.isNotEmpty()) ": ${row.project}" else ""
      views.setTextViewText(textId, "${row.title}$suffix")
      rowPendingIntent(row, slot)?.let { views.setOnClickPendingIntent(rowId, it) }
    }
  }

  /**
   * CDXC:Notifications 2026-11-08 DECISION: User, on merging the iPhone bell (ghostex-mobile#29): "make android match
   * please, i dont want android and ios experience to diverge in terms of behavior". The line counts what the bell
   * counts: the sessions that wait for the user ("attention" rows, the bell's Needs you), not finished or failed ones.
   */
  private fun summaryText(rows: List<SessionRow>): String {
    if (rows.isEmpty()) return "Ready to connect to Ghostex sessions"
    val working = rows.count { it.status == "working" }
    val needsYou = rows.count { it.status == "attention" }
    val parts = mutableListOf<String>()
    if (needsYou > 0) parts.add("$needsYou need you")
    if (working > 0) parts.add("$working working")
    if (parts.isEmpty()) {
      parts.add(if (rows.size == 1) "1 remote terminal" else "${rows.size} remote terminals")
    }
    return parts.joinToString(" · ")
  }

  /**
   * "Voice mode on": the state line, Mute / Unmute (Regular) or Talk / Send (push-to-talk) and Hang
   * up; tapping it opens the voice screen.
   *
   * CDXC:VoiceMode 2026-10-24 DECISION: User, asked "What can you do from the phone's notification and lock screen in a Push-to-talk call?", picked "Add a Talk button: tap to start, tap again to send" (not the recommended Hang up only). Notification buttons only take taps, so Talk starts the turn and the same button, now Send, sends it; a muted call shows no Talk (Mute wins).
   */
  private fun buildVoiceNotification(line: String): Notification {
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("ghostex://voice"))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return NotificationCompat.Builder(this, VOICE_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_ghostex_service)
      .setColor(0xFF607D8B.toInt())
      .setContentTitle("Voice mode on")
      .setContentText(line)
      .setOngoing(true)
      .setShowWhen(false)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(PendingIntent.getActivity(this, 3, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      .apply {
        // A push-to-talk call listens only while Talk is held, so Mute gives way to Talk / Send there.
        if (!voicePushToTalk) {
          addAction(
            android.R.drawable.ic_btn_speak_now,
            if (voiceMuted) "Unmute" else "Mute",
            servicePendingIntent(ACTION_VOICE_MUTE, 4)
          )
        } else if (!voiceMuted) {
          addAction(
            android.R.drawable.ic_btn_speak_now,
            if (voiceTalking) "Send" else "Talk",
            servicePendingIntent(ACTION_VOICE_TALK, 9)
          )
        }
      }
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Hang up", servicePendingIntent(ACTION_VOICE_HANG_UP, 5))
      .build()
  }

  /**
   * Read aloud's "Voice mode on": the reading line, Pause / Resume while a reply plays, and Stop;
   * tapping it opens the chat being read. The expanded view keeps the session rows.
   */
  private fun buildReadAloudNotification(state: ReadAloudMode): Notification {
    val open = Intent(Intent.ACTION_VIEW, Uri.Builder()
      .scheme("ghostex")
      .authority("session")
      .appendQueryParameter("machineId", state.machineId)
      .appendQueryParameter("sessionId", state.sessionId)
      .appendQueryParameter("title", state.title)
      .build())
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val line = when {
      state.reconnecting != null -> "Reconnecting to ${state.reconnecting}…"
      readAloudPaused -> "Paused · ${state.title}"
      else -> "Reading ${state.title} aloud"
    }
    val builder = NotificationCompat.Builder(this, VOICE_CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_ghostex_service)
      .setColor(0xFF607D8B.toInt())
      .setContentTitle("Voice mode on")
      .setContentText(line)
      .setOngoing(true)
      .setShowWhen(false)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
      .setContentIntent(PendingIntent.getActivity(this, 6, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    val rows = sessionRows
    if (rows.isNotEmpty()) {
      val expanded = RemoteViews(packageName, R.layout.notification_ghostex_expanded)
      expanded.setTextViewText(R.id.ghostex_summary, "Voice mode on · $line")
      bindRows(expanded, rows, MAX_NOTIFICATION_ROWS)
      if (rows.size > MAX_NOTIFICATION_ROWS) {
        expanded.setViewVisibility(R.id.ghostex_more, android.view.View.VISIBLE)
        expanded.setTextViewText(R.id.ghostex_more, "+${rows.size - MAX_NOTIFICATION_ROWS} more")
      } else {
        expanded.setViewVisibility(R.id.ghostex_more, android.view.View.GONE)
      }
      builder.setStyle(NotificationCompat.DecoratedCustomViewStyle())
      builder.setCustomBigContentView(expanded)
    }
    if (readAloudSpeaking) {
      builder.addAction(
        if (readAloudPaused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
        if (readAloudPaused) "Resume" else "Pause",
        servicePendingIntent(ACTION_READ_ALOUD_PAUSE, 7)
      )
    }
    builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", servicePendingIntent(ACTION_READ_ALOUD_STOP, 8))
    return builder.build()
  }

  private fun buildNotification(): Notification {
    voiceLine?.let { return buildVoiceNotification(it) }
    readAloud?.let { return buildReadAloudNotification(it) }
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
      val summary = summaryText(rows)

      val collapsed = RemoteViews(packageName, R.layout.notification_ghostex_collapsed)
      collapsed.setTextViewText(R.id.ghostex_summary, summary)
      bindRows(collapsed, rows, COLLAPSED_ROW_COUNT)

      val expanded = RemoteViews(packageName, R.layout.notification_ghostex_expanded)
      expanded.setTextViewText(R.id.ghostex_summary, summary)
      bindRows(expanded, rows, MAX_NOTIFICATION_ROWS)
      if (rows.size > MAX_NOTIFICATION_ROWS) {
        expanded.setViewVisibility(R.id.ghostex_more, android.view.View.VISIBLE)
        expanded.setTextViewText(R.id.ghostex_more, "+${rows.size - MAX_NOTIFICATION_ROWS} more")
      } else {
        expanded.setViewVisibility(R.id.ghostex_more, android.view.View.GONE)
      }

      builder.setStyle(NotificationCompat.DecoratedCustomViewStyle())
      builder.setCustomContentView(collapsed)
      builder.setCustomBigContentView(expanded)
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
    const val VOICE_CHANNEL_ID = "ghostex_voice_mode_channel"
    const val VOICE_CHANNEL_NAME = "Voice mode"
    const val ACTION_STOP = "expo.modules.ghostexnative.service.STOP"
    const val ACTION_WAKE_LOCK = "expo.modules.ghostexnative.service.WAKE_LOCK"
    const val ACTION_WAKE_UNLOCK = "expo.modules.ghostexnative.service.WAKE_UNLOCK"
    const val ACTION_PERSISTENT_OFF = "expo.modules.ghostexnative.service.PERSISTENT_OFF"
    const val ACTION_VOICE_ON = "expo.modules.ghostexnative.service.VOICE_ON"
    const val ACTION_VOICE_OFF = "expo.modules.ghostexnative.service.VOICE_OFF"
    const val ACTION_VOICE_HANG_UP = "expo.modules.ghostexnative.service.VOICE_HANG_UP"
    const val ACTION_VOICE_MUTE = "expo.modules.ghostexnative.service.VOICE_MUTE"
    const val ACTION_VOICE_TALK = "expo.modules.ghostexnative.service.VOICE_TALK"
    const val ACTION_READ_ALOUD_ON = "expo.modules.ghostexnative.service.READ_ALOUD_ON"
    const val ACTION_READ_ALOUD_OFF = "expo.modules.ghostexnative.service.READ_ALOUD_OFF"
    const val ACTION_READ_ALOUD_STOP = "expo.modules.ghostexnative.service.READ_ALOUD_STOP"
    const val ACTION_READ_ALOUD_PAUSE = "expo.modules.ghostexnative.service.READ_ALOUD_PAUSE"
    /** The one-off "Voice mode turned off" notice (its own id, so it outlives the service's). */
    const val READ_ALOUD_ENDED_NOTIFICATION_ID = 1338
    const val MAX_NOTIFICATION_ROWS = 5
    const val COLLAPSED_ROW_COUNT = 2

    private val ROW_IDS = intArrayOf(
      R.id.ghostex_row1, R.id.ghostex_row2, R.id.ghostex_row3, R.id.ghostex_row4, R.id.ghostex_row5
    )
    private val ROW_DOT_IDS = intArrayOf(
      R.id.ghostex_row1_dot, R.id.ghostex_row2_dot, R.id.ghostex_row3_dot,
      R.id.ghostex_row4_dot, R.id.ghostex_row5_dot
    )
    private val ROW_TEXT_IDS = intArrayOf(
      R.id.ghostex_row1_text, R.id.ghostex_row2_text, R.id.ghostex_row3_text,
      R.id.ghostex_row4_text, R.id.ghostex_row5_text
    )

    data class SessionRow(
      val title: String,
      val status: String,
      val project: String,
      val machineId: String,
      val sessionId: String,
    )

    /** Snapshot rendered into the notification; written from the module. */
    @Volatile
    var sessionRows: List<SessionRow> = emptyList()

    @Volatile
    var isRunning = false

    /** Whether the session notification is wanted (a computer is configured), apart from voice. */
    @Volatile
    private var persistentWanted = false

    /** The "Voice mode on" state line while a conversation runs, else null. */
    @Volatile
    private var voiceLine: String? = null

    @Volatile
    private var voiceMuted = false

    @Volatile
    private var voicePushToTalk = false

    @Volatile
    private var voiceTalking = false

    /** The chat Auto-read reads while Voice mode is on for Read aloud, and the computer it waits for. */
    data class ReadAloudMode(
      val title: String,
      val machineId: String,
      val sessionId: String,
      /** The computer's name while its link is down, else null. */
      val reconnecting: String? = null,
    )

    @Volatile
    private var readAloud: ReadAloudMode? = null

    /** A reply is being read (Pause shows), and whether it is paused. */
    @Volatile
    private var readAloudSpeaking = false

    @Volatile
    private var readAloudPaused = false

    @Volatile
    private var instance: GhostexForegroundService? = null

    fun start(context: Context) {
      persistentWanted = true
      ContextCompat.startForegroundService(
        context,
        Intent(context, GhostexForegroundService::class.java)
      )
    }

    fun stop(context: Context) {
      if (!isRunning) {
        persistentWanted = false
        return
      }
      context.startService(
        Intent(context, GhostexForegroundService::class.java).setAction(ACTION_PERSISTENT_OFF)
      )
    }

    /** Switches the notification to "Voice mode on" and takes the microphone service type. */
    fun startVoiceMode(context: Context, title: String) {
      voiceMuted = false
      voicePushToTalk = false
      voiceLine = "Connecting to $title…"
      ContextCompat.startForegroundService(
        context,
        Intent(context, GhostexForegroundService::class.java).setAction(ACTION_VOICE_ON)
      )
    }

    /** A new state line (Listening, Speaking, Reconnecting…) for the voice notification. */
    fun updateVoiceMode(line: String, muted: Boolean, pushToTalk: Boolean, talking: Boolean) {
      if (voiceLine == null ||
        (voiceLine == line && voiceMuted == muted && voicePushToTalk == pushToTalk && voiceTalking == talking)
      ) return
      voiceLine = line
      voiceMuted = muted
      voicePushToTalk = pushToTalk
      voiceTalking = talking
      update()
    }

    /** Back to the session notification (or no service at all when none is wanted). */
    fun stopVoiceMode(context: Context) {
      if (voiceLine == null) return
      voiceLine = null
      voiceMuted = false
      voiceTalking = false
      if (!isRunning) return
      try {
        context.startService(Intent(context, GhostexForegroundService::class.java).setAction(ACTION_VOICE_OFF))
      } catch (_: IllegalStateException) {
        // In the background a plain start is refused; the running service just redraws.
        update()
      }
    }

    /**
     * Read aloud's Voice mode on or updated: `mediaPlayback` joins the service types. Called from
     * the ⋯ menu's Auto-read, while the app is in front; a later call only redraws.
     */
    fun startReadAloudMode(context: Context, mode: ReadAloudMode) {
      val wasOn = readAloud != null
      readAloud = mode
      if (wasOn && isRunning) {
        update()
        return
      }
      try {
        ContextCompat.startForegroundService(
          context,
          Intent(context, GhostexForegroundService::class.java).setAction(ACTION_READ_ALOUD_ON)
        )
      } catch (_: IllegalStateException) {
        // In the background a start is refused; a running service just redraws.
        update()
      }
    }

    /** Back to the session notification (or no service at all when none is wanted). */
    fun stopReadAloudMode(context: Context) {
      if (readAloud == null) return
      readAloud = null
      readAloudSpeaking = false
      readAloudPaused = false
      if (!isRunning) return
      try {
        context.startService(Intent(context, GhostexForegroundService::class.java).setAction(ACTION_READ_ALOUD_OFF))
      } catch (_: IllegalStateException) {
        update()
      }
    }

    /** What the speaker is doing, for Pause / Resume and the line. */
    fun setReadAloudPlayback(speaking: Boolean, paused: Boolean) {
      if (readAloudSpeaking == speaking && readAloudPaused == paused) return
      readAloudSpeaking = speaking
      readAloudPaused = paused
      if (readAloud != null) update()
    }

    /** Says that Voice mode turned itself off, in a notification of its own that outlives it. */
    fun postReadAloudEnded(context: Context, title: String, text: String) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val notification = NotificationCompat.Builder(context, VOICE_CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_ghostex_service)
        .setColor(0xFF607D8B.toInt())
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setAutoCancel(true)
        .apply {
          if (launch != null) setContentIntent(PendingIntent.getActivity(context, 9, launch, PendingIntent.FLAG_IMMUTABLE))
        }
        .build()
      manager.notify(READ_ALOUD_ENDED_NOTIFICATION_ID, notification)
    }

    /** Re-render the notification in place if the service is running. */
    fun update() {
      instance?.refreshNotification()
    }
  }
}
