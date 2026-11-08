package expo.modules.ghostexnative

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * CDXC:RemotePairing 2026-11-08 DECISION:
 * User (GitHub #495, Q1721 "device keys + pending + match"): each phone pairs with its own key
 * pair. This is the phone's device key: P-256 in the Android Keystore (StrongBox when the phone
 * has it), created on first use, never exportable, and usable without a fingerprint prompt so the
 * phone can sign its pairing asks and token renewals in the background. It is not the approver
 * key: approving sensitive actions uses a separate biometric-bound key (GitHub #495 Phase 2).
 * The public key goes to the computer as the 65-byte uncompressed point (the SPKI the Keystore
 * exports, without its 26-byte header); signatures are ASN.1 DER over SHA-256, which is what
 * gxserver checks (`ECDSA_P256_SHA256_ASN1`, server/src/remote_access/pair_device.rs).
 */
object GhostexDeviceKey {
  private const val ALIAS = "dev.ghostex.device-key.v1"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val SPKI_P256_HEADER_BYTES = 26

  /** The device key's public half, base64 (standard, padded), creating the key on first use. */
  @Synchronized
  fun publicKey(context: Context): String {
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    if (!keyStore.containsAlias(ALIAS)) create(context)
    val encoded = keyStore.getCertificate(ALIAS).publicKey.encoded
    val point = if (encoded.size == 65 + SPKI_P256_HEADER_BYTES) {
      encoded.copyOfRange(SPKI_P256_HEADER_BYTES, encoded.size)
    } else {
      encoded
    }
    require(point.size == 65 && point[0] == 0x04.toByte()) { "The device key is not an uncompressed P-256 point." }
    return Base64.encodeToString(point, Base64.NO_WRAP)
  }

  /** Signs `payload` (UTF-8) with the device key; base64 of the ASN.1 DER signature. */
  @Synchronized
  fun sign(context: Context, payload: String): String {
    publicKey(context)
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    val privateKey = keyStore.getKey(ALIAS, null) as PrivateKey
    val signature = Signature.getInstance("SHA256withECDSA").apply {
      initSign(privateKey)
      update(payload.toByteArray(Charsets.UTF_8))
    }
    return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
  }

  private fun create(context: Context) {
    val strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
    try {
      generate(strongBox)
    } catch (error: Exception) {
      // StrongBox can be listed and still refuse a key (StrongBoxUnavailableException, or a
      // ProviderException on some phones); the TEE-backed Keystore is the fallback.
      if (!strongBox) throw error
      generate(false)
    }
  }

  private fun generate(strongBox: Boolean) {
    val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(strongBox)
      }
      .build()
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE).apply {
      initialize(spec)
      generateKeyPair()
    }
  }
}
