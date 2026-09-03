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

  /**
   * Grid pinned by setTerminalGrid (a hidden zmx client resting wide); null while the
   * attached view sizes the session from its own layout. Main thread only.
   */
  @Volatile
  var explicitGrid: TerminalGrid? = null

  /** Cell metrics of the last view-driven resize, reused for explicit grids with no view attached. */
  @Volatile
  var cellWidthPx: Int = 12

  @Volatile
  var cellHeightPx: Int = 24
}

/** Terminal grid in cells. */
data class TerminalGrid(val columns: Int, val rows: Int)

/**
 * sessionKey → entry map plus the mounted-view index that keeps the two in sync.
 *
 * A GhostexTerminalView stays registered here for its whole mounted life, not just
 * while it is waiting for a first entry, so [register] can hand it EVERY entry that
 * ever appears under its session key. That matters for reconnect: the entry a view
 * is showing dies (process exited / channel dropped), openTerminal builds a brand
 * new entry under the same key, and the still-mounted view has to be moved onto it.
 * When the index only held not-yet-attached views, that second entry reached nobody
 * and the view kept rendering the dead terminal until the screen was remounted.
 */
class GhostexTerminalRegistry {

  private val entries = ConcurrentHashMap<String, GhostexTerminalEntry>()
  private val mountedViews = ConcurrentHashMap<String, WeakReference<GhostexTerminalView>>()
  private val mainHandler = Handler(Looper.getMainLooper())

  fun get(sessionKey: String): GhostexTerminalEntry? = entries[sessionKey]

  fun keys(): List<String> = entries.keys.toList()

  fun register(entry: GhostexTerminalEntry) {
    entries[entry.sessionKey] = entry
    val mounted = mountedViews[entry.sessionKey]?.get() ?: return
    mainHandler.post { mounted.onEntryAvailable(entry) }
  }

  fun remove(sessionKey: String): GhostexTerminalEntry? = entries.remove(sessionKey)

  /** Called when a view takes a session key; it stays tracked until it releases the key. */
  fun trackView(sessionKey: String, view: GhostexTerminalView) {
    mountedViews[sessionKey] = WeakReference(view)
    // The entry may have been registered between the caller's lookup and this call.
    entries[sessionKey]?.let { entry -> mainHandler.post { view.onEntryAvailable(entry) } }
  }

  /** Called when a view unmounts or switches to another session key. */
  fun untrackView(sessionKey: String, view: GhostexTerminalView) {
    val mounted = mountedViews[sessionKey]?.get()
    if (mounted == null || mounted === view) mountedViews.remove(sessionKey)
  }
}
