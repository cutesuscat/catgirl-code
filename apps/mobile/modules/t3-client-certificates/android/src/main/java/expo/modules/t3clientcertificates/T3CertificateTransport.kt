package expo.modules.t3clientcertificates

import android.content.Context
import android.security.KeyChain
import com.facebook.react.modules.network.CustomClientBuilder
import com.facebook.react.modules.network.NetworkingModule
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.websocket.WebSocketModule
import java.io.IOException
import java.net.Socket
import java.security.KeyStore
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.Call
import okhttp3.OkHttpClient

/**
 * Process-wide transport, installed before React Native, Expo fetch, or Fresco creates a client.
 */
class T3CertificateTransport private constructor(private val context: Context) {
  internal val lock = Any()
  internal val preferences =
    context.getSharedPreferences("t3-client-certificates", Context.MODE_PRIVATE)
  internal val calls = ConcurrentHashMap<String, Call>()
  internal val sockets = ConcurrentHashMap<Socket, String>()

  // Accessed only under lock. Tokens distinguish remove/re-add and same-alias replacement.
  private val generations = CertificateGenerations()
  private val trust: X509TrustManager
  private val defaultTls: SSLContext
  private val socketFactory: SSLSocketFactory
  internal val fileClient: OkHttpClient

  init {
    val trustFactory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    trustFactory.init(null as KeyStore?)
    trust = trustFactory.trustManagers.filterIsInstance<X509TrustManager>().single()
    defaultTls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }
    socketFactory =
      OriginSocketFactory(
        defaultTls.socketFactory,
        ::identityFactory,
        { origin, socket ->
          sockets.entries.removeIf { it.key.isClosed }
          sockets[socket] = origin
        },
        lock,
        ::generation
      )
    // Networking and Fresco must not open separate caches over the same directory.
    OkHttpClientProvider.setOkHttpClientFactory(CertificateClientFactory(null))
    val customize = CustomClientBuilder { builder -> configure(builder) }
    NetworkingModule.setCustomClientBuilder(customize)
    WebSocketModule.setCustomClientBuilder(customize)
    fileClient =
      configure(OkHttpClient.Builder())
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
  }

  internal fun generation(origin: String): Any = generations.generation(origin)

  internal fun invalidate(origin: String) {
    generations.invalidate(origin)
  }

  internal fun invalidateAll() {
    generations.invalidateAll()
  }

  /** Wraps another factory so its interceptors stay while every client gets this transport. */
  private inner class CertificateClientFactory(private val inner: OkHttpClientFactory?) :
    OkHttpClientFactory {
    override fun createNewNetworkModuleClient(): OkHttpClient =
      configure(
          inner?.createNewNetworkModuleClient()?.newBuilder()
            ?: OkHttpClientProvider.createClientBuilder()
        )
        .build()
  }

  // expo-app-metrics replaces the factory from an Expo lifecycle listener after install().
  internal fun reassertFactory() {
    val current =
      runCatching {
          OkHttpClientProvider::class.java
            .getDeclaredField("factory")
            .apply { isAccessible = true }
            .get(null) as OkHttpClientFactory?
        }
        .getOrNull()
    if (current is CertificateClientFactory) return
    OkHttpClientProvider.setOkHttpClientFactory(CertificateClientFactory(current))
  }

  @Suppress("TooGenericExceptionCaught") // Any KeyChain or TLS setup failure fails the connection.
  private fun identityFactory(origin: String): SSLSocketFactory {
    val alias = resolveCertificateAlias(preferences, origin) ?: return defaultTls.socketFactory
    return try {
      val key =
        checkNotNull(KeyChain.getPrivateKey(context, alias)) {
          "Client certificate is unavailable. Select it again in Connections."
        }
      val chain =
        checkNotNull(KeyChain.getCertificateChain(context, alias)) {
          "Client certificate chain is unavailable. Select it again in Connections."
        }
      chain.forEach { it.checkValidity() }
      // Resolve the KeyChain grant on each new connection. No exported keys or TLS session
      // resumption across a removed/replaced identity.
      SSLContext
        .getInstance("TLS")
        .apply { init(arrayOf(SelectedIdentity(alias, key, chain)), arrayOf(trust), null) }
        .socketFactory
    } catch (error: Exception) {
      throw IOException("Client certificate '$alias' could not be used: ${error.message}", error)
    }
  }

  private fun configure(builder: OkHttpClient.Builder): OkHttpClient.Builder =
    builder.sslSocketFactory(socketFactory, trust).hostnameVerifier(originHostnameVerifier)

  companion object {
    @Volatile private var instance: T3CertificateTransport? = null

    @JvmStatic
    @Synchronized
    fun install(context: Context): T3CertificateTransport =
      instance ?: T3CertificateTransport(context.applicationContext).also { instance = it }

    /** Call after Expo lifecycle listeners ran, so a factory they installed is wrapped. */
    @JvmStatic
    @Synchronized
    fun reassert(context: Context) {
      install(context).reassertFactory()
    }
  }
}
