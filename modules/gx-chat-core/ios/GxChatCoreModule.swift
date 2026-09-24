import ExpoModulesCore

/// The Rust chat core (`packages/gx-chat-mobile`, UniFFI) as synchronous JSI functions.
///
/// Every function is `Function`, not `AsyncFunction`: the phone host calls the core on the JS
/// thread and uses the answer in the same turn, exactly like desktop's `nativeChat.take`. Cores are
/// kept in a registry keyed by an integer handle that the TypeScript wrapper
/// (`modules/gx-chat-core/src/index.ts`) owns and disposes.
public class GxChatCoreModule: Module {
  private var cores: [Int: MobileChatCore] = [:]
  private var nextId = 1
  private let lock = NSLock()

  private func core(_ id: Int) throws -> MobileChatCore {
    lock.lock()
    defer { lock.unlock() }
    guard let core = cores[id] else {
      throw Exception(name: "GxChatCoreDisposed", description: "No chat core with handle \(id).")
    }
    return core
  }

  public func definition() -> ModuleDefinition {
    Name("GxChatCore")

    Function("coreVersion") { () -> String in
      coreVersion()
    }

    Function("retainedSnapshotKey") { (machineId: String, projectId: String, sessionId: String) -> String in
      retainedSnapshotKey(machineId: machineId, projectId: projectId, sessionId: sessionId)
    }

    Function("create") { () -> Int in
      let core = MobileChatCore()
      self.lock.lock()
      defer { self.lock.unlock() }
      let id = self.nextId
      self.nextId += 1
      self.cores[id] = core
      return id
    }

    Function("handle") { (id: Int, eventJson: String, contextJson: String) -> String in
      try self.core(id).handle(eventJson: eventJson, contextJson: contextJson)
    }

    Function("frameAt") { (id: Int, lastRevision: Double, nowMs: Double) -> String in
      try self.core(id).frameAt(lastRevision: Int64(lastRevision), nowMs: nowMs)
    }

    Function("nextWakeMs") { (id: Int) -> Double? in
      try self.core(id).nextWakeMs().map { Double($0) }
    }

    Function("revision") { (id: Int) -> Double in
      Double(try self.core(id).revision())
    }

    Function("forgetSent") { (id: Int) -> String in
      try self.core(id).forgetSent()
    }

    Function("allocateRequestId") { (id: Int) -> Double in
      Double(try self.core(id).allocateRequestId())
    }

    Function("query") { (id: Int, name: String, argumentsJson: String) -> String in
      try self.core(id).query(name: name, argumentsJson: argumentsJson)
    }

    Function("dispose") { (id: Int) in
      self.lock.lock()
      defer { self.lock.unlock() }
      self.cores.removeValue(forKey: id)
    }
  }
}
