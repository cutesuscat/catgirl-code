package expo.modules.t3ssh

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts the key seed at rest. */
interface SeedSealer {
  fun seal(plain: ByteArray): ByteArray

  fun open(sealed: ByteArray): ByteArray

  fun forget()
}

/**
 * The app's SSH state, in one private directory: the key (sealed seed plus its public line),
 * the ssh config text and known_hosts. Kept out of backups, because a restored seed could not
 * be opened without this device's keystore key anyway.
 */
class SshStore(private val dir: File, private val sealer: SeedSealer) {
  private val configFile = File(dir, "config")
  private val knownHostsFile = File(dir, "known_hosts")
  private val publicKeyFile = File(dir, "id_ed25519.pub")
  private val sealedSeedFile = File(dir, "id_ed25519.sealed")

  @Synchronized
  fun readConfig(): String = configFile.readOrEmpty()

  @Synchronized
  fun writeConfig(text: String) = writeAtomically(configFile, text)

  @Synchronized
  fun knownHosts(): List<KnownHost> = KnownHosts.parse(knownHostsFile.readOrEmpty())

  /** Adds an entry. A name that already has a different key must be forgotten first. */
  @Synchronized
  fun trust(line: String) {
    val entry = requireNotNull(KnownHosts.parseLine(line)) { "Not a known_hosts line." }
    val current = knownHosts()
    if (entry in current) return
    val clash = current.firstOrNull { known -> entry.names.any(known::matches) }
    check(clash == null) {
      "${clash?.names?.first()} already has a different trusted key. Remove it first."
    }
    saveKnownHosts(current + entry)
  }

  @Synchronized
  fun forget(line: String) {
    val entry = KnownHosts.parseLine(line) ?: return
    saveKnownHosts(knownHosts() - entry)
  }

  @Synchronized
  fun publicKeyLine(): String? = publicKeyFile.takeIf { it.exists() }?.readText()?.trim()

  /** The key, or null when none was created or this device can no longer open it. */
  @Synchronized
  fun key(): Ed25519Key? {
    if (!sealedSeedFile.exists()) return null
    return try {
      Ed25519Key(sealer.open(sealedSeedFile.readBytes()))
    } catch (_: Exception) {
      null
    }
  }

  /** Replaces any existing key with a new one and returns its public line. */
  @Synchronized
  fun createKey(comment: String): String {
    val key = Ed25519Key.generate()
    val line = key.publicKeyLine(comment)
    writeAtomically(sealedSeedFile, sealer.seal(key.seedCopy()))
    writeAtomically(publicKeyFile, line + "\n")
    return line
  }

  @Synchronized
  fun deleteKey() {
    sealedSeedFile.delete()
    publicKeyFile.delete()
    sealer.forget()
  }

  /** This store as settings-file sections. The seed is only ever written into a sealed file. */
  @Synchronized
  fun exportSections(): Map<String, ByteArray> {
    val sections = LinkedHashMap<String, ByteArray>()
    key()?.let { key ->
      sections[SshSections.SEED] = key.seedCopy()
      sections[SshSections.PUBLIC] = (publicKeyLine() ?: key.publicKeyLine("")).toByteArray()
    }
    readConfig().takeIf { it.isNotBlank() }?.let { sections[SshSections.CONFIG] = it.toByteArray() }
    knownHosts().takeIf { it.isNotEmpty() }?.let { hosts ->
      sections[SshSections.KNOWN_HOSTS] = hosts.joinToString("") { "${it.line}\n" }.toByteArray()
    }
    return sections
  }

  /**
   * Takes what the caller asked for from a settings file. ADD never changes what this device
   * already has, so only REPLACE can overwrite a key or a config. The key is sealed again here.
   */
  @Synchronized
  fun importSections(
    sections: Map<String, ByteArray>,
    key: SshImport,
    config: SshImport,
    knownHosts: SshImport
  ): SshImportResult {
    val archive = SshArchive.read(sections)
    val current = key()
    val keyTaken = archive.key != null && key != SshImport.SKIP &&
      (key == SshImport.REPLACE || current == null) &&
      !archive.key.publicKey.contentEquals(current?.publicKey)
    if (keyTaken) {
      writeAtomically(sealedSeedFile, sealer.seal(archive.key!!.seedCopy()))
      writeAtomically(publicKeyFile, archive.publicKeyLine + "\n")
    }
    val configTaken = archive.config != null && config != SshImport.SKIP &&
      (config == SshImport.REPLACE || readConfig().isBlank()) && archive.config != readConfig()
    if (configTaken) writeConfig(archive.config!!)
    var hostsAdded = 0
    var hostsKept = 0
    if (knownHosts != SshImport.SKIP) {
      val merged = knownHosts().toMutableList()
      for (entry in archive.knownHosts) {
        if (entry in merged) continue
        // A name this device already trusts under another key keeps this device's key.
        if (merged.any { known -> entry.names.any(known::matches) }) {
          hostsKept += 1
        } else {
          merged += entry
          hostsAdded += 1
        }
      }
      if (hostsAdded > 0) saveKnownHosts(merged)
    }
    return SshImportResult(keyTaken, configTaken, hostsAdded, hostsKept)
  }

