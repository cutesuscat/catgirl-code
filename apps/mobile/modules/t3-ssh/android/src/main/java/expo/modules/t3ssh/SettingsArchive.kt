package expo.modules.t3ssh

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Why a settings file could not be written or read, in words a person can act on. */
class SettingsArchiveException(val reason: Reason, message: String) : Exception(message) {
  enum class Reason(val code: String) {
    PASSPHRASE_MISSING("ERR_SETTINGS_PASSPHRASE_MISSING"),
    NOT_A_SETTINGS_FILE("ERR_SETTINGS_NOT_A_FILE"),
    NEWER_VERSION("ERR_SETTINGS_NEWER_VERSION"),
    WRONG_PASSPHRASE("ERR_SETTINGS_WRONG_PASSPHRASE"),
    DAMAGED("ERR_SETTINGS_DAMAGED"),
    TOO_MUCH_MEMORY("ERR_SETTINGS_MEMORY")
  }
}

/** Argon2id cost. Written into each file, so it can rise without breaking older files. */
data class SettingsKdf(
  val memoryKiB: Int = 65_536,
  val iterations: Int = 3,
  val parallelism: Int = 1
)

/**
 * The settings file: named sections, encrypted with a passphrase. Three text lines say how
 * (format and version, Argon2id cost and salt, AES-256-GCM nonce and passphrase check) and the
 * fourth is the sealed sections in base64. The first three lines are authenticated too.
 */
object SettingsArchive {
  const val FORMAT = "catgirl-code-settings"
  const val VERSION = 1

  /** No real file comes near this; it stops a wrong pick from being read into memory. */
  const val MAX_FILE_BYTES = 8 * 1024 * 1024

  private const val KDF = "argon2id"
  private const val CIPHER = "aes-256-gcm"
  private const val SALT_BYTES = 16
  private const val NONCE_BYTES = 12
  private const val KEY_BYTES = 32
  private const val CHECK_BYTES = 8
  private const val TAG_BITS = 128
  private const val CHECK_LABEL = "catgirl-code-settings passphrase check"

  // A file asking for more than this is refused rather than allowed to exhaust the app's heap.
  private const val MAX_MEMORY_KIB = 262_144
  private const val MAX_ITERATIONS = 32
  private const val MAX_PARALLELISM = 16

