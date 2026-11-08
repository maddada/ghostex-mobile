package expo.modules.ghostexnative

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * GitHub #495: this phone's approver key, the P-256 key that signs the owner's approvals
 * (turning on Easy Connect, connecting a computer, an agent answering another session's
 * prompt…). It lives in the Android Keystore (StrongBox when the phone has one) and can't sign
 * until the user passes the system's biometric or screen-lock prompt for that one signature, so
 * an app or a person holding the unlocked phone can't approve without the owner. The computer
 * keeps its public half (`/api/enrollApproverKey`) and checks each approval against it.
 *
 * Separate from pairing's device key, which signs without a prompt.
 */
object GhostexApproverKey {
  private const val ALIAS = "ghostex-approver-key"
  private const val STORE = "AndroidKeyStore"

  /** The public half as the 65-byte uncompressed point, base64; makes the key on first use. */
  fun publicKey(): String {
    val store = KeyStore.getInstance(STORE).apply { load(null) }
    if (!store.containsAlias(ALIAS)) makeKey()
    val encoded = store.getCertificate(ALIAS).publicKey.encoded
    // X.509 SubjectPublicKeyInfo of a P-256 key: a 26-byte header, then the 65-byte point.
    val point = encoded.copyOfRange(encoded.size - 65, encoded.size)
    return Base64.encodeToString(point, Base64.NO_WRAP)
  }

  /**
   * Shows the system prompt with `reason`, then signs `payload` (UTF-8) with a DER ECDSA
   * signature; `done` gets it as base64, or the error.
   */
  fun sign(activity: FragmentActivity, payload: String, reason: String, done: (Result<String>) -> Unit) {
    val store = KeyStore.getInstance(STORE).apply { load(null) }
    val key = store.getKey(ALIAS, null) as? PrivateKey
    if (key == null) {
      done(Result.failure(IllegalStateException("This phone has no approver key yet.")))
      return
    }
    val signature = Signature.getInstance("SHA256withECDSA").apply { initSign(key) }
    val prompt = BiometricPrompt(
      activity,
      ContextCompat.getMainExecutor(activity),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          try {
            val unlocked = result.cryptoObject?.signature ?: signature
            unlocked.update(payload.toByteArray(Charsets.UTF_8))
            done(Result.success(Base64.encodeToString(unlocked.sign(), Base64.NO_WRAP)))
          } catch (error: Exception) {
            done(Result.failure(error))
          }
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          done(Result.failure(IllegalStateException("Not approved: $errString")))
        }
      },
    )
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle("Approve in Ghostex")
      .setSubtitle(reason)
      .apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          setAllowedAuthenticators(BIOMETRIC_STRONG or DEVICE_CREDENTIAL)
        } else {
          setAllowedAuthenticators(BIOMETRIC_STRONG)
          setNegativeButtonText("Cancel")
        }
      }
      .build()
    prompt.authenticate(info, BiometricPrompt.CryptoObject(signature))
  }

  private fun makeKey() {
    fun spec(strongBox: Boolean): KeyGenParameterSpec =
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(true)
        .apply {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Every signature needs its own prompt (timeout 0).
            setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) setInvalidatedByBiometricEnrollment(false)
          if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true)
        }
        .build()
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, STORE)
    try {
      generator.initialize(spec(strongBox = true))
      generator.generateKeyPair()
    } catch (unavailable: java.security.ProviderException) {
      // StrongBoxUnavailableException (API 28+) is a ProviderException: no StrongBox here.
      generator.initialize(spec(strongBox = false))
      generator.generateKeyPair()
    }
  }
}
