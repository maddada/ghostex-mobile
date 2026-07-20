package expo.modules.ghostexnative

import android.view.KeyEvent
import com.termux.terminal.KeyHandler
import com.termux.terminal.TerminalSession
import java.nio.charset.StandardCharsets

/**
 * Maps the TS `TerminalKey` names (+ ctrl/alt/shift modifiers) onto the byte sequences the
 * PTY expects. Named keys reuse Termux's KeyHandler so application cursor/keypad modes and
 * xterm modifier encodings stay correct; plain single characters follow the same control/alt
 * transformation TerminalView.inputCodePoint applies for soft-keyboard input.
 * The `cmd` modifier has no terminal meaning on Android and is ignored.
 */
object GhostexKeyMapper {

  private val NAMED_KEYCODES: Map<String, Int> = mapOf(
    "escape" to KeyEvent.KEYCODE_ESCAPE,
    "tab" to KeyEvent.KEYCODE_TAB,
    "enter" to KeyEvent.KEYCODE_ENTER,
    "backspace" to KeyEvent.KEYCODE_DEL,
    "delete" to KeyEvent.KEYCODE_FORWARD_DEL,
    "insert" to KeyEvent.KEYCODE_INSERT,
    "home" to KeyEvent.KEYCODE_MOVE_HOME,
    "end" to KeyEvent.KEYCODE_MOVE_END,
    "pageUp" to KeyEvent.KEYCODE_PAGE_UP,
    "pageDown" to KeyEvent.KEYCODE_PAGE_DOWN,
    "up" to KeyEvent.KEYCODE_DPAD_UP,
    "down" to KeyEvent.KEYCODE_DPAD_DOWN,
    "left" to KeyEvent.KEYCODE_DPAD_LEFT,
    "right" to KeyEvent.KEYCODE_DPAD_RIGHT,
    "f1" to KeyEvent.KEYCODE_F1,
    "f2" to KeyEvent.KEYCODE_F2,
    "f3" to KeyEvent.KEYCODE_F3,
    "f4" to KeyEvent.KEYCODE_F4,
    "f5" to KeyEvent.KEYCODE_F5,
    "f6" to KeyEvent.KEYCODE_F6,
    "f7" to KeyEvent.KEYCODE_F7,
    "f8" to KeyEvent.KEYCODE_F8,
    "f9" to KeyEvent.KEYCODE_F9,
    "f10" to KeyEvent.KEYCODE_F10,
    "f11" to KeyEvent.KEYCODE_F11,
    "f12" to KeyEvent.KEYCODE_F12
  )

  /** Write [key] with modifiers into [session]. Returns false for unmappable input. */
  fun writeKey(
    session: TerminalSession,
    key: String,
    ctrl: Boolean,
    alt: Boolean,
    shift: Boolean
  ): Boolean {
    val emulator = session.emulator
    val cursorApp = emulator?.isCursorKeysApplicationMode ?: false
    val keypadApp = emulator?.isKeypadApplicationMode ?: false

    val keyCode = NAMED_KEYCODES[key]
    if (keyCode != null) {
      var keyMod = 0
      if (ctrl) keyMod = keyMod or KeyHandler.KEYMOD_CTRL
      if (alt) keyMod = keyMod or KeyHandler.KEYMOD_ALT
      if (shift) keyMod = keyMod or KeyHandler.KEYMOD_SHIFT
      val code = KeyHandler.getCode(keyCode, keyMod, cursorApp, keypadApp) ?: return false
      val bytes = code.toByteArray(StandardCharsets.UTF_8)
      session.write(bytes, 0, bytes.size)
      return true
    }

    if (key.isEmpty()) return false
    var codePoint = key.codePointAt(0)
    if (shift) codePoint = Character.toUpperCase(codePoint)
    if (ctrl) codePoint = controlTransformed(codePoint)
    session.writeCodePoint(alt, codePoint)
    return true
  }

  /** Mirror of the ctrl transformation in TerminalView.inputCodePoint. */
  private fun controlTransformed(codePoint: Int): Int = when {
    codePoint >= 'a'.code && codePoint <= 'z'.code -> codePoint - 'a'.code + 1
    codePoint >= 'A'.code && codePoint <= 'Z'.code -> codePoint - 'A'.code + 1
    codePoint == ' '.code || codePoint == '2'.code -> 0
    codePoint == '['.code || codePoint == '3'.code -> 27
    codePoint == '\\'.code || codePoint == '4'.code -> 28
    codePoint == ']'.code || codePoint == '5'.code -> 29
    codePoint == '^'.code || codePoint == '6'.code -> 30
    codePoint == '_'.code || codePoint == '7'.code || codePoint == '/'.code -> 31
    codePoint == '8'.code -> 127
    else -> codePoint
  }
}
