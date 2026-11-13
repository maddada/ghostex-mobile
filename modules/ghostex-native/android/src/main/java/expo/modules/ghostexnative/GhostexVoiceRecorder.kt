package expo.modules.ghostexnative

import android.content.Context
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID

/**
 * Dictate's first step on the phone: the microphone written to a WAV file as it is captured
 * (24 kHz mono PCM16, about 2.9 MB a minute, in the app's files folder under
 * `dictation-recordings/`), so nothing said is lost to a refused key, an empty xAI account, a
 * dropped SSH link or the app being closed. JavaScript then uploads the finished file to the
 * computer's gxserver in pieces ([readPiece]) and deletes this copy ([forget]) only once gxserver
 * has all of it; a recording it never confirmed is sent again on the next Dictate ([unsent]).
 *
 * CDXC:VoiceMode 2026-10-20 SEE-ALSO: the user's decision on recording first and transcribing
 * second is in the computer's `server/src/voice_agent/recordings.rs`; the desktop's twin is
 * `apps/desktop/src/app/voice_agent/recorder.rs`; JavaScript drives this from `src/voice/dictation.ts`.
 */
internal object GhostexVoiceRecorder {
  private const val TAG = "GhostexVoiceRecorder"
  /** How often the header's sizes are brought up to date while recording. */
  private const val HEADER_EVERY_MS = 2_000L

  /** 50 ms of 24 kHz audio: one `level` event each (the pill's waveform). */
  private const val LEVEL_WINDOW = 1_200

  /** Set by the module; a microphone failure after the start goes through it. */
  @Volatile var emitter: ((Map<String, Any?>) -> Unit)? = null

  private val lock = Any()
  private var active: Active? = null

  private class Active(val id: String, val file: File, val createdAt: Long, val output: RandomAccessFile) {
    var dataBytes = 0L
    var lastHeader = System.currentTimeMillis()
    var capture: GhostexVoiceAudio.Capture? = null
    /** The level meter: energy and samples of the window so far, and the smoothed level. */
    var levelEnergy = 0.0
    var levelCount = 0
    var level = 0.0
  }

  private fun folder(context: Context): File = File(context.filesDir, "dictation-recordings").apply { mkdirs() }

  /** Starts recording. Answers the recording's id. Replaces (and keeps) one still running. */
  fun start(context: Context): String {
    stop(dismissed = true)
    val createdAt = System.currentTimeMillis()
    val id = "p$createdAt-${UUID.randomUUID().toString().replace("-", "").take(8)}"
    val file = File(folder(context), "$id.wav")
    val output = RandomAccessFile(file, "rw")
    output.setLength(0)
    output.write(header(0))
    writeSidecar(file, createdAt, dismissed = false)
    val recording = Active(id, file, createdAt, output)
    val capture = GhostexVoiceAudio.Capture(false, { chunk -> append(recording, chunk) }) { message ->
      emitter?.invoke(mapOf("sessionId" to id, "mode" to "dictation", "kind" to "status", "status" to "micError", "message" to message))
    }
    recording.capture = capture
    synchronized(lock) { active = recording }
    capture.start()
    return id
  }

  private fun append(recording: Active, chunk: ByteArray) {
    val levels = synchronized(lock) {
      if (active !== recording) return
      try {
        recording.output.write(chunk)
        recording.dataBytes += chunk.size
        val now = System.currentTimeMillis()
        if (now - recording.lastHeader >= HEADER_EVERY_MS) {
          recording.lastHeader = now
          writeSizes(recording.output, recording.dataBytes)
        }
      } catch (error: Exception) {
        Log.w(TAG, "recording write failed: ${error.message}")
      }
      meter(recording, chunk)
    }
    for (level in levels) {
      emitter?.invoke(mapOf("sessionId" to recording.id, "mode" to "dictation", "kind" to "level", "level" to level))
    }
  }

  /**
   * The levels `chunk` completes, 0 to 1: each 50 ms window's RMS × 4, rising fast (75 ms) and
   * falling slower (200 ms), as the desktop's meter (`level_meter.rs`) and the JavaScript file
   * reader (`src/voice/dictationLevel.ts`) make them.
   *
   * CDXC:Dictate 2026-11-13 DECISION: User (Q2920): "do both. We take out the JS one when native becomes live in the app." This sends the pill's level from the recorder itself; JavaScript uses it as soon as it arrives and reads the file only on builds without it.
   */
  private fun meter(recording: Active, chunk: ByteArray): List<Double> {
    val levels = ArrayList<Double>(2)
    var index = 0
    while (index + 1 < chunk.size) {
      val sample = ((chunk[index].toInt() and 0xFF) or (chunk[index + 1].toInt() shl 8)).toShort()
      val value = sample / 32_768.0
      recording.levelEnergy += value * value
      recording.levelCount += 1
      index += 2
      if (recording.levelCount < LEVEL_WINDOW) continue
      val target = minOf(1.0, Math.sqrt(recording.levelEnergy / recording.levelCount) * 4)
      val timeConstant = if (target > recording.level) 0.075 else 0.2
      val decay = Math.exp(-(recording.levelCount / 24_000.0) / timeConstant)
      recording.level = target + (recording.level - target) * decay
      levels.add(recording.level)
      recording.levelEnergy = 0.0
      recording.levelCount = 0
    }
    return levels
  }

