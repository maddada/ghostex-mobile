package expo.modules.ghostexnative

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * The microphone, the speaker and the audio session of a voice conversation or dictation.
 *
 * Everything is 24 kHz mono PCM16, the format gxserver's `/api/voice` speaks in both directions
 * (docs/2026-10-20/voice-mode/voice-agent-client-contract.md, section 2), so nothing is resampled.
 *
 * CDXC:VoiceMode 2026-10-20 WHY: The provider's voice activity detection interrupts the agent
 * whenever it hears speech, so a speaker that leaks into the microphone makes the agent cut itself
 * off. A conversation therefore runs as a call: `MODE_IN_COMMUNICATION`, the `VOICE_COMMUNICATION`
 * microphone with `AcousticEchoCanceler`, and playback with `USAGE_VOICE_COMMUNICATION`, which is the
 * pairing Android's echo canceller takes its reference from. The same mode routes the microphone and
 * the speaker through a Bluetooth headset or a car's hands-free link when one is connected.
 * Dictation never plays anything, so it records with the plain `VOICE_RECOGNITION` source instead.
 * SEE-ALSO: GhostexVoice.kt (the socket), GhostexForegroundService.kt (the "Voice mode on" service).
 */
internal object GhostexVoiceAudio {
  const val SAMPLE_RATE = 24_000
  /** 40 ms of PCM16 mono at 24 kHz: what the CLI sends per frame (the contract allows 20 to 100 ms). */
  const val CHUNK_BYTES = 1_920
  const val BYTES_PER_MS = 48

  /** A file path from what JavaScript passes for a bundled file (expo-asset's `file://` URI, or a plain path); null otherwise. */
  fun localFilePath(uri: String): String? {
    if (uri.startsWith("/")) return uri
    val parsed = Uri.parse(uri)
    return parsed.path?.takeIf { parsed.scheme == "file" && it.isNotEmpty() && it != "/" }
  }

  private const val TAG = "GhostexVoice"

  /**
   * Developer-only microphone stand-in: queued WAV audio replaces what the microphone hears, chunk
   * for chunk, so the timing stays the microphone's. Filled by [queueDebugWav] (an `adb shell am
   * broadcast` on debuggable builds, see GhostexVoice.kt). Never surfaced to users.
   */
  private val debugFeed = ConcurrentLinkedQueue<ByteArray>()

  /** Queues a 16-bit mono 24 kHz WAV for the microphone path. Answers a short error, or null. */
  fun queueDebugWav(path: String): String? {
    val bytes = try {
      File(path).readBytes()
    } catch (error: Exception) {
      return "Could not read $path: ${error.message}"
    }
    if (bytes.size < 44 || String(bytes, 0, 4) != "RIFF" || String(bytes, 8, 4) != "WAVE") return "$path is not a WAV file."
    var offset = 12
    var channels = 0
    var rate = 0
    var bits = 0
    while (offset + 8 <= bytes.size) {
      val id = String(bytes, offset, 4)
      val size = littleEndianInt(bytes, offset + 4)
      val body = offset + 8
      if (id == "fmt ") {
        channels = littleEndianShort(bytes, body + 2)
        rate = littleEndianInt(bytes, body + 4)
        bits = littleEndianShort(bytes, body + 14)
      } else if (id == "data") {
        if (channels != 1 || rate != SAMPLE_RATE || bits != 16) {
          return "$path must be 16-bit mono 24 kHz (it is $bits-bit, $channels channel(s), $rate Hz)."
        }
        val end = minOf(bytes.size, body + size)
        var at = body
        while (at < end) {
          val chunk = ByteArray(CHUNK_BYTES)
          System.arraycopy(bytes, at, chunk, 0, minOf(CHUNK_BYTES, end - at))
          debugFeed.add(chunk)
          at += CHUNK_BYTES
        }
        return null
      }
      offset = body + size + (size and 1)
    }
    return "$path has no audio data."
  }

