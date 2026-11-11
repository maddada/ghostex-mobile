import ActivityKit
import Foundation

/// The one Ghostex Live Activity. This file is compiled into the app (the Expo
/// module that starts and updates the activity) and into the widget extension (the views); ActivityKit matches
/// the two by this type.
///
/// The content state carries per row the agent, the project, the state, when that state began and the session's
/// identifiers, and no prompt, reply or title text.
/// The app builds it in `src/notifications/contentState.ts`; this side decodes it, fits it into ActivityKit's
/// 4 KB and renders it.
public struct GhostexActivityAttributes: ActivityAttributes {
  public typealias ContentState = GhostexActivityContent

  public init() {}
}

public struct GhostexActivityCounts: Codable, Hashable, Sendable {
  public var working: Int
  public var waiting: Int

  public init(working: Int, waiting: Int) {
    self.working = working
    self.waiting = waiting
  }
}

/// The session a row opens; identifiers only, never a name.
public struct GhostexActivityTarget: Codable, Hashable, Sendable {
  public var machineId: String
  public var sessionId: String

  public init(machineId: String, sessionId: String) {
    self.machineId = machineId
    self.sessionId = sessionId
  }

  /// Unreserved URL characters (RFC 3986); everything else in an id is percent-encoded, so `&`, `#`, `=`, `+`
  /// or `%` inside an id cannot change which session the link names.
  private static let unreserved = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

  /// `ghostex://session?machineId=…&sessionId=…`, parsed by the app's `src/app/deepLinkHandler.ts`. None for a
  /// row of a computer the phone is not paired with (pushed by the computer it is connected to, with no id for
  /// it): a tap opens the app.
  public var deepLink: URL? {
    guard
      !machineId.isEmpty, !sessionId.isEmpty,
      let machine = machineId.addingPercentEncoding(withAllowedCharacters: Self.unreserved),
      let session = sessionId.addingPercentEncoding(withAllowedCharacters: Self.unreserved)
    else { return nil }
    return URL(string: "ghostex://session?machineId=\(machine)&sessionId=\(session)")
  }
}

public enum GhostexAgentState: String, Codable, Hashable, Sendable {
  case working
  case waiting
  case finished
}

public struct GhostexActivityRow: Codable, Hashable, Sendable {
  public var target: GhostexActivityTarget
  public var agentName: String
  /// Resolved artwork identity and RGB tint from the app's registry; never resolved from the display name here.
  public var agentIcon: String
  public var agentTint: UInt32
  public var project: String
  public var state: GhostexAgentState
  /// Working: when the current stint began (`workingStartedAt`); finished: when the stint that ended began
  /// (`attention.workingStartedAt`; the row shows `finishedAt` − `startedAt`); waiting: since the agent waits
  /// (`attention.enteredAt`). Required, so every row has its time.
  public var startedAt: Date
  public var finishedAt: Date?
  public var expiresAt: Date?
  /// True on a waiting row with a pending question: it says "has a question".
  public var hasQuestion: Bool?
  /// The computer the session runs on, by its name, only while the activity shows more than one computer.
  public var computer: String?

  public init(
    target: GhostexActivityTarget, agentName: String, agentIcon: String, agentTint: UInt32,
    project: String, state: GhostexAgentState,
    startedAt: Date, finishedAt: Date? = nil, expiresAt: Date? = nil, hasQuestion: Bool? = nil,
    computer: String? = nil
  ) {
    self.target = target
    self.agentName = agentName
    self.agentIcon = agentIcon
    self.agentTint = agentTint
    self.project = project
    self.state = state
    self.startedAt = startedAt
    self.finishedAt = finishedAt
    self.expiresAt = expiresAt
    self.hasQuestion = hasQuestion
    self.computer = computer
  }

  private enum CodingKeys: String, CodingKey {
    case target, agentName, agentIcon, agentTint, project, state, startedAt, finishedAt, expiresAt, hasQuestion
    case computer
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    target = try container.decode(GhostexActivityTarget.self, forKey: .target)
    agentName = try container.decode(String.self, forKey: .agentName)
    agentIcon = try container.decode(String.self, forKey: .agentIcon)
    agentTint = try container.decode(UInt32.self, forKey: .agentTint)
    project = try container.decode(String.self, forKey: .project)
    state = try container.decode(GhostexAgentState.self, forKey: .state)
    startedAt = try ActivityTime.decode(container, .startedAt)
    finishedAt = try ActivityTime.decodeIfPresent(container, .finishedAt)
    expiresAt = try ActivityTime.decodeIfPresent(container, .expiresAt)
    hasQuestion = try container.decodeIfPresent(Bool.self, forKey: .hasQuestion)
    computer = try container.decodeIfPresent(String.self, forKey: .computer).flatMap { $0.isEmpty ? nil : $0 }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(target, forKey: .target)
    try container.encode(agentName, forKey: .agentName)
    try container.encode(agentIcon, forKey: .agentIcon)
    try container.encode(agentTint, forKey: .agentTint)
    try container.encode(project, forKey: .project)
    try container.encode(state, forKey: .state)
    try container.encode(ActivityTime.text(startedAt), forKey: .startedAt)
    try container.encodeIfPresent(finishedAt.map(ActivityTime.text), forKey: .finishedAt)
    try container.encodeIfPresent(expiresAt.map(ActivityTime.text), forKey: .expiresAt)
    try container.encodeIfPresent(hasQuestion, forKey: .hasQuestion)
    try container.encodeIfPresent(computer, forKey: .computer)
  }

