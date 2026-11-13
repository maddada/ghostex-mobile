package expo.modules.ghostexnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * The phone's end of gxserver's `/api/voice`: the manager voice agent's conversation and the
 * composer's Grok dictation (docs/2026-10-20/voice-mode/voice-agent-client-contract.md).
 *
 * CDXC:VoiceMode 2026-10-20 WHY: The socket, the microphone and the speaker live here in Kotlin, not
 * in JavaScript, because the conversation has to keep going with the screen locked: React Native
 * stops its JavaScript timers while the activity is paused, so a JavaScript capture loop or
 * reconnect ladder would stall in a pocket. JavaScript only draws what [emit] reports and, when the
 * socket drops, re-opens the SSH forward ([updateLink]); the reattach ladder itself runs here.
 * SEE-ALSO: src/voice/ in the app (store, screen, link), GhostexVoiceAudio.kt, GhostexForegroundService.kt.
 */
internal object GhostexVoice {
  private const val TAG = "GhostexVoice"
  private const val PROTOCOL_VERSION = 1
  /** gxserver keeps a detached conversation this long (contract section 5); the phone stops trying then. */
  private const val REATTACH_WINDOW_MS = 120_000L
  private val REATTACH_DELAYS_MS = longArrayOf(500, 1_000, 2_000, 3_000)
  private const val DEBUG_FEED_ACTION = "io.ghostex.debug.VOICE_FEED"

  /** Set by the module; every voice event for JavaScript goes through it. */
  @Volatile var emitter: ((Map<String, Any?>) -> Unit)? = null

  private val client: OkHttpClient by lazy {
    OkHttpClient.Builder()
      .readTimeout(0, TimeUnit.MILLISECONDS)
      // A link that died silently (cell handover, sleeping Wi-Fi) is noticed within seconds.
      .pingInterval(10, TimeUnit.SECONDS)
      .build()
  }
  private val worker: Handler by lazy {
    Handler(HandlerThread("GhostexVoiceLink").apply { start() }.looper)
  }

  private val lock = Any()
  private var conversation: Session? = null
  private var dictation: Session? = null
  private var debugReceiver: BroadcastReceiver? = null

  data class Options(
    val mode: String,
    val localPort: Int,
    val authToken: String,
    val title: String,
    val provider: String?,
    val language: String?,
    /** Conversation only: `<projectId>:<sessionId>` for a call about one session, else null. */
    val focus: String? = null,
  )

  /** Starts a conversation or a dictation, replacing one of the same mode that is still running. */
  fun start(context: Context, options: Options): String {
    val session = Session(context.applicationContext, options)
    val previous = synchronized(lock) {
      if (options.mode == "dictation") dictation.also { dictation = session } else conversation.also { conversation = session }
    }
    previous?.dispose("replaced")
    installDebugFeed(context.applicationContext)
    session.start()
    return session.id
  }

  private fun current(mode: String): Session? = synchronized(lock) { if (mode == "dictation") dictation else conversation }

  /** A fresh forward port and token for a session that is reattaching (JavaScript rebuilt the SSH link). */
  fun updateLink(mode: String, localPort: Int, authToken: String) {
    current(mode)?.updateLink(localPort, authToken)
  }

  fun setMuted(muted: Boolean) {
    current("conversation")?.setMuted(muted)
  }

  /** The voice screen's hold button pressed or released (gxserver's talk.rs decides the turn). */
  fun setTalking(talking: Boolean) {
    current("conversation")?.setTalking(talking)
  }

  /** The finger slid off the hold button before letting go: nothing said is sent. */
  fun cancelTalking() {
    current("conversation")?.cancelTalking()
  }

  /** The notification's Talk / Send: starts a push-to-talk turn, or sends the one in progress. */
  fun toggleTalking() {
    current("conversation")?.toggleTalking()
  }

  fun interrupt() {
    current("conversation")?.sendJson(JSONObject().put("type", "interrupt"))
  }

