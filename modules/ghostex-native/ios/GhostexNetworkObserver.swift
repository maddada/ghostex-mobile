import Foundation
import Network

/// Calls `onChange` when the phone's network path changes while it has one (Wi-Fi to cellular, a
/// network coming back), never for the first reading. The iOS side of Android's
/// `GhostexNetworkObserver.kt`: JS checks every connection then (`src/app/lifecycle.ts`).
///
/// CDXC:RemoteMachines 2026-11-07 WHY: iOS sent no network change at all, so an iPhone that left Wi-Fi
/// kept a stalled Easy Connect tunnel until a request timed out, 10 to 25 s later (#490).
final class GhostexNetworkObserver {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "dev.ghostex.network-observer")
    /// The last path's signature; touched on `queue` only.
    private var last: String?

    init(onChange: @escaping () -> Void) {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let signature = Self.signature(path)
            let previous = self.last
            self.last = signature
            guard let previous, previous != signature, path.status == .satisfied else { return }
            onChange()
        }
        monitor.start(queue: queue)
    }

    func close() {
        monitor.cancel()
    }

    /// What a change is told by: whether the path works, and through which interfaces.
    private static func signature(_ path: NWPath) -> String {
        let status = path.status == .satisfied ? "up" : "down"
        let interfaces = path.availableInterfaces.map { "\($0.type):\($0.name)" }.joined(separator: ",")
        return "\(status)|\(interfaces)"
    }
}