  /// Whether the row says "has a question" instead of "waiting".
  public var asksQuestion: Bool { state == .waiting && hasQuestion == true }

  /// A question row opens its question card through the app's existing `view=question` session link.
  public var deepLink: URL? {
    guard let session = target.deepLink else { return nil }
    guard asksQuestion else { return session }
    return URL(string: session.absoluteString + "&view=question")
  }
}

public struct GhostexActivityContent: Codable, Hashable, Sendable {
  /// The data time: when the oldest summary behind this content was read from its computer.
  public var updatedAt: Date
  /// Every working and waiting agent, also those without a row (finished excluded).
  public var counts: GhostexActivityCounts
  /// Up to four rows, waiting first, then working, then finished.
  public var agents: [GhostexActivityRow]
  /// Agents that are not shown as a row.
  public var moreCount: Int

  public init(updatedAt: Date, counts: GhostexActivityCounts, agents: [GhostexActivityRow], moreCount: Int) {
    self.updatedAt = updatedAt
    self.counts = counts
    self.agents = agents
    self.moreCount = moreCount
  }

  private enum CodingKeys: String, CodingKey {
    case updatedAt, counts, agents, moreCount
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    updatedAt = try ActivityTime.decode(container, .updatedAt)
    counts = try container.decode(GhostexActivityCounts.self, forKey: .counts)
    agents = try container.decode([GhostexActivityRow].self, forKey: .agents)
    moreCount = try container.decodeIfPresent(Int.self, forKey: .moreCount) ?? 0
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(ActivityTime.text(updatedAt), forKey: .updatedAt)
    try container.encode(counts, forKey: .counts)
    try container.encode(agents, forKey: .agents)
    try container.encode(moreCount, forKey: .moreCount)
  }

  /// No agent works or waits: both counts are 0. Not "no rows": an approval wait is counted without a row, so
  /// rows can be missing while an agent waits.
  public var noAgentWorkingOrWaiting: Bool {
    counts.working == 0 && counts.waiting == 0
  }

  /// ActivityKit's limit for the static attributes plus the content state, in bytes (platform, 4 KB).
  public static let byteBudget = 4096

  /// The size ActivityKit's limit applies to: attributes plus content state, each encoded as JSON with the
  /// default strategies the content state is documented with, so escaping is counted.
  public static func encodedSize<Attributes: Encodable>(_ content: Self, with attributes: Attributes) throws -> Int {
    let encoder = JSONEncoder()
    return try encoder.encode(attributes).count + encoder.encode(content).count
  }

  /// This content within `budget`: rows are dropped from the end and counted in `moreCount` until attributes
  /// plus content fit. Throws only if even no rows do not fit.
  public func fitted<Attributes: Encodable>(with attributes: Attributes, budget: Int = byteBudget) throws -> Self {
    var content = self
    while try Self.encodedSize(content, with: attributes) > budget {
      guard !content.agents.isEmpty else { throw ActivityContentTooLarge(budget: budget) }
      content.agents.removeLast()
      content.moreCount += 1
    }
    return content
  }
}

public struct ActivityContentTooLarge: Error, CustomStringConvertible {
  public let budget: Int
  public var description: String { "The Live Activity content does not fit \(budget) bytes even without rows" }
}

/// Times travel as ISO 8601 text; the app writes them with milliseconds (`toISOString`).
enum ActivityTime {
  // ISO8601DateFormatter is thread safe; one instance per format is shared.
  private static let withFraction: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  private static let withoutFraction = ISO8601DateFormatter()

  static func text(_ date: Date) -> String {
    withFraction.string(from: date)
  }

  /// A host may send whole seconds; both forms are read.
  static func parse(_ text: String) -> Date? {
    withFraction.date(from: text) ?? withoutFraction.date(from: text)
  }

  static func decode<Key: CodingKey>(_ container: KeyedDecodingContainer<Key>, _ key: Key) throws -> Date {
    let text = try container.decode(String.self, forKey: key)
    guard let date = parse(text) else {
      throw DecodingError.dataCorruptedError(forKey: key, in: container, debugDescription: "Not an ISO 8601 time: \(text)")
    }
    return date
  }

  static func decodeIfPresent<Key: CodingKey>(_ container: KeyedDecodingContainer<Key>, _ key: Key) throws -> Date? {
    guard container.contains(key) else { return nil }
    return try decode(container, key)
  }
}