  private fun littleEndianInt(bytes: ByteArray, at: Int): Int =
    (bytes[at].toInt() and 0xff) or ((bytes[at + 1].toInt() and 0xff) shl 8) or
      ((bytes[at + 2].toInt() and 0xff) shl 16) or ((bytes[at + 3].toInt() and 0xff) shl 24)

  private fun littleEndianShort(bytes: ByteArray, at: Int): Int =
    (bytes[at].toInt() and 0xff) or ((bytes[at + 1].toInt() and 0xff) shl 8)

  /**
   * Reads the microphone on its own thread and hands every 40 ms chunk to [onChunk] (which decides
   * whether it is sent). Echo cancellation and noise suppression are switched on when the device
   * has them.
   */
  class Capture(private val conversation: Boolean, private val onChunk: (ByteArray) -> Unit, private val onError: (String) -> Unit) {
    @Volatile private var running = false
    private var thread: Thread? = null

    @SuppressLint("MissingPermission")
    fun start() {
      if (running) return
      running = true
      thread = Thread({ loop() }, "GhostexVoiceMic").apply {
        isDaemon = true
        start()
      }
    }

    fun stop() {
      running = false
      thread?.interrupt()
      thread = null
    }

    @SuppressLint("MissingPermission")
    private fun loop() {
      val source = if (conversation) MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.VOICE_RECOGNITION
      val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val record = try {
        AudioRecord(source, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum, CHUNK_BYTES * 4))
      } catch (error: Exception) {
        onError("Ghostex could not open the microphone.")
        return
      }
      if (record.state != AudioRecord.STATE_INITIALIZED) {
        record.release()
        onError("Ghostex could not open the microphone.")
        return
      }
      var echo: AcousticEchoCanceler? = null
      var noise: NoiseSuppressor? = null
      if (conversation) {
        if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(record.audioSessionId)?.also { it.enabled = true }
        if (NoiseSuppressor.isAvailable()) noise = NoiseSuppressor.create(record.audioSessionId)?.also { it.enabled = true }
      }
      try {
        record.startRecording()
        val buffer = ByteArray(CHUNK_BYTES)
        while (running) {
          var filled = 0
          while (filled < CHUNK_BYTES && running) {
            val read = record.read(buffer, filled, CHUNK_BYTES - filled)
            if (read <= 0) break
            filled += read
          }
          if (!running) break
          if (filled < CHUNK_BYTES) {
            onError("The microphone stopped.")
            break
          }
          onChunk(debugFeed.poll() ?: buffer.copyOf())
        }
      } catch (error: Exception) {
        Log.w(TAG, "microphone loop ended: ${error.message}")
      } finally {
        try {
          record.stop()
        } catch (_: Exception) {
        }
        echo?.release()
        noise?.release()
        record.release()
      }
    }
  }

  /**
   * Streams the agent's audio to the speaker from a queue on its own thread, so the socket's reader
   * never blocks on the speaker. [cut] drops everything still queued or buffered at once (the
   * contract's `interrupted`) and says how much of that reply was actually heard.
   */
  class Player {
    private val queue = LinkedBlockingQueue<ByteArray>()
    private val generation = AtomicInteger(0)
    @Volatile private var running = true
    private val track: AudioTrack
    private val thread: Thread
    /** Frames handed to the track since it was created or last flushed. */
    @Volatile private var framesWritten = 0L
    /** The head position the current reply started at, or -1 before its first frame. */
    @Volatile private var itemStartFrame = -1L
    @Volatile var itemId: String? = null
      private set

    init {
      val minimum = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      track = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build()
        )
        .setTransferMode(AudioTrack.MODE_STREAM)
        .setBufferSizeInBytes(maxOf(minimum, SAMPLE_RATE * 2 / 5))
        .build()
      track.play()
      thread = Thread({ loop() }, "GhostexVoiceSpeaker").apply {
        isDaemon = true
        start()
      }
    }

    fun beginItem(id: String) {
      itemId = id
      itemStartFrame = -1L
    }

    /** The reply track's audio session: the waiting music plays in the same one ([Music]). */
    val audioSessionId: Int
      get() = track.audioSessionId

    fun enqueue(audio: ByteArray) {
      if (running) queue.add(audio)
    }

    /**
     * Plays the agent's audio [speed] times as fast with its pitch kept (the voice screen's speed
     * buttons, `voiceAgentSpeed`).
     *
     * CDXC:VoiceMode 2026-10-20 WHY: neither provider talks faster than 1.5x and the user's buttons go to 2x, so the speed is the track's playback rate, like the desktop's time stretch. The track's head position still counts the provider's frames, so [cut] keeps reporting how much of the reply's audio was heard, in the provider's time.
     */
    fun setSpeed(speed: Float) {
      try {
        track.playbackParams = PlaybackParams().setSpeed(speed).setPitch(1f)
      } catch (_: IllegalArgumentException) {
      } catch (_: IllegalStateException) {
      }
    }

    /** True while agent audio is queued or still draining from the track. */
    fun playing(): Boolean = queue.isNotEmpty() || headFrame() < framesWritten

    private fun headFrame(): Long = track.playbackHeadPosition.toLong() and 0xffffffffL

    /** Stops the reply at once; answers the milliseconds of `id` the speaker played. */
    @Synchronized
    fun cut(id: String?): Long {
      generation.incrementAndGet()
      queue.clear()
      val played = if (id != null && id == itemId && itemStartFrame >= 0) maxOf(0L, headFrame() - itemStartFrame) else 0L
      try {
        track.pause()
        track.flush()
        track.play()
      } catch (_: IllegalStateException) {
      }
      framesWritten = headFrame()
      itemStartFrame = -1L
      return played * 1000 / SAMPLE_RATE
    }

    fun release() {
      running = false
      generation.incrementAndGet()
      queue.clear()
      thread.interrupt()
      try {
        track.pause()
        track.flush()
        track.release()
      } catch (_: IllegalStateException) {
      }
    }

    private fun loop() {
      while (running) {
        val chunk = try {
          queue.poll(250, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
          null
        } ?: continue
        val written = generation.get()
        synchronized(this) {
          if (written != generation.get() || !running) return@synchronized
          if (itemStartFrame < 0) itemStartFrame = framesWritten
        }
        var offset = 0
        while (offset < chunk.size && running && written == generation.get()) {
          val count = try {
            track.write(chunk, offset, chunk.size - offset)
          } catch (_: IllegalStateException) {
            -1
          }
          if (count <= 0) break
          offset += count
          if (written == generation.get()) framesWritten += count / 2
        }
      }
    }
  }

  /**
   * The phone's audio session for a conversation: the call mode, the route (Bluetooth headset or
   * car first, then a wired or USB headset, then the loudspeaker, never the earpiece: the phone is
   * in a pocket or a holder) and audio focus. Focus is held as a transient gain; losing it (a call,
   * a navigation prompt) pauses the conversation through [onFocus] until it comes back.
   */
  class Session(context: Context, private val onFocus: (Boolean) -> Unit) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val handler = Handler(Looper.getMainLooper())
    private val previousMode = audio.mode
    @Suppress("DEPRECATION")
    private val previousSpeaker = audio.isSpeakerphoneOn
    private var focusRequest: AudioFocusRequest? = null
    private var legacyBluetooth = false
    private val deviceCallback = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = route()
      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = route()
    }

    fun begin() {
      audio.mode = AudioManager.MODE_IN_COMMUNICATION
      route()
      audio.registerAudioDeviceCallback(deviceCallback, handler)
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setWillPauseWhenDucked(true)
        .setOnAudioFocusChangeListener({ change ->
          when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> onFocus(true)
            AudioManager.AUDIOFOCUS_LOSS,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> onFocus(false)
          }
        }, handler)
        .build()
      focusRequest = request
      if (audio.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) onFocus(false)
    }

    @Suppress("DEPRECATION")
    private fun route() {
      if (Build.VERSION.SDK_INT >= 31) {
        val devices = audio.availableCommunicationDevices
        val order = intArrayOf(
          AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
          AudioDeviceInfo.TYPE_BLE_HEADSET,
          AudioDeviceInfo.TYPE_USB_HEADSET,
          AudioDeviceInfo.TYPE_WIRED_HEADSET,
          AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
          AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
        )
        val pick = order.asSequence().mapNotNull { type -> devices.firstOrNull { it.type == type } }.firstOrNull()
        if (pick != null && audio.communicationDevice?.id != pick.id) audio.setCommunicationDevice(pick)
        return
      }
      val outputs = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      val bluetooth = outputs.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
      val wired = outputs.any { it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it.type == AudioDeviceInfo.TYPE_USB_HEADSET }
      if (bluetooth && !legacyBluetooth) {
        audio.startBluetoothSco()
        audio.isBluetoothScoOn = true
        legacyBluetooth = true
      } else if (!bluetooth && legacyBluetooth) {
        audio.stopBluetoothSco()
        audio.isBluetoothScoOn = false
        legacyBluetooth = false
      }
      audio.isSpeakerphoneOn = !bluetooth && !wired
    }

    @Suppress("DEPRECATION")
    fun end() {
      audio.unregisterAudioDeviceCallback(deviceCallback)
      focusRequest?.let { audio.abandonAudioFocusRequest(it) }
      focusRequest = null
      if (Build.VERSION.SDK_INT >= 31) {
        audio.clearCommunicationDevice()
      } else {
        if (legacyBluetooth) {
          audio.stopBluetoothSco()
          audio.isBluetoothScoOn = false
        }
        audio.isSpeakerphoneOn = previousSpeaker
      }
      audio.mode = previousMode
    }
  }

  /**
   * When a call's waiting music plays: the twin of GhostexVoiceAudio.swift's `GhostexWaitingMusicGate`, whose CDXC
   * notes hold the DECISION and the WHY. Once the agent's first reply audio of the call has arrived and the agent has
   * then been thinking or running a tool for [DELAY_MS] without a break, until the agent speaks or listens again, its
   * reply audio arrives, the person talks, the call's audio focus is lost, the link drops, the music is turned off or
   * the call ends; each start waits the whole delay again. The socket's reader, the link's worker and the main thread
   * all call it, so every entry point is synchronized.
   *
   * CDXC:VoiceMode 2026-11-27 WHY: The music played right at the start of a call, before the agent's greeting:
   * gxserver reports `thinking` for every response it asks for, the greeting included. The music is meant for the
   * agent's work, not for the call's setup, so it waits for the agent's first reply audio of the call ([replied]). A
   * rejoin keeps that (the session and its gate stay); a new call has a new gate and starts without it.
   */
  class WaitingMusicGate(
    private val schedule: (Long, () -> Unit) -> Unit,
    private val play: () -> Unit,
    private val stop: (String) -> Unit,
  ) {
    private var enabled = false
    /** The latest `state` frame's value, and whether the agent's reply audio came after it. */
    private var agentState = ""
    private var replying = false
    /** The agent's first reply audio of this call has arrived; never cleared, so a rejoin keeps it. */
    private var replied = false
    private var talking = false
    private var paused = false
    private var linkDown = false
    private var ended = false
    /** The start waiting out its delay; anything that ends the wait clears it, so that timer then does nothing. */
    private var pending: Int? = null
    private var waits = 0
    var playing = false
      private set

    /** The switch, and whether this build has a piece to play. */
    @Synchronized
    fun setEnabled(value: Boolean) {
      enabled = value
      update()
    }

    /** A `state` frame: `thinking` and `toolRunning` wait for the music; anything else stops it. */
    @Synchronized
    fun agentState(value: String) {
      agentState = value
      replying = false
      update()
    }

    /** The agent's reply audio arrived: it speaks, whatever the last `state` frame said. The first one arms the music. */
    @Synchronized
    fun replyAudio() {
      if (replying) return
      replying = true
      replied = true
      update()
    }

    /** Talk is held (push-to-talk, or a muted Regular call held open). */
    @Synchronized
    fun setTalking(value: Boolean) {
      talking = value
      update()
    }

    /** Audio focus went to another app or a phone call. */
    @Synchronized
    fun setPaused(value: Boolean) {
      paused = value
      update()
    }

    /** The socket dropped and the call is joining again: what the agent was doing is unknown until a new `state` frame. */
    @Synchronized
    fun setLinkDown(value: Boolean) {
      linkDown = value
      if (value) {
        agentState = ""
        replying = false
      }
      update()
    }

    @Synchronized
    fun end() {
      ended = true
      update()
    }

    /** Why the music must not play now, or null while the agent thinks or works. */
    private fun blocker(): String? = when {
      ended -> "the call ended"
      !enabled -> "waiting music is off"
      paused -> "the call's audio was taken away"
      linkDown -> "the link to the computer dropped"
      talking -> "you are holding Talk"
      replying -> "the agent's reply audio arrived"
      !replied -> "the agent has not replied yet"
      agentState == "thinking" || agentState == "toolRunning" -> null
      agentState.isEmpty() -> "the agent is not working"
      else -> "the agent is $agentState"
    }

    private fun update() {
      val reason = blocker()
      if (reason != null) {
        pending = null
        if (playing) {
          playing = false
          stop(reason)
        }
        return
      }
      if (playing || pending != null) return
      waits += 1
      val wait = waits
      pending = wait
      schedule(DELAY_MS) { fire(wait) }
    }

    @Synchronized
    private fun fire(wait: Int) {
      if (pending != wait) return
      pending = null
      playing = true
      play()
    }

    companion object {
      const val DELAY_MS = 1_500L
    }
  }

  /**
   * A call's waiting music: the piece decoded once to 16-bit mono PCM and looped on a track of its own with the reply's
   * usage (`USAGE_VOICE_COMMUNICATION`) and in the reply track's audio session, so it takes the call's route and the
   * echo canceller's reference as the reply does. Its own volume; it fades in and out over 0.2 s plus the track's short
   * buffer. The twin of the iOS engine's music node (GhostexVoiceAudio.swift). [Player] is unchanged by it.
   */
  class Music(private val audioSessionId: Int) {
    /** The music thread waits on it: typed as Java's Object for `wait` and `notifyAll`, as React Native does. */
    @Suppress("PLATFORM_CLASS_MAPPED_TO_KOTLIN")
    private val lock: Object = Object()
    @Volatile private var running = true
    // Guarded by `lock`.
    private var path: String? = null
    private var decodedPath: String? = null
    private var pcm: ShortArray? = null
    private var rate = 0
    private var volume = 0.3f
    /** The music should be heard; the thread writes while [active] and fades toward silence once this is false. */
    private var wanted = false
    private var active = false
    private var gain = 0f
    /** The loudest gain since the music last held steady: a fade down takes [FADE_SECONDS] from it, not [volume]'s. */
    private var fadeFrom = 0f
    private var position = 0
    /** Touched by the music thread only. */
    private var track: AudioTrack? = null
    private val thread = Thread({ loop() }, "GhostexVoiceMusic").apply {
      isDaemon = true
      start()
    }

    /**
     * The piece (null: none) and volume this phone set. Another piece replaces one that is playing at once; no piece
     * fades the one that plays out first, and the thread lets its decoded audio go once it is silent ([loop]). 0 is
     * silent at once, also while the loop plays.
     */
    fun configure(path: String?, volume: Float) {
      synchronized(lock) {
        this.volume = volume
        // CDXC:VoiceMode 2026-11-26 WHY: 0 % means silent: a fade toward it from the gain playing would still be heard,
        // also over the agent's reply when its first audio stops the music right after.
        if (volume == 0f) gain = 0f
        if (path != this.path) {
          this.path = path
          if (path == null) {
            wanted = false
          } else {
            gain = 0f
            position = 0
          }
          lock.notifyAll()
        }
      }
    }

    /** The gate's start: fades the music in. False when there is no piece to play. */
    fun start(): Boolean = synchronized(lock) {
      if (path == null) {
        false
      } else {
        wanted = true
        active = true
        lock.notifyAll()
        true
      }
    }

    /** The gate's stop, and the reply's first audio: fades the music out. */
    fun stop() {
      synchronized(lock) { wanted = false }
    }

    fun release() {
      running = false
      synchronized(lock) { lock.notifyAll() }
      thread.interrupt()
    }

    private class Chunk(val samples: ShortArray, val rate: Int, val silent: Boolean)

    private fun loop() {
      try {
        while (running) {
          val toDecode = synchronized(lock) {
            if (path == null && !active && decodedPath != null) {
              // Turned off and faded out: the piece's audio goes, and the thread waits below for a new one.
              decodedPath = null
              pcm = null
              rate = 0
            }
            path?.takeIf { it != decodedPath }
          }
          if (toDecode != null) {
            val decoded = decode(toDecode)
            synchronized(lock) {
              if (path == toDecode) {
                decodedPath = toDecode
                pcm = decoded?.first
                rate = decoded?.second ?: 0
                position = 0
              }
            }
            continue
          }
          val chunk = synchronized(lock) { nextChunk() }
          if (chunk == null) {
            track?.let { quiet ->
              if (quiet.playState == AudioTrack.PLAYSTATE_PLAYING) {
                quiet.pause()
                quiet.flush()
              }
            }
            // Nothing to write until a start or another piece (also with no piece at all, its audio let go above).
            synchronized(lock) { if (running && !active && path == decodedPath) lock.wait(250) }
            continue
          }
          val out = trackFor(chunk.rate)
          if (out.playState != AudioTrack.PLAYSTATE_PLAYING) out.play()
          out.write(chunk.samples, 0, chunk.samples.size)
          if (chunk.silent) synchronized(lock) { if (!wanted && gain == 0f) active = false }
        }
      } catch (_: InterruptedException) {
      } catch (error: IllegalStateException) {
        Log.w(TAG, "waiting music stopped: ${error.message}")
      } finally {
        track?.release()
        track = null
      }
    }

    /** 20 ms of the loop at the gain ramping toward the volume (or silence), or null when nothing should be written. */
    private fun nextChunk(): Chunk? {
      val samples = pcm
      if (!active || samples == null || samples.isEmpty() || rate <= 0) {
        active = false
        return null
      }
      val target = if (wanted) volume else 0f
      // A fade down runs from the loudest gain since the music held steady, so a stop right after the volume was
      // lowered still ends within FADE_SECONDS; a fade up takes FADE_SECONDS to the volume.
      fadeFrom = if (gain == target) gain else maxOf(fadeFrom, gain)
      val step = maxOf(volume, fadeFrom, 0.05f) / (FADE_SECONDS * rate)
      val out = ShortArray(rate / 50)
      for (index in out.indices) {
        gain = if (gain < target) minOf(target, gain + step) else maxOf(target, gain - step)
        out[index] = (samples[position] * gain).toInt().toShort()
        position = if (position + 1 >= samples.size) 0 else position + 1
      }
      return Chunk(out, rate, !wanted && gain == 0f)
    }

    private fun trackFor(sampleRate: Int): AudioTrack {
      track?.let {
        if (it.sampleRate == sampleRate) return it
        it.release()
      }
      val minimum = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
      return AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setSampleRate(sampleRate)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .build()
        )
        .setTransferMode(AudioTrack.MODE_STREAM)
        // A short buffer, so a stop is heard within the fade: about 60 ms.
        .setBufferSizeInBytes(maxOf(minimum, sampleRate * 2 * 6 / 100))
        .setSessionId(audioSessionId)
        .build()
        .also { track = it }
    }

    /**
     * The piece as 16-bit mono PCM and its sample rate, without the AAC encoder's priming and padding frames (the file
     * names both, `encoder-delay` and `encoder-padding`), so the loop point has no gap; null when it cannot be read.
     */
    private fun decode(path: String): Pair<ShortArray, Int>? {
      val extractor = MediaExtractor()
      var codec: MediaCodec? = null
      try {
        extractor.setDataSource(path)
        val index = (0 until extractor.trackCount).firstOrNull {
          extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
        } ?: return null
        extractor.selectTrack(index)
        val format = extractor.getTrackFormat(index)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec = decoder
        decoder.configure(format, null, null, 0)
        decoder.start()
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
        var out = ShortArray(maxOf(sampleRate, (durationUs * sampleRate / 1_000_000L).toInt() + sampleRate))
        var count = 0
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        while (running) {
          if (!inputDone) {
            val input = decoder.dequeueInputBuffer(10_000)
            if (input >= 0) {
              val size = extractor.readSampleData(decoder.getInputBuffer(input)!!, 0)
              if (size < 0) {
                decoder.queueInputBuffer(input, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
              } else {
                decoder.queueInputBuffer(input, 0, size, extractor.sampleTime, 0)
                extractor.advance()
              }
            }
          }
          val output = decoder.dequeueOutputBuffer(info, 10_000)
          if (output == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            channels = decoder.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            sampleRate = decoder.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          } else if (output >= 0) {
            val bytes = decoder.getOutputBuffer(output)!!
            bytes.position(info.offset)
            bytes.limit(info.offset + info.size)
            val shorts = bytes.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val frames = shorts.remaining() / channels
            if (count + frames > out.size) out = out.copyOf(maxOf(out.size * 2, count + frames))
            for (frame in 0 until frames) {
              var sum = 0
              for (channel in 0 until channels) sum += shorts.get(frame * channels + channel)
              out[count++] = (sum / channels).toShort()
            }
            decoder.releaseOutputBuffer(output, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
          }
        }
        val delay = if (format.containsKey("encoder-delay")) format.getInteger("encoder-delay") else 0
        val padding = if (format.containsKey("encoder-padding")) format.getInteger("encoder-padding") else 0
        val end = count - padding
        if (end <= delay) return null
        return out.copyOfRange(delay, end) to sampleRate
      } catch (error: Exception) {
        Log.w(TAG, "waiting music could not be decoded: ${error.message}")
        return null
      } finally {
        try {
          codec?.stop()
        } catch (_: IllegalStateException) {
        }
        codec?.release()
        extractor.release()
      }
    }

    companion object {
      private const val FADE_SECONDS = 0.2f
    }
  }

  /**
   * Settings › Voice's short preview of a waiting music piece, outside any call, at the volume set: the twin of
   * GhostexWaitingMusicPreview (iOS). One at a time: a new one replaces the last, a volume change applies to it, and it
   * fades out by itself after its seconds.
   */
  object WaitingMusicPreview {
    private const val FADE_STEPS = 15
    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var volume = 0f
    private var plays = 0

    @Synchronized
    fun play(path: String, volume: Float, seconds: Double) {
      val next = MediaPlayer()
      try {
        next.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        next.setDataSource(path)
        next.isLooping = true
        next.prepare()
        next.setVolume(volume, volume)
      } catch (error: Exception) {
        next.release()
        throw error
      }
      player?.release()
      player = next
      this.volume = volume
      plays += 1
      val play = plays
      next.start()
      handler.postDelayed({ fadeOut(play, 0) }, (seconds * 1000).toLong())
    }

    @Synchronized
    fun setVolume(value: Float) {
      volume = value
      player?.setVolume(value, value)
    }

    @Synchronized
    fun stop() {
      plays += 1
      player?.release()
      player = null
    }

    @Synchronized
    private fun fadeOut(play: Int, step: Int) {
      val current = player ?: return
      if (play != plays) return
      if (step >= FADE_STEPS) {
        stop()
        return
      }
      val level = volume * (FADE_STEPS - step - 1) / FADE_STEPS
      current.setVolume(level, level)
      handler.postDelayed({ fadeOut(play, step + 1) }, 20)
    }
  }
}
