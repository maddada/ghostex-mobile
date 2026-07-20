package expo.modules.ghostexnative

import com.hierynomus.sshj.userauth.keyprovider.bcrypt.BCrypt
import java.io.ByteArrayOutputStream
import java.io.StringWriter
import java.math.BigInteger
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.generators.RSAKeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.params.RSAKeyGenerationParameters
import org.bouncycastle.crypto.params.RSAKeyParameters
import org.bouncycastle.crypto.params.RSAPrivateCrtKeyParameters
import org.bouncycastle.crypto.util.OpenSSHPublicKeyUtil
import org.bouncycastle.crypto.util.PrivateKeyInfoFactory
import org.bouncycastle.util.io.pem.PemHeader
import org.bouncycastle.util.io.pem.PemObject
import org.bouncycastle.util.io.pem.PemWriter

/**
 * App-owned SSH key generation via BouncyCastle:
 * - ed25519 → OpenSSH `openssh-key-v1` private key format (optionally encrypted with
 *   bcrypt-kdf + aes256-ctr, using SSHJ's vendored bcrypt_pbkdf implementation).
 * - rsa4096 → traditional PKCS#1 PEM (optionally encrypted with AES-128-CBC DEK-Info).
 * Public key is an `authorized_keys` line with comment; fingerprint is OpenSSH-style
 * `SHA256:` base64 with padding stripped.
 */
object GhostexSshKeyGenerator {

  class GeneratedKey(val privateKey: String, val publicKey: String, val fingerprint: String)

  fun generate(type: String, comment: String, passphrase: String?): GeneratedKey {
    val safeComment = comment.replace('\n', ' ').replace('\r', ' ').trim()
    val effectivePassphrase = passphrase?.takeIf { it.isNotEmpty() }
    return when (type) {
      "ed25519" -> generateEd25519(safeComment, effectivePassphrase)
      "rsa4096" -> generateRsa4096(safeComment, effectivePassphrase)
      else -> throw IllegalArgumentException("Unsupported SSH key type: $type")
    }
  }

  // region ed25519

  private fun generateEd25519(comment: String, passphrase: String?): GeneratedKey {
    val random = SecureRandom()
    val generator = Ed25519KeyPairGenerator()
    generator.init(Ed25519KeyGenerationParameters(random))
    val pair = generator.generateKeyPair()
    val privateParams = pair.private as Ed25519PrivateKeyParameters
    val publicParams = pair.public as Ed25519PublicKeyParameters

    val publicBlob = OpenSSHPublicKeyUtil.encodePublicKey(publicParams)
    val privatePem = encodeOpenSshPrivateKey(publicParams, privateParams, comment, passphrase, random)
    return GeneratedKey(
      privateKey = privatePem,
      publicKey = authorizedKeysLine("ssh-ed25519", publicBlob, comment),
      fingerprint = fingerprint(publicBlob)
    )
  }

  private fun encodeOpenSshPrivateKey(
    publicParams: Ed25519PublicKeyParameters,
    privateParams: Ed25519PrivateKeyParameters,
    comment: String,
    passphrase: String?,
    random: SecureRandom
  ): String {
    val encrypted = passphrase != null
    val blockSize = if (encrypted) 16 else 8

    // Inner (possibly encrypted) private-key section.
    val checkInt = random.nextInt()
    val privateSection = SshWireBuffer()
    privateSection.putUInt32(checkInt)
    privateSection.putUInt32(checkInt)
    privateSection.putString("ssh-ed25519")
    privateSection.putBytes(publicParams.encoded)
    privateSection.putBytes(privateParams.encoded + publicParams.encoded)
    privateSection.putString(comment)
    var padByte = 1
    while (privateSection.size() % blockSize != 0) {
      privateSection.putByte(padByte.toByte())
      padByte++
    }
    var privateBytes = privateSection.toByteArray()

    val cipherName: String
    val kdfName: String
    val kdfOptions: ByteArray
    if (encrypted) {
      cipherName = "aes256-ctr"
      kdfName = "bcrypt"
      val salt = ByteArray(16).also(random::nextBytes)
      val rounds = 16
      val options = SshWireBuffer()
      options.putBytes(salt)
      options.putUInt32(rounds)
      kdfOptions = options.toByteArray()

      val keyAndIv = ByteArray(48)
      BCrypt().pbkdf(passphrase!!.toByteArray(StandardCharsets.UTF_8), salt, rounds, keyAndIv)
      val cipher = Cipher.getInstance("AES/CTR/NoPadding")
      cipher.init(
        Cipher.ENCRYPT_MODE,
        SecretKeySpec(keyAndIv.copyOfRange(0, 32), "AES"),
        IvParameterSpec(keyAndIv.copyOfRange(32, 48))
      )
      privateBytes = cipher.doFinal(privateBytes)
    } else {
      cipherName = "none"
      kdfName = "none"
      kdfOptions = ByteArray(0)
    }

    val outer = SshWireBuffer()
    outer.putRaw("openssh-key-v1".toByteArray(StandardCharsets.US_ASCII))
    outer.putByte(0) // NUL-terminated AUTH_MAGIC
    outer.putString(cipherName)
    outer.putString(kdfName)
    outer.putBytes(kdfOptions)
    outer.putUInt32(1) // number of keys
    outer.putBytes(OpenSSHPublicKeyUtil.encodePublicKey(publicParams))
    outer.putBytes(privateBytes)

    val base64 = base64NoWrap(outer.toByteArray())
    val builder = StringBuilder("-----BEGIN OPENSSH PRIVATE KEY-----\n")
    var index = 0
    while (index < base64.length) {
      val end = minOf(index + 70, base64.length)
      builder.append(base64, index, end).append('\n')
      index = end
    }
    builder.append("-----END OPENSSH PRIVATE KEY-----\n")
    return builder.toString()
  }

