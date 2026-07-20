package expo.modules.ghostexnative

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.util.Log
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient

/**
 * Bridges Termux TerminalSession callbacks (invoked on the main thread by the session's
 * handler) to module events and the attached view. One instance per terminal entry.
 */
class GhostexTerminalSessionClient(
  private val entry: GhostexTerminalEntry,
  private val module: GhostexNativeModule
) : TerminalSessionClient {

  override fun onTextChanged(changedSession: TerminalSession) {
    entry.attachedView?.onSessionTextChanged()
  }

  override fun onTitleChanged(changedSession: TerminalSession) {
    module.emitTerminalTitle(entry.sessionKey, changedSession.title ?: "")
  }

  override fun onSessionFinished(finishedSession: TerminalSession) {
    module.onTerminalFinished(entry)
  }

  override fun onCopyTextToClipboard(session: TerminalSession, text: String?) {
    if (text.isNullOrEmpty()) return
    val clipboard = module.safeContext
      ?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
      ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText("Ghostex terminal", text))
  }

  override fun onPasteTextFromClipboard(session: TerminalSession?) {
    val clipboard = module.safeContext
      ?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
      ?: return
    val item = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0) ?: return
    val text = item.coerceToText(module.safeContext).toString()
    if (text.isEmpty()) return
    session?.emulator?.paste(text)
  }

  override fun onBell(session: TerminalSession) {
    module.emitTerminalBell(entry.sessionKey)
  }

  override fun onColorsChanged(session: TerminalSession) {
    entry.attachedView?.onSessionColorsChanged()
  }

  override fun onTerminalCursorStateChange(state: Boolean) {
    // Cursor blinking is not driven from JS; TerminalView manages its own cursor state.
  }

  override fun setTerminalShellPid(session: TerminalSession, pid: Int) {
    // External (SSH-backed) sessions have no meaningful local pid.
  }

  override fun getTerminalCursorStyle(): Int? = null

  override fun logError(tag: String?, message: String?) {
    Log.e(tag ?: LOG_TAG, message ?: "")
  }

  override fun logWarn(tag: String?, message: String?) {
    Log.w(tag ?: LOG_TAG, message ?: "")
  }

  override fun logInfo(tag: String?, message: String?) {
    Log.i(tag ?: LOG_TAG, message ?: "")
  }

  override fun logDebug(tag: String?, message: String?) {
    Log.d(tag ?: LOG_TAG, message ?: "")
  }

  override fun logVerbose(tag: String?, message: String?) {
    Log.v(tag ?: LOG_TAG, message ?: "")
  }

  override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {
    Log.e(tag ?: LOG_TAG, message ?: "", e)
  }

  override fun logStackTrace(tag: String?, e: Exception?) {
    Log.e(tag ?: LOG_TAG, "", e)
  }

  companion object {
    private const val LOG_TAG = "GhostexTerminal"
  }
}