  fun sendText(text: String) {
    current("conversation")?.sendJson(JSONObject().put("type", "text").put("text", text))
  }

  /** The voice screen's speed buttons: plays the agent faster and tells gxserver the rate. */
  fun setSpeed(speed: Double) {
    current("conversation")?.setSpeed(speed.toFloat())
  }

  /** The voice screen's voice picker: gxserver switches when the provider can and answers `voice`. */
  fun setVoice(voice: String) {
    current("conversation")?.sendJson(JSONObject().put("type", "voice").put("voice", voice))
  }

  /** Moves the open call to one session (`<projectId>:<sessionId>`) or, with null, to all sessions. */
  fun setFocus(session: String?) {
    current("conversation")?.sendJson(JSONObject().put("type", "focus").put("session", session ?: JSONObject.NULL))
  }

  /** The voice screen's memory card: `continueMemory` or `forgetMemory`, frames without a payload. */
  fun sendControl(type: String) {
    if (type != "continueMemory" && type != "forgetMemory") return
    current("conversation")?.sendJson(JSONObject().put("type", type))
  }

  /** Conversation: hang up. Dictation: stop listening and wait for the final text. */
  fun end(mode: String) {
    current(mode)?.end()
  }

  /** Dictation only: drop it without a final text. */
  fun cancel(mode: String) {
    current(mode)?.dispose("cancelled")
  }

  /** What JavaScript needs after a reload: the conversation still running, if any. */
  fun status(): Map<String, Any?>? = current("conversation")?.snapshot()

  internal fun finished(session: Session) {
    synchronized(lock) {
      if (conversation === session) conversation = null
      if (dictation === session) dictation = null
    }
  }

  internal fun emit(event: Map<String, Any?>) {
    try {
      emitter?.invoke(event)
    } catch (error: Exception) {
      Log.w(TAG, "event dropped: ${error.message}")
    }
  }

