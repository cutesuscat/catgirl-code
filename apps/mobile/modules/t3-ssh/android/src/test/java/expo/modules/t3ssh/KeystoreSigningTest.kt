package expo.modules.t3ssh

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.Closeable
import java.security.InvalidKeyException
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Provider
import java.security.PublicKey
import java.security.Security
import java.security.Signature
import java.security.SignatureSpi
import java.security.interfaces.ECKey
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.RSAKey
import java.security.interfaces.RSAPrivateKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/**
 * Stands in for the Android Keystore on the JVM: private keys with no readable bytes, which
 * only this provider can sign with. Android's own keys look the same to the SSH library.
 */
class UnreadableKeys : Provider("UnreadableKeys", 1.0, "keys only this provider can use") {
  class Ec(internal val real: ECPrivateKey) : PrivateKey, ECKey {
    override fun getAlgorithm() = "EC"

    override fun getFormat(): String? = null

    override fun getEncoded(): ByteArray? = null

    override fun getParams() = real.params
  }

  class Rsa(internal val real: RSAPrivateKey) : PrivateKey, RSAKey {
    override fun getAlgorithm() = "RSA"

    override fun getFormat(): String? = null

    override fun getEncoded(): ByteArray? = null

    override fun getModulus() = real.modulus
  }

  abstract class Signing(algorithm: String, provider: String) : SignatureSpi() {
    private val real = Signature.getInstance(algorithm, provider)

    override fun engineInitSign(key: PrivateKey) = when (key) {
      is Ec -> real.initSign(key.real)
      is Rsa -> real.initSign(key.real)
      else -> throw InvalidKeyException("not one of this provider's keys")
    }

    override fun engineInitVerify(key: PublicKey) = throw InvalidKeyException("signing only")

    override fun engineUpdate(b: Byte) = real.update(b)

    override fun engineUpdate(b: ByteArray, off: Int, len: Int) = real.update(b, off, len)

    override fun engineSign(): ByteArray = real.sign()

    override fun engineVerify(sig: ByteArray) = false

    @Deprecated("unused")
    override fun engineSetParameter(param: String, value: Any) = Unit

    @Deprecated("unused")
    override fun engineGetParameter(param: String): Any? = null
  }

  class Ecdsa256 : Signing("SHA256withECDSA", "SunEC")

  class Ecdsa384 : Signing("SHA384withECDSA", "SunEC")

  class Rsa256 : Signing("SHA256withRSA", "SunRsaSign")

  class Rsa512 : Signing("SHA512withRSA", "SunRsaSign")

  init {
    for ((name, type, keys) in listOf(
      Triple("SHA256withECDSA", Ecdsa256::class.java, Ec::class.java),
      Triple("SHA384withECDSA", Ecdsa384::class.java, Ec::class.java),
      Triple("SHA256withRSA", Rsa256::class.java, Rsa::class.java),
      Triple("SHA512withRSA", Rsa512::class.java, Rsa::class.java),
    )) {
      put("Signature.$name", type.name)
      put("Signature.$name SupportedKeyClasses", keys.name)
    }
  }
}

/** Signing in to a real sshd with keys whose private half the app cannot read. */
class KeystoreSigningTest {
  @get:Rule val tmp = TemporaryFolder()

  private val cleanup = mutableListOf<Closeable>()

  @Before
  fun setUp() {
    assumeTrue("needs OpenSSH's sshd and ssh-keygen", TestSshd.available)
    if (Security.getProvider("UnreadableKeys") == null) Security.addProvider(UnreadableKeys())
  }

  @After
  fun tearDown() {
    for (resource in cleanup.asReversed()) runCatching { resource.close() }
  }

  private fun ec(curve: String): KeyPair =
    KeyPairGenerator.getInstance("EC", "SunEC").run {
      initialize(ECGenParameterSpec(curve))
      generateKeyPair()
    }

  private fun rsa(): KeyPair =
    KeyPairGenerator.getInstance("RSA", "SunRsaSign").run {
      initialize(3072)
      generateKeyPair()
    }

  private fun unreadable(pair: KeyPair): KeyPair = KeyPair(
    pair.public,
    when (val key = pair.private) {
      is ECPrivateKey -> UnreadableKeys.Ec(key)
      is RSAPrivateKey -> UnreadableKeys.Rsa(key)
      else -> error("unexpected key")
    },
  )

  /** Signs in with `pair` and runs a command, against an sshd that knows only its public key. */
  private fun signIn(pair: KeyPair): String {
    val line = sshPublicKeyLine(pair.public, "keychain")
    val server = TestSshd(tmp.newFolder(), line).also { cleanup += it }
    val result = SshSession.connect(
      listOf(SshHop("127.0.0.1", server.port, TestSshd.user)),
      pair,
      listOf(server.knownHost()),
    )
    val session = (result as SshConnectResult.Connected).session.also { cleanup += it }
    return session.exec("echo signed-in", "", 10_000).stdout.trim()
  }

  @Test
  fun anUnreadableP256KeySignsIn() {
    val pair = unreadable(ec("secp256r1"))
    assertNull(pair.private.encoded)

    assertEquals("signed-in", signIn(pair))
  }

  @Test
  fun anUnreadableP384KeySignsIn() {
    assertEquals("signed-in", signIn(unreadable(ec("secp384r1"))))
  }

  @Test
  fun anUnreadableRsaKeySignsIn() {
    assertEquals("signed-in", signIn(unreadable(rsa())))
  }

  @Test
  fun ordinaryEcAndRsaKeysStillSignIn() {
    assertEquals("signed-in", signIn(ec("secp256r1")))
    assertEquals("signed-in", signIn(rsa()))
  }

  @Test
  fun thePublicLineIsOneSshKeygenReads() {
    for (pair in listOf(ec("secp256r1"), ec("secp384r1"), rsa())) {
      val line = sshPublicKeyLine(pair.public, "keychain")
      val file = tmp.newFile().apply { writeText(line + "\n") }

      val listed = run("ssh-keygen", "-l", "-E", "sha256", "-f", file.path).trim().split(" ")

      val blob = Base64.getDecoder().decode(line.split(" ")[1])
      assertEquals(sshFingerprint(blob), listed[1])
    }
  }
}
