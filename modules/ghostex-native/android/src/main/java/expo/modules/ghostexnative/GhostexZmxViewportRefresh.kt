package expo.modules.ghostexnative

/**
 * Post-attach ZMX viewport refresh, ported verbatim from the Ghostex Termux
 * fork's GhostexZmxViewportRefresh (android/app). Attaching to a zmx-backed
 * session from the phone must repaint/reflow the remote terminal to the phone
 * viewport: after the attached terminal is visible, measured, has an emulator,
 * and has rendered remote output, wait about two seconds, force a size update,
 * then send zmx's private redraw OSC. zmx consumes the OSC locally and
 * requests a display repaint from daemon state, so it stays gated to
 * zmx-backed sessions instead of being a generic terminal fallback.
 *
 * CDXC:Zmx 2026-09-25 WHY: the PageUp/PageDown key nudge the Termux fork sent after the OSC is gone and must not come back. Those keys reached the agent: in Claude's AskUserQuestion dialog PageDown moves the highlight to "Type something", so the chat's answer digit landed there as a custom answer and the question stayed open.
 */
object GhostexZmxViewportRefresh {

  private const val REFRESH_SEQUENCE = "\u001B]1337;ZMX_REFRESH\u0007"
  const val MAX_ATTACH_VISIBLE_ATTEMPTS = 80
  const val ATTACH_VISIBLE_RETRY_DELAY_MS = 250L
  const val POST_ATTACH_REFRESH_DELAY_MS = 2000L

  fun isTerminalViewReadyForRefresh(widthPixels: Int, heightPixels: Int): Boolean =
    widthPixels > 0 && heightPixels > 0

  fun isAttachVisibleForDelayedRefresh(
    widthPixels: Int,
    heightPixels: Int,
    terminalViewShown: Boolean,
    activityVisible: Boolean,
    emulatorAttached: Boolean,
    hasRenderedRemoteOutput: Boolean
  ): Boolean =
    isTerminalViewReadyForRefresh(widthPixels, heightPixels) &&
      terminalViewShown &&
      activityVisible &&
      emulatorAttached &&
      hasRenderedRemoteOutput

  fun hasVisibleTerminalContent(terminalText: String?): Boolean {
    if (terminalText == null) return false
    for (ch in terminalText) {
      if (!Character.isWhitespace(ch)) return true
    }
    return false
  }

  fun sequence(): String = REFRESH_SEQUENCE
}