  /** Stops recording and closes the file. Answers the finished recording, or null if none ran. */
  fun stop(dismissed: Boolean): Map<String, Any?>? {
    val recording = synchronized(lock) { active.also { active = null } } ?: return null
    recording.capture?.stop()
    try {
      writeSizes(recording.output, recording.dataBytes)
      recording.output.close()
    } catch (error: Exception) {
      Log.w(TAG, "recording close failed: ${error.message}")
    }
    if (dismissed) writeSidecar(recording.file, recording.createdAt, dismissed = true)
    return describe(recording.file, recording.id, recording.createdAt, recording.dataBytes, dismissed)
  }

  /** Recordings gxserver never confirmed, oldest first (not the one being made). */
  fun unsent(context: Context): List<Map<String, Any?>> {
    val recording = synchronized(lock) { active?.id }
    return folder(context).listFiles { file -> file.name.endsWith(".wav") }.orEmpty()
      .filter { it.nameWithoutExtension != recording }
      .mapNotNull { file ->
        val length = file.length()
        if (length <= 44) {
          forgetFile(file)
          return@mapNotNull null
        }
        val sidecar = try {
          JSONObject(sidecarFile(file).readText())
        } catch (_: Exception) {
          JSONObject()
        }
        describe(file, file.nameWithoutExtension, sidecar.optLong("createdAt", file.lastModified()), length - 44, sidecar.optBoolean("dismissed", true))
      }
      .sortedBy { it["createdAt"] as Long }
  }

  /** `length` bytes of the file from `offset`, as base64 (empty at the end). */
  fun readPiece(path: String, offset: Long, length: Int): String {
    RandomAccessFile(File(path), "r").use { file ->
      if (offset >= file.length()) return ""
      val bytes = ByteArray(minOf(length.toLong(), file.length() - offset).toInt())
      file.seek(offset)
      file.readFully(bytes)
      return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
  }

  /** Marks a finished recording dismissed (the reader cancelled before gxserver had it). */
  fun dismiss(path: String) {
    val file = File(path)
    if (!file.exists()) return
    val createdAt = try {
      JSONObject(sidecarFile(file).readText()).optLong("createdAt", file.lastModified())
    } catch (_: Exception) {
      file.lastModified()
    }
    writeSidecar(file, createdAt, dismissed = true)
  }

  /** gxserver has it: this copy goes. */
  fun forget(path: String) {
    forgetFile(File(path))
  }

  private fun describe(file: File, id: String, createdAt: Long, dataBytes: Long, dismissed: Boolean): Map<String, Any?> = mapOf(
    "id" to id,
    "path" to file.absolutePath,
    "createdAt" to createdAt,
    "durationMs" to dataBytes / GhostexVoiceAudio.BYTES_PER_MS,
    "bytes" to file.length(),
    "dismissed" to dismissed,
  )

  private fun sidecarFile(file: File) = File(file.parentFile, "${file.nameWithoutExtension}.json")

  private fun writeSidecar(file: File, createdAt: Long, dismissed: Boolean) {
    try {
      sidecarFile(file).writeText(JSONObject().put("createdAt", createdAt).put("dismissed", dismissed).toString())
    } catch (error: Exception) {
      Log.w(TAG, "sidecar write failed: ${error.message}")
    }
  }

  private fun forgetFile(file: File) {
    file.delete()
    sidecarFile(file).delete()
  }

  private fun writeSizes(output: RandomAccessFile, dataBytes: Long) {
    val position = output.filePointer
    val data = minOf(dataBytes, 0xFFFF_FFDBL).toInt()
    output.seek(4)
    output.write(littleEndian(data + 36))
    output.seek(40)
    output.write(littleEndian(data))
    output.seek(position)
    output.fd.sync()
  }

  private fun littleEndian(value: Int) = byteArrayOf(value.toByte(), (value shr 8).toByte(), (value shr 16).toByte(), (value shr 24).toByte())

  private fun littleEndianShort(value: Int) = byteArrayOf(value.toByte(), (value shr 8).toByte())

  private fun header(dataBytes: Int): ByteArray {
    val rate = GhostexVoiceAudio.SAMPLE_RATE
    return "RIFF".toByteArray() + littleEndian(36 + dataBytes) + "WAVE".toByteArray() +
      "fmt ".toByteArray() + littleEndian(16) + littleEndianShort(1) + littleEndianShort(1) +
      littleEndian(rate) + littleEndian(rate * 2) + littleEndianShort(2) + littleEndianShort(16) +
      "data".toByteArray() + littleEndian(dataBytes)
  }
}