  /**
   * Debuggable builds only: `adb shell am broadcast -a io.ghostex.debug.VOICE_FEED --es path <wav>`
   * plays a 16-bit mono 24 kHz WAV into the microphone path, so the voice agent and dictation can
   * be tested on an emulator with nobody speaking. Not part of the product or Ghostex Help.
   */
  private fun installDebugFeed(context: Context) {
    if (debugReceiver != null || (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(receiverContext: Context?, intent: Intent?) {
        val path = intent?.getStringExtra("path") ?: return
        val error = GhostexVoiceAudio.queueDebugWav(path)
        Log.i(TAG, if (error == null) "debug feed queued $path" else "debug feed refused: $error")
      }
    }
    val filter = IntentFilter(DEBUG_FEED_ACTION)
    if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    else context.registerReceiver(receiver, filter)
    debugReceiver = receiver
  }

  /** One conversation or dictation and its socket, microphone and speaker. */
  internal class Session(private val context: Context, options: Options) {
    val id: String = "voice-${SystemClock.elapsedRealtime()}"
    private val mode = options.mode
    private val conversationMode = mode != "dictation"
    private val title = options.title
    private val provider = options.provider
    private val language = options.language
    /** The session the call was started about; sent only on the first open (a reattach keeps gxserver's). */
    private val startFocus = options.focus
    /** The title of the session the call is about now (`ready.focus` / `focus` frames), for the notification. */
    @Volatile private var focusTitle: String? = null
    @Volatile private var localPort = options.localPort
    @Volatile private var authToken = options.authToken

    @Volatile private var socket: WebSocket? = null
    @Volatile private var generation = 0
    @Volatile private var ready = false
    @Volatile private var muted = false
    @Volatile private var focusPaused = false
    @Volatile private var speed = 1f
    /** A push-to-talk call (`ready` says so): the microphone streams only while Talk is held. */
    @Volatile private var pushToTalk = false
    @Volatile private var talking = false
    @Volatile private var conversationId: String? = null
    @Volatile private var state = "connecting"
    /** The server said `ended` or `done`, or the user hung up: a closed socket is final. */
    @Volatile private var finishing = false
    @Volatile private var disposed = false
    @Volatile private var detachedAt = 0L
    private var attempts = 0
    private var retry: Runnable? = null

    private var capture: GhostexVoiceAudio.Capture? = null
    private var player: GhostexVoiceAudio.Player? = null
    private var audioSession: GhostexVoiceAudio.Session? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    fun snapshot(): Map<String, Any?> = mapOf(
      "id" to id,
      "mode" to mode,
      "conversationId" to conversationId,
      "state" to state,
      "muted" to muted,
      "talking" to talking,
      "title" to title,
      "reattaching" to (detachedAt > 0L),
    )

    fun start() {
      if (conversationMode) {
        audioSession = GhostexVoiceAudio.Session(context) { gained -> onFocus(gained) }.also { it.begin() }
        player = GhostexVoiceAudio.Player().also { it.setSpeed(speed) }
        holdLocks()
        GhostexForegroundService.startVoiceMode(context, title)
      }
      capture = GhostexVoiceAudio.Capture(conversationMode, { chunk -> onMicrophone(chunk) }) { message ->
        status("micError", message)
      }.also { it.start() }
      open()
    }

    private fun onMicrophone(chunk: ByteArray) {
      val live = socket ?: return
      // Dictation may stream before `ready` (gxserver buffers it); a conversation starts at `ready`.
      // A hold unmutes a muted Regular call; a push-to-talk call listens only while held.
      if (conversationMode && (!ready || (muted && !talking) || focusPaused || (pushToTalk && !talking))) return
      live.send(chunk.toByteString())
    }

    private fun onFocus(gained: Boolean) {
      if (disposed) return
      focusPaused = !gained
      // A call or a navigation prompt took the speaker: the agent stops talking and stops listening.
      if (!gained && player?.playing() == true) sendJson(JSONObject().put("type", "interrupt"))
      status(if (gained) "focusResumed" else "focusPaused", null)
      refreshNotice()
    }

    /**
     * Mute, told to gxserver too: it drops the microphone's audio and refuses a push-to-talk hold
     * while muted (Mute wins, server/src/voice_agent/talk.rs). Muting mid-hold in a push-to-talk
     * call ends the hold with nothing sent.
     */
    fun setMuted(value: Boolean) {
      muted = value
      if (ready) sendJson(JSONObject().put("type", "mute").put("muted", value))
      if (value && pushToTalk && talking) {
        talking = false
        status("notTalking", null)
      }
      refreshNotice()
      status(if (value) "muted" else "unmuted", null)
    }

    fun sendJson(json: JSONObject) {
      socket?.send(json.toString())
    }

    fun setSpeed(value: Float) {
      speed = value
      player?.setSpeed(value)
      if (ready) sendPlaybackRate()
    }

    /**
     * Push-to-talk: Talk pressed or released. gxserver cuts a reply the agent is speaking when Talk
     * is pressed (it answers `interrupted`, as for Stop) and sends what was said when it is released.
     */
    fun setTalking(value: Boolean) {
      if (!conversationMode || !ready || talking == value) return
      // A push-to-talk call talks while unmuted (Mute wins); a Regular call holds to unmute.
      if (value && muted == pushToTalk) {
        status("talkRefused", if (muted) "muted" else "heard")
        return
      }
      talking = value
      sendJson(JSONObject().put("type", if (value) "talkStart" else "talkEnd"))
      status(if (value) "talking" else "notTalking", null)
      refreshNotice()
    }

    fun cancelTalking() {
      if (!conversationMode || !talking) return
      talking = false
      sendJson(JSONObject().put("type", "talkCancel"))
      status("notTalking", null)
      refreshNotice()
    }

    fun toggleTalking() {
      if (pushToTalk) setTalking(!talking)
    }

    /** gxserver times the reply's end and an interruption's estimate by this rate; it resets on every attach. */
    private fun sendPlaybackRate() {
      sendJson(JSONObject().put("type", "playbackRate").put("rate", speed.toDouble()))
    }

    fun updateLink(port: Int, token: String) {
      worker.post {
        if (disposed || finishing) return@post
        localPort = port
        authToken = token
        if (detachedAt > 0L) {
          retry?.let { worker.removeCallbacks(it) }
          retry = null
          open()
        }
      }
    }

    fun end() {
      if (disposed) return
      finishing = true
      if (conversationMode) {
        sendJson(JSONObject().put("type", "end"))
        capture?.stop()
        player?.cut(null)
      } else {
        capture?.stop()
        sendJson(JSONObject().put("type", "end"))
      }
      // gxserver answers `ended` / `done` and closes; a socket that is already gone ends it here.
      if (socket == null || detachedAt > 0L) dispose("user")
      else worker.postDelayed({ if (!disposed) dispose("user") }, 5_000)
    }

    private fun open() {
      if (disposed) return
      val gen = ++generation
      socket?.cancel()
      val query = StringBuilder("protocolVersion=$PROTOCOL_VERSION&client=phone&mode=").append(if (conversationMode) "conversation" else "dictation")
      conversationId?.let { query.append("&conversationId=").append(Uri.encode(it)) }
      if (conversationMode) provider?.let { query.append("&provider=").append(Uri.encode(it)) }
      if (conversationMode && conversationId == null) startFocus?.let { query.append("&focus=").append(Uri.encode(it)) }
      if (!conversationMode) language?.let { query.append("&language=").append(Uri.encode(it)) }
      val request = Request.Builder()
        .url("ws://127.0.0.1:$localPort/api/voice?$query")
        .header("Authorization", "Bearer $authToken")
        .header("x-gxserver-protocol-version", PROTOCOL_VERSION.toString())
        .build()
      ready = false
      socket = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          if (gen != generation) return
          status("open", null)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          if (gen != generation) return
          onText(text)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          if (gen != generation || !conversationMode) return
          player?.enqueue(bytes.toByteArray())
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          if (gen == generation) worker.post { lost(gen, null) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          if (gen != generation) return
          val code = response?.code
          worker.post { lost(gen, code) }
        }
      })
    }

