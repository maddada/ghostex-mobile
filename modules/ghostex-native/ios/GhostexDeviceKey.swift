//
//  GhostexDeviceKey.swift
//
//  CDXC:RemotePairing 2026-11-08 DECISION:
//  User (GitHub #495, Q1721 "device keys + pending + match"): each phone pairs with its own key
//  pair. This is the phone's device key: P-256 in the Secure Enclave, created on first use, never
//  leaving the phone, kept only on this device (`AfterFirstUnlockThisDeviceOnly`) and usable
//  without Face ID so the phone can sign its pairing asks and token renewals in the background.
//  It is not the approver key: approving sensitive actions uses a separate biometric-bound key
//  (GitHub #495 Phase 2). A simulator has no Secure Enclave, so there the key is a software key in
//  the keychain. The public key goes to the computer as the 65-byte uncompressed point; signatures
//  are ASN.1 DER over SHA-256 (`ecdsaSignatureMessageX962SHA256`), which gxserver checks.
//

import Foundation
import Security

enum GhostexDeviceKey {
    private static let tag = "dev.ghostex.device-key.v1".data(using: .utf8)!
    private static let lock = NSLock()

    /// The device key's public half, base64 (standard, padded), creating the key on first use.
    static func publicKey() throws -> String {
        let key = try privateKey()
        guard let publicKey = SecKeyCopyPublicKey(key) else {
            throw DeviceKeyError.failed("The device key has no public half.")
        }
        var error: Unmanaged<CFError>?
        guard let data = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
            throw DeviceKeyError.failed(describe(error))
        }
        guard data.count == 65, data.first == 0x04 else {
            throw DeviceKeyError.failed("The device key is not an uncompressed P-256 point.")
        }
        return data.base64EncodedString()
    }

    /// Signs `payload` (UTF-8) with the device key; base64 of the ASN.1 DER signature.
    static func sign(_ payload: String) throws -> String {
        let key = try privateKey()
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            key,
            .ecdsaSignatureMessageX962SHA256,
            Data(payload.utf8) as CFData,
            &error
        ) as Data? else {
            throw DeviceKeyError.failed(describe(error))
        }
        return signature.base64EncodedString()
    }

    private static func privateKey() throws -> SecKey {
        lock.lock()
        defer { lock.unlock() }
        if let existing = try find() { return existing }
        #if targetEnvironment(simulator)
        return try create(secureEnclave: false)
        #else
        return try create(secureEnclave: true)
        #endif
    }

    private static func find() throws -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let item else {
            throw DeviceKeyError.failed("The keychain refused to read the device key (\(status)).")
        }
        return (item as! SecKey)
    }

    private static func create(secureEnclave: Bool) throws -> SecKey {
        var error: Unmanaged<CFError>?
        let flags: SecAccessControlCreateFlags = secureEnclave ? [.privateKeyUsage] : []
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            flags,
            &error
        ) else {
            throw DeviceKeyError.failed(describe(error))
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
        if secureEnclave {
            attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
        }
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw DeviceKeyError.failed(describe(error))
        }
        return key
    }

    private static func describe(_ error: Unmanaged<CFError>?) -> String {
        guard let error = error?.takeRetainedValue() else { return "The device key failed." }
        return (error as Error).localizedDescription
    }

    enum DeviceKeyError: LocalizedError {
        case failed(String)
        var errorDescription: String? {
            switch self {
            case .failed(let message): return message
            }
        }
    }
}
