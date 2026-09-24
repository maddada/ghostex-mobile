package expo.modules.gxchatcore

import dev.ghostex.gxchatcore.uniffi.MobileChatCore
import dev.ghostex.gxchatcore.uniffi.coreVersion as rustCoreVersion
import dev.ghostex.gxchatcore.uniffi.retainedSnapshotKey as rustRetainedSnapshotKey
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The Rust chat core (`packages/gx-chat-mobile`, UniFFI) as synchronous JSI functions.
 *
 * Every function is `Function`, not `AsyncFunction`: the phone host calls the core on the JS
 * thread and uses the answer in the same turn. Cores live in a registry keyed by an integer handle
 * that the TypeScript wrapper (`modules/gx-chat-core/src/index.ts`) owns and disposes.
 */
class GxChatCoreModule : Module() {
  private val cores = HashMap<Int, MobileChatCore>()
  private var nextId = 1

  private fun core(id: Int): MobileChatCore = synchronized(cores) {
    cores[id] ?: throw CodedException("GxChatCoreDisposed", "No chat core with handle $id.", null)
  }

  override fun definition() = ModuleDefinition {
    Name("GxChatCore")

    Function("coreVersion") { rustCoreVersion() }

    Function("retainedSnapshotKey") { machineId: String, projectId: String, sessionId: String ->
      rustRetainedSnapshotKey(machineId, projectId, sessionId)
    }

    Function("create") {
      val core = MobileChatCore()
      synchronized(cores) {
        val id = nextId
        nextId += 1
        cores[id] = core
        id
      }
    }

    Function("handle") { id: Int, eventJson: String, contextJson: String ->
      core(id).handle(eventJson, contextJson)
    }

    Function("frameAt") { id: Int, lastRevision: Double, nowMs: Double ->
      core(id).frameAt(lastRevision.toLong(), nowMs)
    }

    Function("nextWakeMs") { id: Int ->
      core(id).nextWakeMs()?.toDouble()
    }

    Function("revision") { id: Int -> core(id).revision().toDouble() }

    Function("forgetSent") { id: Int -> core(id).forgetSent() }

    Function("allocateRequestId") { id: Int -> core(id).allocateRequestId().toDouble() }

    Function("query") { id: Int, name: String, argumentsJson: String ->
      core(id).query(name, argumentsJson)
    }

    Function("dispose") { id: Int ->
      synchronized(cores) { cores.remove(id) }?.destroy()
    }
  }
}