    private fun onText(text: String) {
      val frame = try {
        JSONObject(text)
      } catch (_: Exception) {
        return
      }
      when (frame.optString("type")) {
        "ready" -> {
          if (frame.optBoolean("resumed")) Log.i(TAG, "conversation reattached after ${SystemClock.elapsedRealtime() - detachedAt}ms")
          ready = true
          frame.optString("conversationId").takeIf { it.isNotEmpty() }?.let { conversationId = it }
          detachedAt = 0L
          attempts = 0
          if (conversationMode) {
            focusTitle = focusTitleOf(frame.opt("focus"))
            pushToTalk = frame.optString("callMode") == "pushToTalk"
            talking = false
            status("notTalking", null)
            // gxserver starts every client unmuted; a reattach carries this phone's Mute over.
            if (muted) sendJson(JSONObject().put("type", "mute").put("muted", true))
            sendPlaybackRate()
            refreshNotice()
          }
        }
        "state" -> {
          state = frame.optString("state", state)
          refreshNotice()
        }
        "focus" -> if (conversationMode) {
          focusTitle = focusTitleOf(frame.opt("focus"))
          refreshNotice()
        }
        "audioStart" -> player?.beginItem(frame.optString("itemId"))
        "interrupted" -> {
          val itemId = frame.optString("itemId").takeIf { it.isNotEmpty() }
          val played = player?.cut(itemId) ?: 0L
          Log.i(TAG, "agent reply $itemId cut after ${played}ms of playback")
          if (itemId != null) sendJson(JSONObject().put("type", "playback").put("itemId", itemId).put("playedMs", played))
        }
        "ended", "done" -> finishing = true
      }
      emit(mapOf("sessionId" to id, "mode" to mode, "kind" to "frame", "json" to text))
    }

