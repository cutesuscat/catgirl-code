package expo.modules.t3ssh

import com.hierynomus.sshj.key.KeyAlgorithm
import com.hierynomus.sshj.key.KeyAlgorithms
import net.schmizz.sshj.common.Factory
import net.schmizz.sshj.signature.Signature
import java.security.PrivateKey

/**
 * The SSH library signs through BouncyCastle, which needs the private key's bytes. A key kept
 * by the Android Keystore or KeyChain has none: only the system's own provider can sign with
 * it. These wrap the library's key algorithms so such a key signs with whichever provider
 * accepts it, while ordinary keys and every verification stay where they were.
 */
internal object KeystoreSigning {
  // The JCA name of the signature each SSH key algorithm makes.
  private val JCA_NAMES = mapOf(
    "ecdsa-sha2-nistp256" to "SHA256withECDSA",
    "ecdsa-sha2-nistp384" to "SHA384withECDSA",
    "ecdsa-sha2-nistp521" to "SHA512withECDSA",
    "rsa-sha2-256" to "SHA256withRSA",
    "rsa-sha2-512" to "SHA512withRSA",
  )

  // Rebuilt as the library's own factory type: it matches a key to its algorithms by that type.
  fun wrap(factories: List<Factory.Named<KeyAlgorithm>>): List<Factory.Named<KeyAlgorithm>> =
    factories.map { factory ->
      val jcaName = JCA_NAMES[factory.name]
      if (jcaName == null || factory !is KeyAlgorithms.Factory) return@map factory
      val signatures = object : Factory.Named<Signature> {
        override fun getName(): String = factory.name

        override fun create(): Signature =
          AnyProviderSignature(factory.create().newSignature(), jcaName)
      }
      KeyAlgorithms.Factory(factory.name, signatures, factory.keyType)
    }

  private class AnyProviderSignature(
    private val inner: Signature,
    private val jcaName: String
  ) : Signature by inner {
    private var system: java.security.Signature? = null

    override fun initSign(prvkey: PrivateKey) {
      // A key with bytes is an ordinary one; the library's own engine signs with it as before.
      if (prvkey.encoded != null) return inner.initSign(prvkey)
      // No provider named: the JCA then picks the one that can use this key.
      system = java.security.Signature.getInstance(jcaName).apply { initSign(prvkey) }
    }

    override fun update(H: ByteArray) = update(H, 0, H.size)

    override fun update(H: ByteArray, off: Int, len: Int) {
      system?.update(H, off, len) ?: inner.update(H, off, len)
    }

    override fun sign(): ByteArray = system?.sign() ?: inner.sign()
  }
}
