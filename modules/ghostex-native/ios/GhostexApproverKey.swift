import Foundation
import LocalAuthentication
import Security

/// GitHub #495: this phone's approver key, the P-256 key that signs the owner's approvals
/// (turning on Easy Connect, connecting a computer, an agent answering another session's
/// prompt…). It lives in the Secure Enclave (a keychain key on the simulator) and every signature
/// asks Face ID, Touch ID or the passcode first (`.userPresence`), so an app or a person holding
/// the unlocked phone can't approve without the owner. The computer keeps its public half
/// (`/api/enrollApproverKey`) and checks each approval against it.
///
/// Separate from pairing's device key, which signs without a prompt.
enum GhostexApproverKey {
  private static let tag = Data("dev.ghostex.approver-key".utf8)

  /// The public half as the 65-byte uncompressed point, base64; makes the key on first use.
  static func publicKey() throws -> String {
    let key = try existingKey(context: nil) ?? makeKey()
    guard let publicKey = SecKeyCopyPublicKey(key) else {
      throw GhostexApproverKeyError.message("The approver key has no public half.")
    }
    var error: Unmanaged<CFError>?
    guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw GhostexApproverKeyError.message("Could not read the approver key: \(String(describing: error?.takeRetainedValue()))")
    }
    return data.base64EncodedString()
  }

  /// A DER ECDSA signature over `payload` (UTF-8), base64, after the system prompt shows `reason`.
  static func sign(_ payload: String, reason: String) throws -> String {
    let context = LAContext()
    context.localizedReason = reason
    guard let key = try existingKey(context: context) else {
      throw GhostexApproverKeyError.message("This phone has no approver key yet.")
    }
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
      key,
      .ecdsaSignatureMessageX962SHA256,
      Data(payload.utf8) as CFData,
      &error
    ) as Data? else {
      let reason = error?.takeRetainedValue().localizedDescription ?? "cancelled"
      throw GhostexApproverKeyError.message("Not approved: \(reason)")
    }
    return signature.base64EncodedString()
  }

  private static func existingKey(context: LAContext?) throws -> SecKey? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
    if let context {
      query[kSecUseAuthenticationContext as String] = context
    }
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let item else {
      throw GhostexApproverKeyError.message("Could not read the approver key (\(status)).")
    }
    return (item as! SecKey)
  }

  private static func makeKey() throws -> SecKey {
    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      [.privateKeyUsage, .userPresence],
      &error
    ) else {
      throw GhostexApproverKeyError.message("Could not protect the approver key.")
    }
    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag,
        kSecAttrAccessControl as String: access,
      ],
    ]
    #if !targetEnvironment(simulator)
      attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    #endif
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw GhostexApproverKeyError.message("Could not make the approver key: \(String(describing: error?.takeRetainedValue()))")
    }
    return key
  }
}

enum GhostexApproverKeyError: LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case .message(let text): return text
    }
  }
}