    /** The socket closed or failed. Final after `ended` / `done`; otherwise a conversation reattaches. */
    private fun lost(gen: Int, httpCode: Int?) {
      if (gen != generation || disposed) return
      socket = null
      ready = false
      if (finishing) {
        dispose("closed")
        return
      }
      if (httpCode == 401 || httpCode == 426) {
        // A refused token: gxserver issued a new one. JavaScript asks for it and calls updateLink.
        status("linkNeeded", if (httpCode == 401) "unauthorized" else "protocolMismatch")
      }
      val reattachable = conversationMode && conversationId != null
      if (!reattachable) {
        status("failed", if (httpCode != null) "HTTP $httpCode" else null)
        dispose("failed")
        return
      }
      val now = SystemClock.elapsedRealtime()
      if (detachedAt == 0L) {
        Log.i(TAG, "conversation socket lost${if (httpCode != null) " (HTTP $httpCode)" else ""}; reattaching")
        detachedAt = now
        player?.cut(null)
        refreshNotice()
      }
      if (now - detachedAt > REATTACH_WINDOW_MS) {
        status("lost", null)
        dispose("lost")
        return
      }
      status("reattaching", null)
      status("linkNeeded", null)
      val delay = REATTACH_DELAYS_MS[minOf(attempts, REATTACH_DELAYS_MS.size - 1)]
      attempts += 1
      val next = Runnable {
        retry = null
        if (!disposed && !finishing && socket == null) open()
      }
      retry = next
      worker.postDelayed(next, delay)
    }

    private fun status(status: String, message: String?) {
      emit(mapOf("sessionId" to id, "mode" to mode, "kind" to "status", "status" to status, "message" to message))
    }

    /** A focus object's session title, or null for all sessions (or an older gxserver's missing key). */
    private fun focusTitleOf(value: Any?): String? =
      (value as? JSONObject)?.optString("title")?.takeIf { it.isNotBlank() }

    private fun refreshNotice() {
      if (!conversationMode || disposed) return
      // A call about one session names it ("Listening · About Voice mode"); else the computer.
      val title = focusTitle?.let { "About $it" } ?: this.title
      val line = when {
        detachedAt > 0L -> "Reconnecting to $title…"
        focusPaused -> "Paused while another app uses audio"
        muted && !talking -> "Microphone muted · $title"
        talking -> "Listening · $title"
        state == "speaking" -> "Speaking · $title"
        state == "thinking" || state == "toolRunning" -> "Thinking · $title"
        pushToTalk -> "Push-to-talk · $title"
        else -> "Listening · $title"
      }
      GhostexForegroundService.updateVoiceMode(line, muted, pushToTalk, talking)
    }

    @Suppress("DEPRECATION")
    private fun holdLocks() {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ghostex:voice").also { it.acquire(65 * 60_000L) }
      val wifi = context.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val wifiMode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
      wifiLock = wifi.createWifiLock(wifiMode, "ghostex:voice").also { it.acquire() }
    }

    /** Releases everything. Idempotent. */
    @Synchronized
    fun dispose(reason: String) {
      if (disposed) return
      disposed = true
      retry?.let { worker.removeCallbacks(it) }
      retry = null
      generation += 1
      socket?.let { live ->
        if (reason == "cancelled" && !conversationMode) live.send(JSONObject().put("type", "cancel").toString())
        live.close(1000, null)
      }
      socket = null
      capture?.stop()
      capture = null
      player?.release()
      player = null
      audioSession?.end()
      audioSession = null
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = null
      wifiLock?.let { if (it.isHeld) it.release() }
      wifiLock = null
      if (conversationMode) GhostexForegroundService.stopVoiceMode()
      finished(this)
      emit(mapOf("sessionId" to id, "mode" to mode, "kind" to "status", "status" to "closed", "message" to reason))
    }
  }
}