  private fun saveKnownHosts(entries: List<KnownHost>) =
    writeAtomically(knownHostsFile, entries.joinToString("") { "${it.line}\n" })

  private fun File.readOrEmpty(): String = if (exists()) readText() else ""

  private fun writeAtomically(file: File, text: String) = writeAtomically(file, text.toByteArray())

  private fun writeAtomically(file: File, bytes: ByteArray) {
    dir.mkdirs()
    val temp = File(dir, file.name + ".tmp")
    temp.writeBytes(bytes)
    if (!temp.renameTo(file)) throw java.io.IOException("Could not save ${file.name}.")
  }
}

/** The names of the SSH sections in a settings file. */
object SshSections {
  const val SEED = "ssh/seed"
  const val PUBLIC = "ssh/public"
  const val CONFIG = "ssh/config"
  const val KNOWN_HOSTS = "ssh/known_hosts"
}

enum class SshImport { SKIP, ADD, REPLACE }

data class SshImportResult(
  val keyImported: Boolean,
  val configImported: Boolean,
  val knownHostsAdded: Int,
  val knownHostsKept: Int
)

/** The SSH part of an opened settings file, checked before anything is shown or stored. */
class SshArchive private constructor(
  val key: Ed25519Key?,
  val publicKeyLine: String?,
  val config: String?,
  val knownHosts: List<KnownHost>
) {
  companion object {
    fun read(sections: Map<String, ByteArray>): SshArchive {
      val seed = sections[SshSections.SEED]
      val key = seed?.let {
        if (it.size != Ed25519Key.SEED_BYTES) throw damagedKey()
        Ed25519Key(it)
      }
      val line = key?.let { publicLine(it, sections[SshSections.PUBLIC]) }
      return SshArchive(
        key = key,
        publicKeyLine = line,
        config = sections[SshSections.CONFIG]?.toString(Charsets.UTF_8)?.takeIf { it.isNotBlank() },
        knownHosts = KnownHosts.parse(
          sections[SshSections.KNOWN_HOSTS]?.toString(Charsets.UTF_8).orEmpty()
        ),
      )
    }

    // The line is rebuilt from the seed, so a file cannot pair a seed with another key's line.
    private fun publicLine(key: Ed25519Key, stored: ByteArray?): String {
      val fields = stored?.toString(Charsets.UTF_8)?.trim()?.split(Regex("\\s+")).orEmpty()
      val line = key.publicKeyLine(fields.drop(2).joinToString(" "))
      if (fields.size >= 2 && fields.take(2) != line.split(' ').take(2)) throw damagedKey()
      return line
    }

    private fun damagedKey() = SettingsArchiveException(
      SettingsArchiveException.Reason.DAMAGED,
      "The SSH key in this settings file is damaged. Export it again."
    )
  }
}

/** AES-256-GCM with a key that never leaves the Android keystore. */
object KeystoreSealer : SeedSealer {
  private const val ALIAS = "t3-ssh-key-seal"
  private const val VERSION: Byte = 1
  private const val IV_BYTES = 12
  private const val TAG_BITS = 128

  override fun seal(plain: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, secretKey())
    return byteArrayOf(VERSION) + cipher.iv + cipher.doFinal(plain)
  }

  override fun open(sealed: ByteArray): ByteArray {
    require(sealed.size > 1 + IV_BYTES && sealed[0] == VERSION) { "Unknown sealed key format." }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, sealed, 1, IV_BYTES))
    return cipher.doFinal(sealed, 1 + IV_BYTES, sealed.size - 1 - IV_BYTES)
  }

  override fun forget() {
    keyStore().deleteEntry(ALIAS)
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun secretKey(): SecretKey {
    (keyStore().getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }
}
