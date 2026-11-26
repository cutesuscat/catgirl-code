package expo.modules.t3ssh

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class SettingsArchiveTest {
  // Small on purpose: the tests cover the format, and the real cost has its own test below.
  private val quick = SettingsKdf(memoryKiB = 256, iterations = 1, parallelism = 1)
  private val sections = linkedMapOf(
    "ssh/seed" to ByteArray(32) { it.toByte() },
    "app" to """{"machines":[{"label":"box"}]}""".toByteArray(),
    "empty" to ByteArray(0),
  )

  private fun sealed(passphrase: String = "correct horse") =
    SettingsArchive.seal(sections, passphrase, quick)

  private fun reason(block: () -> Unit) =
    assertThrows(SettingsArchiveException::class.java) { block() }.reason

  private fun lines(file: ByteArray) = String(file, Charsets.US_ASCII).trimEnd().split("\n")

  private fun withLine(file: ByteArray, index: Int, change: (String) -> String): ByteArray {
    val changed = lines(file).toMutableList().also { it[index] = change(it[index]) }
    return changed.joinToString("") { "$it\n" }.toByteArray(Charsets.US_ASCII)
  }

  @Test
  fun aFileOpensWithItsPassphraseAndGivesEverySectionBack() {
    val opened = SettingsArchive.open(sealed(), "correct horse")

    assertEquals(sections.keys.toList(), opened.keys.toList())
    for ((name, value) in sections) assertArrayEquals(value, opened[name])
  }

  @Test
  fun theFileSaysWhatItIsAndShowsNothingOfItsContent() {
    val file = sealed()
    val text = String(file, Charsets.US_ASCII)

    assertEquals("catgirl-code-settings 1", lines(file)[0])
    assertTrue(lines(file)[1].startsWith("argon2id m=256 t=1 p=1 salt="))
    assertTrue(lines(file)[2].startsWith("aes-256-gcm nonce="))
    assertEquals(4, lines(file).size)
    assertFalse(text.contains("machines"))
    assertFalse(text.contains(Base64.getEncoder().encodeToString(sections.getValue("ssh/seed"))))
  }

  @Test
  fun twoExportsOfTheSameSettingsShareNoSaltNonceOrBody() {
    val first = lines(sealed())
    val second = lines(sealed())

    for (index in 1..3) assertNotEquals(first[index], second[index])
  }

  @Test
  fun aWrongPassphraseIsNamedAsSuch() {
    val file = sealed()

    assertEquals(
      SettingsArchiveException.Reason.WRONG_PASSPHRASE,
      reason { SettingsArchive.open(file, "correct horsf") },
    )
    assertEquals(
      SettingsArchiveException.Reason.PASSPHRASE_MISSING,
      reason { SettingsArchive.open(file, "") },
    )
    assertEquals(
      SettingsArchiveException.Reason.PASSPHRASE_MISSING,
      reason { SettingsArchive.seal(sections, "", quick) },
    )
  }

  @Test
  fun thePassphraseIsTheSameHoweverItsAccentsWereTyped() {
    val file = SettingsArchive.seal(sections, "café", quick)

    assertEquals(sections.keys, SettingsArchive.open(file, "café").keys)
  }

  @Test
  fun aChangedBodyIsDamagedNotAWrongPassphrase() {
    val file = sealed()
    val flipped = withLine(file, 3) { body ->
      val bytes = Base64.getDecoder().decode(body)
      bytes[bytes.size / 2] = (bytes[bytes.size / 2].toInt() xor 1).toByte()
      Base64.getEncoder().encodeToString(bytes)
    }
    val cut = withLine(file, 3) { it.dropLast(8) }
    val notBase64 = withLine(file, 3) { "!$it" }

    for (damaged in listOf(flipped, cut, notBase64)) {
      assertEquals(
        SettingsArchiveException.Reason.DAMAGED,
        reason { SettingsArchive.open(damaged, "correct horse") },
      )
    }
  }

  @Test
  fun theHeaderIsAuthenticatedToo() {
    // A nonce swapped for another valid one still passes the passphrase check, then fails.
    val file = sealed()
    val other = lines(sealed())[2].substringAfter("nonce=").substringBefore(" ")
    val swapped = withLine(file, 2) { line ->
      line.replace(Regex("nonce=\\S+"), "nonce=$other")
    }

    assertEquals(
      SettingsArchiveException.Reason.DAMAGED,
      reason { SettingsArchive.open(swapped, "correct horse") },
    )
  }

  @Test
  fun aMissingLineOrFieldIsDamaged() {
    val file = sealed()
    val threeLines = lines(file).take(3).joinToString("") { "$it\n" }.toByteArray()
    val noSalt = withLine(file, 1) { it.substringBefore(" salt=") }
    val wrongKdf = withLine(file, 1) { it.replace("argon2id", "scrypt") }
    val zeroPasses = withLine(file, 1) { it.replace("t=1", "t=0") }

    for (damaged in listOf(threeLines, noSalt, wrongKdf, zeroPasses)) {
      assertEquals(SettingsArchiveException.Reason.DAMAGED, reason { SettingsArchive.check(damaged) })
    }
  }

  @Test
  fun changedLineEndingsAndTrailingSpaceDoNotMatter() {
    val text = String(sealed(), Charsets.US_ASCII)
    val windows = text.replace("\n", "\r\n").toByteArray()
    val padded = ("\n" + text.replace("\n", "  \n") + "\n\n").toByteArray()

    assertEquals(sections.keys, SettingsArchive.open(windows, "correct horse").keys)
    assertEquals(sections.keys, SettingsArchive.open(padded, "correct horse").keys)
  }

  @Test
  fun otherFilesAreNotSettingsFiles() {
    val candidates = listOf(
      ByteArray(0),
      "hello\n".toByteArray(),
      ByteArray(4096) { (it * 31).toByte() },
      "catgirl-code-settings\n".toByteArray(),
      "catgirl-code-settings one\n".toByteArray(),
      "-----BEGIN OPENSSH PRIVATE KEY-----\n".toByteArray(),
      ByteArray(SettingsArchive.MAX_FILE_BYTES + 1) { 'a'.code.toByte() },
    )

    for (candidate in candidates) {
      assertEquals(
        SettingsArchiveException.Reason.NOT_A_SETTINGS_FILE,
        reason { SettingsArchive.check(candidate) },
      )
    }
  }

  @Test
  fun aNewerVersionAsksForAnUpdateAndAnImpossibleOneIsDamaged() {
    val file = sealed()
    val newer = withLine(file, 0) { "catgirl-code-settings 2" }
    val zero = withLine(file, 0) { "catgirl-code-settings 0" }

    assertEquals(
      SettingsArchiveException.Reason.NEWER_VERSION,
      reason { SettingsArchive.check(newer) },
    )
    assertEquals(
      SettingsArchiveException.Reason.NEWER_VERSION,
      reason { SettingsArchive.open(newer, "correct horse") },
    )
    assertEquals(SettingsArchiveException.Reason.DAMAGED, reason { SettingsArchive.check(zero) })
  }

  @Test
  fun aFileAskingForTooMuchMemoryIsRefusedBeforeAnyWorkIsDone() {
    val greedy = withLine(sealed(), 1) { it.replace("m=256", "m=4194304") }

    assertEquals(
      SettingsArchiveException.Reason.TOO_MUCH_MEMORY,
      reason { SettingsArchive.check(greedy) },
    )
  }

  @Test
  fun aFileWrittenWithAnotherCostStillOpens() {
    val file = SettingsArchive.seal(sections, "pw", SettingsKdf(512, 2, 2))

    assertEquals(sections.keys, SettingsArchive.open(file, "pw").keys)
  }

  // A file made once and kept here: a later change that cannot read it breaks every export
  // already saved. The cost is the one the app writes.
  @Test
  fun aVersionOneFileFromTheFirstReleaseStillOpens() {
    val opened = SettingsArchive.open(FIRST_RELEASE_FILE.toByteArray(), "catgirl settings test")

    assertEquals("""{"hello":"from v1"}""", opened.getValue("app").toString(Charsets.UTF_8))
    assertArrayEquals(ByteArray(32) { (it + 1).toByte() }, opened.getValue("ssh/seed"))
  }

  @Test
  fun theDefaultCostIsMemoryHard() {
    val file = SettingsArchive.seal(mapOf("app" to "{}".toByteArray()), "pw")

    assertTrue(lines(file)[1].startsWith("argon2id m=65536 t=3 p=1 salt="))
    assertEquals(setOf("app"), SettingsArchive.open(file, "pw").keys)
  }

  private companion object {
    // Made by a second implementation of the format (not this code), with a throwaway seed.
    val FIRST_RELEASE_FILE = listOf(
      "catgirl-code-settings 1",
      "argon2id m=65536 t=3 p=1 salt=5U82pgthf31dffNGyIbOKg==",
      "aes-256-gcm nonce=elmId9wkSBKfWSIH check=sy49oLCtLHw=",
      "8mhQeoDRzmJaCz1B/gQQMp297DwUpgNnKc+dM6szCAiKzrEWl2R0OfV9d2vhu9o9" +
        "4EHr4U26DFccqHU+S4EtIOPHSIk7OTqUDeEWKxmRI21CojOmq+g7+4T8",
    ).joinToString("\n")
  }
}