  fun seal(
    sections: Map<String, ByteArray>,
    passphrase: String,
    kdf: SettingsKdf = SettingsKdf(),
    random: SecureRandom = SecureRandom()
  ): ByteArray {
    val salt = ByteArray(SALT_BYTES).also(random::nextBytes)
    val nonce = ByteArray(NONCE_BYTES).also(random::nextBytes)
    val keys = deriveKeys(passphrase, kdf, salt)
    val header = listOf(
      "$FORMAT $VERSION",
      "$KDF m=${kdf.memoryKiB} t=${kdf.iterations} p=${kdf.parallelism} salt=${base64(salt)}",
      "$CIPHER nonce=${base64(nonce)} check=${base64(keys.check)}",
    )
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, keys.secret, GCMParameterSpec(TAG_BITS, nonce))
    cipher.updateAAD(authenticated(header))
    val body = cipher.doFinal(encodeSections(sections))
    return (header + base64(body)).joinToString("") { "$it\n" }.toByteArray(Charsets.US_ASCII)
  }

  /** Fails unless `file` looks like a settings file this version can read. Needs no passphrase. */
  fun check(file: ByteArray) {
    parse(file)
  }

  fun open(file: ByteArray, passphrase: String): Map<String, ByteArray> {
    val parsed = parse(file)
    val keys = deriveKeys(passphrase, parsed.kdf, parsed.salt)
    if (!MessageDigest.isEqual(keys.check, parsed.check)) {
      throw failure(
        SettingsArchiveException.Reason.WRONG_PASSPHRASE,
        "That passphrase does not open this file."
      )
    }
    val plain = try {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, keys.secret, GCMParameterSpec(TAG_BITS, parsed.nonce))
      cipher.updateAAD(authenticated(parsed.header))
      cipher.doFinal(parsed.body)
    } catch (_: GeneralSecurityException) {
      throw damaged()
    }
    return decodeSections(plain)
  }

  private class Parsed(
    val header: List<String>,
    val kdf: SettingsKdf,
    val salt: ByteArray,
    val nonce: ByteArray,
    val check: ByteArray,
    val body: ByteArray
  )

  private class Keys(val secret: SecretKeySpec, val check: ByteArray)

  private fun parse(file: ByteArray): Parsed {
    val notOurs = failure(
      SettingsArchiveException.Reason.NOT_A_SETTINGS_FILE,
      "This is not a Catgirl Code settings file."
    )
    if (file.size > MAX_FILE_BYTES) throw notOurs
    // Lines are trimmed, so a transfer that rewrote the line endings does no harm.
    val lines = String(file, Charsets.ISO_8859_1).lines().map(String::trim).filter(String::isNotEmpty)
    val first = lines.firstOrNull()?.split(' ') ?: throw notOurs
    if (first.size != 2 || first[0] != FORMAT) throw notOurs
    val version = first[1].toIntOrNull() ?: throw notOurs
    if (version > VERSION) {
      throw failure(
        SettingsArchiveException.Reason.NEWER_VERSION,
        "This file was made by a newer version of the app. Update this app, then import it again."
      )
    }
    if (version < 1 || lines.size != 4) throw damaged()
    val kdf = fields(lines[1], KDF)
    val cipher = fields(lines[2], CIPHER)
    val cost = SettingsKdf(
      memoryKiB = kdf.int("m"),
      iterations = kdf.int("t"),
      parallelism = kdf.int("p"),
    )
    if (cost.memoryKiB > MAX_MEMORY_KIB) {
      throw failure(
        SettingsArchiveException.Reason.TOO_MUCH_MEMORY,
        "Opening this file needs more memory than the app allows."
      )
    }
    val valid = cost.iterations in 1..MAX_ITERATIONS &&
      cost.parallelism in 1..MAX_PARALLELISM &&
      cost.memoryKiB >= 8 * cost.parallelism
    val parsed = Parsed(
      header = lines.take(3),
      kdf = cost,
      salt = kdf.bytes("salt"),
      nonce = cipher.bytes("nonce"),
      check = cipher.bytes("check"),
      body = unbase64(lines[3]),
    )
    val sized = parsed.salt.size >= 8 && parsed.nonce.size == NONCE_BYTES &&
      parsed.check.size == CHECK_BYTES && parsed.body.size >= TAG_BITS / 8
    if (!valid || !sized) throw damaged()
    return parsed
  }

  private fun fields(line: String, name: String): Map<String, String> {
    val parts = line.split(' ')
    if (parts.first() != name) throw damaged()
    return parts.drop(1).associate { part ->
      val at = part.indexOf('=')
      if (at <= 0) throw damaged()
      part.substring(0, at) to part.substring(at + 1)
    }
  }

  private fun Map<String, String>.int(key: String): Int =
    this[key]?.toIntOrNull() ?: throw damaged()

  private fun Map<String, String>.bytes(key: String): ByteArray =
    unbase64(this[key] ?: throw damaged())

  private fun authenticated(header: List<String>): ByteArray =
    header.joinToString("") { "$it\n" }.toByteArray(Charsets.US_ASCII)

  private fun deriveKeys(passphrase: String, kdf: SettingsKdf, salt: ByteArray): Keys {
    if (passphrase.isEmpty()) {
      throw failure(SettingsArchiveException.Reason.PASSPHRASE_MISSING, "Enter a passphrase.")
    }
    // The same passphrase typed on another keyboard can arrive composed differently.
    val secret = Normalizer.normalize(passphrase, Normalizer.Form.NFC).toByteArray(Charsets.UTF_8)
    val output = ByteArray(KEY_BYTES * 2)
    try {
      val generator = Argon2BytesGenerator()
      generator.init(
        Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
          .withVersion(Argon2Parameters.ARGON2_VERSION_13)
          .withMemoryAsKB(kdf.memoryKiB)
          .withIterations(kdf.iterations)
          .withParallelism(kdf.parallelism)
          .withSalt(salt)
          .build(),
      )
      generator.generateBytes(secret, output)
    } catch (_: OutOfMemoryError) {
      throw failure(
        SettingsArchiveException.Reason.TOO_MUCH_MEMORY,
        "There is not enough free memory to do this. Close other apps and try again."
      )
    } finally {
      secret.fill(0)
    }
    // The second half only proves the passphrase; the key is never derived from what the file shows.
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(CHECK_LABEL.toByteArray(Charsets.US_ASCII))
    val check = digest.digest(output.copyOfRange(KEY_BYTES, output.size)).copyOf(CHECK_BYTES)
    val key = SecretKeySpec(output.copyOf(KEY_BYTES), "AES")
    output.fill(0)
    return Keys(key, check)
  }

  private fun encodeSections(sections: Map<String, ByteArray>): ByteArray {
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).use { out ->
      for ((name, value) in sections) {
        val encodedName = name.toByteArray(Charsets.UTF_8)
        out.writeShort(encodedName.size)
        out.write(encodedName)
        out.writeInt(value.size)
        out.write(value)
      }
    }
    return bytes.toByteArray()
  }

  private fun decodeSections(plain: ByteArray): Map<String, ByteArray> {
    val sections = LinkedHashMap<String, ByteArray>()
    try {
      DataInputStream(ByteArrayInputStream(plain)).use { input ->
        while (input.available() > 0) {
          val name = ByteArray(input.readUnsignedShort()).also(input::readFully)
          val size = input.readInt()
          if (size < 0 || size > input.available()) throw damaged()
          sections[String(name, Charsets.UTF_8)] = ByteArray(size).also(input::readFully)
        }
      }
    } catch (_: IOException) {
      throw damaged()
    }
    return sections
  }

  private fun base64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

  private fun unbase64(text: String): ByteArray = try {
    Base64.getDecoder().decode(text)
  } catch (_: IllegalArgumentException) {
    throw damaged()
  }

  private fun damaged() = failure(
    SettingsArchiveException.Reason.DAMAGED,
    "This settings file is damaged or incomplete. Export it again."
  )

  private fun failure(reason: SettingsArchiveException.Reason, message: String) =
    SettingsArchiveException(reason, message)
}
