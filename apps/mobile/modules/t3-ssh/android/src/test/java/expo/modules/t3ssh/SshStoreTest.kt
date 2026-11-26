package expo.modules.t3ssh

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SshStoreTest {
  @get:Rule val tmp = TemporaryFolder()

  // Like AES-GCM, opening with a different key fails instead of yielding other bytes.
  private class XorSealer : SeedSealer {
    var mask: Byte = 0x5a

    override fun seal(plain: ByteArray) = byteArrayOf(mask) + xor(plain)

    override fun open(sealed: ByteArray): ByteArray {
      check(sealed[0] == mask) { "tag mismatch" }
      return xor(sealed.copyOfRange(1, sealed.size))
    }

    override fun forget() {
      mask = 0x11
    }

    private fun xor(bytes: ByteArray) = ByteArray(bytes.size) {
      (bytes[it].toInt() xor mask.toInt()).toByte()
    }
  }

  private val sealer = XorSealer()
  private val store by lazy { SshStore(tmp.newFolder("t3-ssh"), sealer) }

  @Test
  fun aCreatedKeyReopensWithTheSamePublicLine() {
    val line = store.createKey("t3 test")

    assertEquals(line, store.publicKeyLine())
    assertEquals(line, store.key()?.publicKeyLine("t3 test"))
  }

  @Test
  fun aKeyThisDeviceCanNoLongerOpenReadsAsMissing() {
    store.createKey("t3")
    sealer.mask = 0x22

    assertNull(store.key())
  }

  @Test
  fun deletingTheKeyForgetsItsSealingKeyToo() {
    store.createKey("t3")

    store.deleteKey()

    assertNull(store.key())
    assertNull(store.publicKeyLine())
    assertEquals(0x11.toByte(), sealer.mask)
  }

  @Test
  fun trustingIsIdempotentAndRefusesASecondKeyForAName() {
    val first = "[127.0.0.1]:2222 ssh-ed25519 ${keyBase64()}"
    store.trust(first)
    store.trust(first)
    assertEquals(listOf(first), store.knownHosts().map { it.line })

    assertThrows(IllegalStateException::class.java) {
      store.trust("[127.0.0.1]:2222 ssh-ed25519 ${keyBase64()}")
    }

    store.forget(first)
    assertEquals(emptyList<KnownHost>(), store.knownHosts())
  }

  @Test
  fun theConfigTextRoundTrips() {
    assertEquals("", store.readConfig())
    store.writeConfig("Host box\n  HostName 127.0.0.1\n")

    assertEquals("Host box\n  HostName 127.0.0.1\n", store.readConfig())
  }

  private fun otherStore() = SshStore(tmp.newFolder(), XorSealer().apply { mask = 0x33 })

  private fun host(name: String, key: String = keyBase64()) = "$name ssh-ed25519 $key"

  @Test
  fun anExportedStoreImportsIntoAnEmptyOneAndIsSealedAgainThere() {
    val line = store.createKey("t3code-android")
    store.writeConfig("Host box\n  HostName 10.0.0.2\n")
    store.trust(host("box"))
    val otherDir = tmp.newFolder("other")
    val other = SshStore(otherDir, XorSealer().apply { mask = 0x33 })

    val result = other.importSections(
      store.exportSections(),
      SshImport.ADD,
      SshImport.ADD,
      SshImport.ADD,
    )

    assertEquals(SshImportResult(true, true, 1, 0), result)
    assertEquals(line, other.publicKeyLine())
    assertArrayEquals(store.key()?.seedCopy(), other.key()?.seedCopy())
    assertEquals(store.readConfig(), other.readConfig())
    assertEquals(store.knownHosts(), other.knownHosts())
    // Each store sealed the same seed with its own key.
    val sealedHere = File(tmp.root, "t3-ssh/id_ed25519.sealed").readBytes()
    assertFalse(sealedHere.contentEquals(File(otherDir, "id_ed25519.sealed").readBytes()))
  }

  @Test
  fun addNeverReplacesWhatTheDeviceHasAndReplaceDoes() {
    store.createKey("old phone")
    store.writeConfig("Host old\n")
    val other = otherStore()
    val mine = other.createKey("new phone")
    other.writeConfig("Host mine\n")

    val kept = other.importSections(
      store.exportSections(),
      SshImport.ADD,
      SshImport.ADD,
      SshImport.SKIP,
    )
    assertEquals(SshImportResult(false, false, 0, 0), kept)
    assertEquals(mine, other.publicKeyLine())
    assertEquals("Host mine\n", other.readConfig())

    val replaced = other.importSections(
      store.exportSections(),
      SshImport.REPLACE,
      SshImport.REPLACE,
      SshImport.SKIP,
    )
    assertEquals(SshImportResult(true, true, 0, 0), replaced)
    assertEquals(store.publicKeyLine(), other.publicKeyLine())
    assertEquals("Host old\n", other.readConfig())
  }

  @Test
  fun importingWhatIsAlreadyThereChangesNothing() {
    store.createKey("t3")
    store.writeConfig("Host box\n")
    store.trust(host("box"))

    val result = store.importSections(
      store.exportSections(),
      SshImport.REPLACE,
      SshImport.REPLACE,
      SshImport.ADD,
    )

    assertEquals(SshImportResult(false, false, 0, 0), result)
  }

  @Test
  fun knownHostsAreMergedAndAHostThisDeviceTrustsKeepsItsKey() {
    val shared = host("shared")
    store.trust(shared)
    store.trust(host("only-in-file"))
    store.trust(host("clash"))
    val other = otherStore()
    val mine = host("clash")
    other.trust(shared)
    other.trust(mine)
    other.trust(host("only-here"))

    val result = other.importSections(
      store.exportSections(),
      SshImport.SKIP,
      SshImport.SKIP,
      SshImport.ADD,
    )

    assertEquals(SshImportResult(false, false, 1, 1), result)
    val names = other.knownHosts().map { it.names.single() }
    assertEquals(listOf("shared", "clash", "only-here", "only-in-file"), names)
    assertEquals(mine, other.knownHosts().single { it.matches("clash") }.line)
  }

  @Test
  fun skippingEverythingAndAnEmptyFileImportNothing() {
    store.createKey("t3")
    store.trust(host("box"))
    val other = otherStore()

    val skipped = other.importSections(
      store.exportSections(),
      SshImport.SKIP,
      SshImport.SKIP,
      SshImport.SKIP,
    )
    val empty = other.importSections(emptyMap(), SshImport.ADD, SshImport.ADD, SshImport.ADD)

    assertEquals(SshImportResult(false, false, 0, 0), skipped)
    assertEquals(SshImportResult(false, false, 0, 0), empty)
    assertNull(other.key())
    assertEquals(emptyMap<String, ByteArray>(), other.exportSections())
  }

  @Test
  fun aSeedThatDoesNotMatchItsPublicLineIsRefused() {
    store.createKey("t3")
    val sections = store.exportSections().toMutableMap()
    sections[SshSections.PUBLIC] = Ed25519Key.generate().publicKeyLine("t3").toByteArray()
    val short = store.exportSections() + (SshSections.SEED to ByteArray(16))

    for (bad in listOf(sections, short)) {
      val error = assertThrows(SettingsArchiveException::class.java) {
        otherStore().importSections(bad, SshImport.ADD, SshImport.SKIP, SshImport.SKIP)
      }
      assertEquals(SettingsArchiveException.Reason.DAMAGED, error.reason)
    }
  }

  @Test
  fun theArchiveSummaryShowsThePublicLineAndNeverNeedsTheSealer() {
    val line = store.createKey("t3code-android")
    store.trust(host("box"))

    val archive = SshArchive.read(store.exportSections())

    assertEquals(line, archive.publicKeyLine)
    assertEquals(store.key()?.fingerprint(), archive.key?.fingerprint())
    assertNull(archive.config)
    assertEquals(listOf("box"), archive.knownHosts.map { it.names.single() })
  }

  @Test
  fun theWholeStoreSurvivesTheEncryptedFile() {
    val line = store.createKey("t3code-android")
    store.writeConfig("Host box\n")
    val kdf = SettingsKdf(memoryKiB = 256, iterations = 1)
    val file = SettingsArchive.seal(store.exportSections(), "pass phrase", kdf)
    val other = otherStore()

    other.importSections(
      SettingsArchive.open(file, "pass phrase"),
      SshImport.ADD,
      SshImport.ADD,
      SshImport.ADD,
    )

    assertEquals(line, other.publicKeyLine())
    assertEquals(line, other.key()?.publicKeyLine("t3code-android"))
  }

  private fun keyBase64() = Ed25519Key.generate().publicKeyLine("").split(" ")[1]
}
