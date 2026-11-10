import ActivityKit
import ExpoModulesCore

/// Starts, updates and ends the one Ghostex Live Activity for `src/notifications/liveActivity.ts`. The
/// views live in the widget extension (`Extension/`); both sides share `Shared/GhostexActivityAttributes.swift`.
///
/// No call passes an `AlertConfiguration`: the activity updates silently, the notification carries the sound.
///
/// The activity is requested with a push token, and on iOS 17.2 and later the app also takes the push-to-start
/// token, so a computer can update the activity (and start one) through Apple's push service while iOS keeps the
/// app suspended. Each token reaches the app as an `onPushToken` event (`kind` "update" or "start", `token` hex)
/// and stays readable through `pushTokens()`; the module never logs or stores one.
///
/// CDXC:Notifications 2026-11-11 WHY: User: "why does it always say Not current? pls fix both". The app could
/// update the activity only while it ran, so with the phone locked the content went past its stale date within
/// minutes. Live Activity pushes (`apns-push-type: liveactivity`) are the way iOS keeps one current from a server;
/// Expo's push service does not carry them, so the computer side needs Apple's service with the push key.
public final class GhostexLiveActivityModule: Module {
  /// The latest tokens iOS issued, hex: the running activity's update token and the push-to-start token.
  private var latestTokens: [String: String] = [:]
  /// The activities whose token updates are already observed, by activity id.
  private var observed: Set<String> = []
  private var startTokenTask: Task<Void, Never>?
  /// Guards `latestTokens` and `observed`: the async functions and the token streams run on different threads.
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("GhostexLiveActivity")

    Events("onPushToken")

    OnCreate {
      // An activity that outlived the last run keeps its token: observe it again.
      for activity in Self.liveActivities() {
        self.observeTokens(of: activity)
      }
      self.observeStartTokens()
    }

    OnDestroy {
      self.startTokenTask?.cancel()
    }

    // Reads ActivityKit's in-process list; no I/O.
    Function("hasActivity") { () -> Bool in
      !Self.liveActivities().isEmpty
    }

    // The latest tokens by kind ("update", "start"); empty until iOS issued one.
    Function("pushTokens") { () -> [String: String] in
      self.locked { self.latestTokens }
    }

    AsyncFunction("start") { (stateJson: String, staleDateMs: Double) async throws in
      let content = try Self.content(stateJson, staleDateMs)
      if let activity = Self.liveActivities().first {
        await activity.update(content)
        self.observeTokens(of: activity)
        return
      }
      let activity: Activity<GhostexActivityAttributes>
      do {
        activity = try Activity.request(attributes: GhostexActivityAttributes(), content: content, pushType: .token)
      } catch {
        // A build without the push entitlement, or push refused: the activity still runs, updated by the app.
        do {
          activity = try Activity.request(attributes: GhostexActivityAttributes(), content: content, pushType: nil)
        } catch {
          throw LiveActivityRequestException(error.localizedDescription)
        }
      }
      self.observeTokens(of: activity)
    }

    AsyncFunction("update") { (stateJson: String, staleDateMs: Double) async throws in
      let content = try Self.content(stateJson, staleDateMs)
      // One activity per phone: any other one, left from an earlier run, is ended.
      for (index, activity) in Self.liveActivities().enumerated() {
        if index == 0 {
          await activity.update(content)
        } else {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
    }

    AsyncFunction("end") { () async in
      for activity in Activity<GhostexActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      _ = self.locked { self.latestTokens.removeValue(forKey: "update") }
    }
  }

  private func locked<Result>(_ body: () -> Result) -> Result {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  /// iOS 17.2 and later: the token a computer starts an activity with while the app is suspended.
  private func observeStartTokens() {
    guard #available(iOS 17.2, *) else { return }
    startTokenTask = Task { [weak self] in
      for await data in Activity<GhostexActivityAttributes>.pushToStartTokenUpdates {
        self?.publish(kind: "start", token: data)
      }
    }
  }

  private func observeTokens(of activity: Activity<GhostexActivityAttributes>) {
    guard locked({ observed.insert(activity.id).inserted }) else { return }
    if let token = activity.pushToken {
      publish(kind: "update", token: token)
    }
    Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        self?.publish(kind: "update", token: data)
      }
    }
  }

  private func publish(kind: String, token: Data) {
    let hex = token.map { String(format: "%02x", $0) }.joined()
    let changed = locked { () -> Bool in
      guard latestTokens[kind] != hex else { return false }
      latestTokens[kind] = hex
      return true
    }
    guard changed else { return }
    sendEvent("onPushToken", ["kind": kind, "token": hex])
  }

  /// Activities that are on screen: neither ended nor dismissed.
  private static func liveActivities() -> [Activity<GhostexActivityAttributes>] {
    Activity<GhostexActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
  }

  private static func content(_ stateJson: String, _ staleDateMs: Double) throws -> ActivityContent<GhostexActivityContent> {
    let state: GhostexActivityContent
    do {
      state = try JSONDecoder().decode(GhostexActivityContent.self, from: Data(stateJson.utf8))
    } catch {
      throw InvalidLiveActivityStateException(String(describing: error))
    }
    let fitted: GhostexActivityContent
    do {
      fitted = try state.fitted(with: GhostexActivityAttributes())
    } catch {
      throw InvalidLiveActivityStateException(String(describing: error))
    }
    return ActivityContent(state: fitted, staleDate: Date(timeIntervalSince1970: staleDateMs / 1000))
  }
}

final class InvalidLiveActivityStateException: GenericException<String> {
  override var reason: String {
    "The Live Activity content state is not valid: \(param)"
  }
}

final class LiveActivityRequestException: GenericException<String> {
  override var reason: String {
    "iOS did not start the Live Activity: \(param)"
  }
}
