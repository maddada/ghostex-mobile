package expo.modules.ghostexnative

import android.content.Context
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
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

  private val mainHandler = Handler(Looper.getMainLooper())

  private var sessionKey: String? = null
  private var entry: GhostexTerminalEntry? = null
  private var ctrlKeyActive = false
  private var altKeyActive = false
  private var shiftKeyActive = false
  private var ctrlKeyLocked = false
  private var altKeyLocked = false
  private var shiftKeyLocked = false

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
    refreshZmxViewportOnceAfterSessionSwitch(candidate, session, 1)
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

  internal fun setKeyModifiers(
    ctrl: Boolean,
    alt: Boolean,
    shift: Boolean,
    ctrlLocked: Boolean,
    altLocked: Boolean,
    shiftLocked: Boolean
  ) {
    ctrlKeyActive = ctrl
    altKeyActive = alt
    shiftKeyActive = shift
    ctrlKeyLocked = ctrlLocked
    altKeyLocked = altLocked
    shiftKeyLocked = shiftLocked
  }

  internal fun clearKeyModifiers() {
    ctrlKeyActive = false
    altKeyActive = false
    shiftKeyActive = false
    ctrlKeyLocked = false
    altKeyLocked = false
    shiftKeyLocked = false
  }

  internal fun consumeKeyModifiersForAccessoryKey() {
    val consumedOneShot =
      (ctrlKeyActive && !ctrlKeyLocked) ||
        (altKeyActive && !altKeyLocked) ||
        (shiftKeyActive && !shiftKeyLocked)
    ctrlKeyActive = ctrlKeyLocked
    altKeyActive = altKeyLocked
    shiftKeyActive = shiftKeyLocked
    if (consumedOneShot) sessionKey?.let { module?.emitKeyModifiersConsumed(it) }
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

  // region zmx post-attach viewport refresh (ported from the Termux fork's
  // GhostexAndroidController: retry until the attached terminal is visible and
  // has rendered remote output, wait ~2s, then force a size update and send the
  // private ZMX redraw OSC plus a PageUp/PageDown nudge)

  private fun shouldRefreshAfterSessionSwitch(
    candidate: GhostexTerminalEntry,
    session: TerminalSession
  ): Boolean = candidate.zmxBacked && session.isRunning

  private fun refreshZmxViewportOnceAfterSessionSwitch(
    candidate: GhostexTerminalEntry,
    session: TerminalSession,
    attempt: Int
  ) {
    if (!shouldRefreshAfterSessionSwitch(candidate, session)) return
    mainHandler.postDelayed({
      if (entry !== candidate || !shouldRefreshAfterSessionSwitch(candidate, session)) {
        return@postDelayed
      }
      if (!isZmxAttachVisibleForDelayedRefresh(session)) {
        if (attempt < GhostexZmxViewportRefresh.MAX_ATTACH_VISIBLE_ATTEMPTS) {
          refreshZmxViewportOnceAfterSessionSwitch(candidate, session, attempt + 1)
        }
        return@postDelayed
      }
      sendZmxViewportRefreshAfterVisibleAttach(candidate, session)
    }, GhostexZmxViewportRefresh.ATTACH_VISIBLE_RETRY_DELAY_MS)
  }

  private fun sendZmxViewportRefreshAfterVisibleAttach(
    candidate: GhostexTerminalEntry,
    session: TerminalSession
  ) {
    mainHandler.postDelayed({
      if (entry !== candidate ||
        !shouldRefreshAfterSessionSwitch(candidate, session) ||
        !isZmxAttachVisibleForDelayedRefresh(session)
      ) {
        return@postDelayed
      }
      terminalView.updateSize()
      session.write(GhostexZmxViewportRefresh.sequence())
      sendTerminalPageUpPageDownNudge(session)
    }, GhostexZmxViewportRefresh.POST_ATTACH_REFRESH_DELAY_MS)
  }

  private fun sendTerminalPageUpPageDownNudge(session: TerminalSession) {
    val emulator = session.emulator
    val cursorApplicationMode = emulator != null && emulator.isCursorKeysApplicationMode
    val keypadApplicationMode = emulator != null && emulator.isKeypadApplicationMode
    val pageUp = GhostexZmxViewportRefresh.pageUpSequence(cursorApplicationMode, keypadApplicationMode)
    val pageDown = GhostexZmxViewportRefresh.pageDownSequence(cursorApplicationMode, keypadApplicationMode)
    if (pageUp != null) session.write(pageUp)
    if (pageDown != null) session.write(pageDown)
  }

  private fun isZmxAttachVisibleForDelayedRefresh(session: TerminalSession): Boolean {
    val emulator = session.emulator
    val terminalWidth = terminalView.width
    val terminalHeight = terminalView.height
    val terminalViewReady =
      GhostexZmxViewportRefresh.isTerminalViewReadyForRefresh(terminalWidth, terminalHeight)
    return GhostexZmxViewportRefresh.isAttachVisibleForDelayedRefresh(
      terminalWidth,
      terminalHeight,
      terminalView.isShown,
      windowVisibility == View.VISIBLE,
      emulator != null,
      terminalViewReady && hasRenderedTerminalOutput(session)
    )
  }

  private fun hasRenderedTerminalOutput(session: TerminalSession): Boolean {
    val emulator = session.emulator ?: return false
    return GhostexZmxViewportRefresh.hasVisibleTerminalContent(emulator.screen.transcriptText)
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

  /**
   * false → InputType.TYPE_NULL, matching the old Termux-fork app's default
   * (enforce-char-based-input off): the IME sends real key events straight to
   * onKeyDown with correct ctrl handling instead of composing words. Text-class
   * input modes (tried for gesture typing) made Gboard buffer/re-commit
   * composition text, which duplicated typed text and broke ctrl hotkeys.
   */
  override fun shouldEnforceCharBasedInput(): Boolean = false

  override fun shouldUseCtrlSpaceWorkaround(): Boolean = false

  override fun isTerminalViewSelected(): Boolean = true

  override fun copyModeChanged(copyMode: Boolean) {
    // Selection mode needs no JS-side coordination in v1.
  }

  override fun onKeyDown(keyCode: Int, e: KeyEvent?, session: TerminalSession?): Boolean = false

  override fun onKeyUp(keyCode: Int, e: KeyEvent?): Boolean = false

  override fun onLongPress(event: MotionEvent?): Boolean = false

  override fun readControlKey(): Boolean =
    consumeModifier(ctrlKeyActive, ctrlKeyLocked) { ctrlKeyActive = false }

  override fun readAltKey(): Boolean =
    consumeModifier(altKeyActive, altKeyLocked) { altKeyActive = false }

  override fun readShiftKey(): Boolean =
    consumeModifier(shiftKeyActive, shiftKeyLocked) { shiftKeyActive = false }

  override fun readFnKey(): Boolean = false

  override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession?): Boolean = false

  private inline fun consumeModifier(active: Boolean, locked: Boolean, clear: () -> Unit): Boolean {
    if (!active) return false
    if (!locked) {
      clear()
      sessionKey?.let { module?.emitKeyModifiersConsumed(it) }
    }
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
