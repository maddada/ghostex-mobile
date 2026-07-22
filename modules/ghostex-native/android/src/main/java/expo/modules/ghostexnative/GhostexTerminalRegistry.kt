package expo.modules.ghostexnative

import android.os.Handler
import android.os.Looper
import com.termux.terminal.TerminalSession
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One warm terminal entry: Termux TerminalSession + the SSH shell channel feeding it
 * (owned by the session's ExternalTerminalProcess) + presentation state. Entries survive
 * view unmount; JS enforces the warm-session policy by calling closeTerminal.
 */
class GhostexTerminalEntry(
  val sessionKey: String,
  val machineId: String,
  @Volatile var fontSizeDp: Int,
  /** zmx-backed (`ghostex attach`) sessions get the post-attach viewport refresh. */
  val zmxBacked: Boolean = false
) {
  /** Set on the main thread right after construction in openTerminal. */
  @Volatile
  var session: TerminalSession? = null

  /** The currently attached native view, if any. Touched on the main thread only. */
  @Volatile
  var attachedView: GhostexTerminalView? = null

  /** Guards the one-shot opening promise settlement (open vs failed). */
  val openSettled = AtomicBoolean(false)

  /** Set once a terminal-state terminal event of `closed` or `failed` has been emitted. */
  @Volatile
  var lifecycleEnded = false
}

/**
 * sessionKey → entry map plus a small "view mounted before openTerminal finished" bridge:
 * a GhostexTerminalView whose sessionKey has no entry yet parks itself here and is attached
 * on the main thread as soon as the entry is registered.
 */
class GhostexTerminalRegistry {

  private val entries = ConcurrentHashMap<String, GhostexTerminalEntry>()
  private val waitingViews = ConcurrentHashMap<String, WeakReference<GhostexTerminalView>>()
  private val mainHandler = Handler(Looper.getMainLooper())

  fun get(sessionKey: String): GhostexTerminalEntry? = entries[sessionKey]

  fun keys(): List<String> = entries.keys.toList()

  fun register(entry: GhostexTerminalEntry) {
    entries[entry.sessionKey] = entry
    val waiting = waitingViews.remove(entry.sessionKey)?.get() ?: return
    mainHandler.post { waiting.onEntryAvailable(entry) }
  }

  fun remove(sessionKey: String): GhostexTerminalEntry? = entries.remove(sessionKey)

  fun awaitEntry(sessionKey: String, view: GhostexTerminalView) {
    waitingViews[sessionKey] = WeakReference(view)
    // The entry may have been registered between the caller's lookup and this call.
    entries[sessionKey]?.let { entry ->
      waitingViews.remove(sessionKey)
      mainHandler.post { view.onEntryAvailable(entry) }
    }
  }

  fun cancelWait(sessionKey: String, view: GhostexTerminalView) {
    val waiting = waitingViews[sessionKey]?.get()
    if (waiting == null || waiting === view) waitingViews.remove(sessionKey)
  }
}