  // endregion

  // region rsa4096

  private fun generateRsa4096(comment: String, passphrase: String?): GeneratedKey {
    val random = SecureRandom()
    val generator = RSAKeyPairGenerator()
    generator.init(RSAKeyGenerationParameters(BigInteger.valueOf(0x10001), random, 4096, 112))
    val pair = generator.generateKeyPair()
    val publicParams = pair.public as RSAKeyParameters
    val privateParams = pair.private as RSAPrivateCrtKeyParameters

    val publicBlob = OpenSSHPublicKeyUtil.encodePublicKey(publicParams)
    val pkcs1 = PrivateKeyInfoFactory.createPrivateKeyInfo(privateParams)
      .parsePrivateKey()
      .toASN1Primitive()
      .getEncoded("DER")

    val pemObject = if (passphrase == null) {
      PemObject("RSA PRIVATE KEY", pkcs1)
    } else {
      val iv = ByteArray(16).also(random::nextBytes)
      val key = evpBytesToKey(passphrase, iv, 16)
      val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
      cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
      val encrypted = cipher.doFinal(pkcs1)
      val headers = listOf(
        PemHeader("Proc-Type", "4,ENCRYPTED"),
        PemHeader("DEK-Info", "AES-128-CBC," + hex(iv))
      )
      PemObject("RSA PRIVATE KEY", headers, encrypted)
    }

    val writer = StringWriter()
    PemWriter(writer).use { it.writeObject(pemObject) }
    return GeneratedKey(
      privateKey = writer.toString(),
      publicKey = authorizedKeysLine("ssh-rsa", publicBlob, comment),
      fingerprint = fingerprint(publicBlob)
    )
  }

  /** OpenSSL EVP_BytesToKey with MD5, one round, using the first 8 IV bytes as salt. */
  private fun evpBytesToKey(passphrase: String, iv: ByteArray, keyLength: Int): ByteArray {
    val digest = MessageDigest.getInstance("MD5")
    val output = ByteArrayOutputStream()
    var previous = ByteArray(0)
    while (output.size() < keyLength) {
      digest.reset()
      digest.update(previous)
      digest.update(passphrase.toByteArray(StandardCharsets.UTF_8))
      digest.update(iv, 0, 8)
      previous = digest.digest()
      output.write(previous)
    }
    return output.toByteArray().copyOfRange(0, keyLength)
  }

  // endregion

  private fun base64NoWrap(bytes: ByteArray): String =
    android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)

  private fun authorizedKeysLine(algorithm: String, publicBlob: ByteArray, comment: String): String {
    val encoded = base64NoWrap(publicBlob)
    return if (comment.isEmpty()) "$algorithm $encoded" else "$algorithm $encoded $comment"
  }

  private fun fingerprint(publicBlob: ByteArray): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(publicBlob)
    return "SHA256:" + base64NoWrap(digest).trimEnd('=')
  }

  private fun hex(bytes: ByteArray): String {
    val builder = StringBuilder(bytes.size * 2)
    for (byte in bytes) builder.append(String.format("%02X", byte))
    return builder.toString()
  }

  /** Minimal SSH wire-format writer (uint32 + length-prefixed strings). */
  private class SshWireBuffer {
    private val output = ByteArrayOutputStream()

    fun putRaw(bytes: ByteArray) {
      output.write(bytes, 0, bytes.size)
    }

    fun putByte(value: Byte) {
      output.write(value.toInt())
    }

    fun putUInt32(value: Int) {
      output.write((value ushr 24) and 0xFF)
      output.write((value ushr 16) and 0xFF)
      output.write((value ushr 8) and 0xFF)
      output.write(value and 0xFF)
    }

    fun putBytes(bytes: ByteArray) {
      putUInt32(bytes.size)
      putRaw(bytes)
    }

    fun putString(value: String) {
      putBytes(value.toByteArray(StandardCharsets.UTF_8))
    }

    fun size(): Int = output.size()

    fun toByteArray(): ByteArray = output.toByteArray()
  }
}
