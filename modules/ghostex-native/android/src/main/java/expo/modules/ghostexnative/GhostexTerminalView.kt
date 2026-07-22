package expo.modules.ghostexnative

import android.content.Context
import android.graphics.Typeface
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import com.termux.terminal.TerminalSession
import com.termux.view.GhostexTerminalViewBridge
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.roundToInt

/**
 * Expo view hosting a Termux TerminalView. Mounting with a `sessionKey` prop attaches the
 * warm registry entry's TerminalSession (rendering + touch + IME); unmounting detaches
 * without killing the entry. Pinch-to-zoom ratchets the per-session font size (±1 step at
 * 1.12/0.89 scale, clamped 4–32) exactly like the iOS terminal, then reports the new size
 * through the module-level `onFontSizeChange` event.
 */
class GhostexTerminalView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), TerminalViewClient {

  private val onSingleTap by EventDispatcher()

  internal val terminalView = TerminalView(context, null)

  private var sessionKey: String? = null
  private var entry: GhostexTerminalEntry? = null
  private var ctrlKeyActive = false
  private var altKeyActive = false
  private var shiftKeyActive = false

  private val module: GhostexNativeModule?
    get() = appContext.registry.getModule<GhostexNativeModule>()

  init {
    terminalView.setTerminalViewClient(this)
    terminalView.setTextSize(dpToPx(GhostexNativeModule.DEFAULT_FONT_SIZE_DP))
    terminalView.setTypeface(Typeface.createFromAsset(context.assets, TERMINAL_FONT_ASSET))
    terminalView.isFocusable = true
    terminalView.isFocusableInTouchMode = true
    addView(terminalView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  // region prop + registry attachment

  fun setSessionKey(key: String?) {
    if (key == sessionKey) return
    clearKeyModifiers()
    detachFromEntry()
    sessionKey = key
    if (key == null) return
    val registry = module?.terminalRegistry ?: return
    val existing = registry.get(key)
    if (existing != null) {
      attachEntry(existing)
    } else {
      registry.awaitEntry(key, this)
    }
  }

  /** Called on the main thread by the registry when the entry appears after the view mounted. */
  internal fun onEntryAvailable(candidate: GhostexTerminalEntry) {
    if (candidate.sessionKey != sessionKey || entry === candidate) return
    attachEntry(candidate)
  }

  private fun attachEntry(candidate: GhostexTerminalEntry) {
    val session = candidate.session ?: run {
      module?.terminalRegistry?.awaitEntry(candidate.sessionKey, this)
      return
    }
    entry = candidate
    candidate.attachedView = this
    terminalView.setTextSize(dpToPx(candidate.fontSizeDp))
    terminalView.attachSession(session)
    terminalView.invalidate()
  }

  /** Detach without killing the warm entry (view unmount / sessionKey change). */
  internal fun detachFromEntry() {
    sessionKey?.let { module?.terminalRegistry?.cancelWait(it, this) }
    val current = entry ?: return
    entry = null
    if (current.attachedView === this) current.attachedView = null
    terminalView.attachSession(null)
    terminalView.invalidate()
  }

  // endregion

  // region module-driven view actions

  internal fun applyFontSize(sizeDp: Int) {
    terminalView.setTextSize(dpToPx(sizeDp))
  }

  internal fun scrollTerminalToBottom() {
    GhostexTerminalViewBridge.scrollToBottom(terminalView)
  }

  internal fun onSessionTextChanged() {
    terminalView.onScreenUpdated()
  }

  internal fun onSessionColorsChanged() {
    terminalView.invalidate()
  }

  internal fun setKeyModifiers(ctrl: Boolean, alt: Boolean, shift: Boolean) {
    ctrlKeyActive = ctrl
    altKeyActive = alt
    shiftKeyActive = shift
  }

  internal fun clearKeyModifiers() {
    ctrlKeyActive = false
    altKeyActive = false
    shiftKeyActive = false
  }

  /** focusTerminal(sessionKey): make the terminal first responder and show the IME. */
  internal fun focusTerminal() {
    showSoftKeyboard()
  }

  /** blurTerminal(sessionKey): drop focus and hide the IME. */
  internal fun blurTerminal() {
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    imm?.hideSoftInputFromWindow(terminalView.windowToken, 0)
    terminalView.clearFocus()
  }

  // endregion

  private fun dpToPx(sizeDp: Int): Int =
    (sizeDp * resources.displayMetrics.density).roundToInt().coerceAtLeast(1)

  private fun stepFontSize(delta: Int) {
    val current = entry ?: return
    val next = (current.fontSizeDp + delta)
      .coerceIn(GhostexNativeModule.MIN_FONT_SIZE_DP, GhostexNativeModule.MAX_FONT_SIZE_DP)
    if (next == current.fontSizeDp) return
    current.fontSizeDp = next
    terminalView.setTextSize(dpToPx(next))
    module?.emitFontSizeChange(current.sessionKey, next)
  }

  private fun showSoftKeyboard() {
    terminalView.requestFocus()
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    imm?.showSoftInput(terminalView, 0)
  }

  // region TerminalViewClient

  /**
   * TerminalView multiplies successive scale factors into the value passed here and adopts
   * whatever we return as the new accumulated factor. Returning 1.0 after a step resets the
   * pinch reference, producing the iOS-style ratchet instead of continuous zoom.
   */
  override fun onScale(scale: Float): Float {
    if (scale >= PINCH_STEP_UP_SCALE) {
      stepFontSize(1)
      return 1.0f
    }
    if (scale <= PINCH_STEP_DOWN_SCALE) {
      stepFontSize(-1)
      return 1.0f
    }
    return scale
  }

  override fun onSingleTapUp(e: MotionEvent?) {
    onSingleTap(emptyMap())
    showSoftKeyboard()
  }

  override fun shouldBackButtonBeMappedToEscape(): Boolean = false

  /** Use a real text-class IME so keyboard emoji, clipboard, and composition tools stay available. */
  override fun shouldEnforceCharBasedInput(): Boolean = true

  override fun shouldUseCtrlSpaceWorkaround(): Boolean = false

  override fun isTerminalViewSelected(): Boolean = true

  override fun copyModeChanged(copyMode: Boolean) {
    // Selection mode needs no JS-side coordination in v1.
  }

  override fun onKeyDown(keyCode: Int, e: KeyEvent?, session: TerminalSession?): Boolean = false

  override fun onKeyUp(keyCode: Int, e: KeyEvent?): Boolean = false

  override fun onLongPress(event: MotionEvent?): Boolean = false

  override fun readControlKey(): Boolean = consumeModifier(ctrlKeyActive) { ctrlKeyActive = false }

  override fun readAltKey(): Boolean = consumeModifier(altKeyActive) { altKeyActive = false }

  override fun readShiftKey(): Boolean = consumeModifier(shiftKeyActive) { shiftKeyActive = false }

  override fun readFnKey(): Boolean = false

  override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession?): Boolean = false

  private inline fun consumeModifier(active: Boolean, clear: () -> Unit): Boolean {
    if (!active) return false
    clear()
    sessionKey?.let { module?.emitKeyModifiersConsumed(it) }
    return true
  }

  override fun onEmulatorSet() {
    // Nothing extra: font size and session were applied during attach.
  }

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

  // endregion

  companion object {
    private const val LOG_TAG = "GhostexTerminalView"
    private const val TERMINAL_FONT_ASSET = "JetBrainsMonoNerdFont-Regular.ttf"

    /** Pinch ratchet thresholds from docs/specs/terminal-screen.md §3. */
    private const val PINCH_STEP_UP_SCALE = 1.12f
    private const val PINCH_STEP_DOWN_SCALE = 0.89f
  }
}
