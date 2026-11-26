package expo.modules.t3ssh

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.schmizz.sshj.common.SSHRuntimeException
import net.schmizz.sshj.userauth.UserAuthException
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.GeneralSecurityException
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class SshHopRecord : Record {
  @Field val host: String = ""

  @Field val port: Int = 22

  @Field val user: String = ""

  @Field val hostKeyAlias: String? = null
}

/**
 * SSH for the app's SSH environments. The private key never leaves this module: JavaScript
 * sees the public line, fingerprints and session ids.
 */
class T3SshModule : Module() {
  private val sessions = ConcurrentHashMap<String, SshSession>()

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val store: SshStore by lazy {
    SshStore(File(context.noBackupFilesDir, "t3-ssh"), KeystoreSealer)
  }

  /** A settings file the user picked: its bytes, and its sections once the passphrase opened it. */
  private class SettingsFile(val bytes: ByteArray) {
    @Volatile var sections: Map<String, ByteArray>? = null

    fun wipe() {
      bytes.fill(0)
      sections?.values?.forEach { it.fill(0) }
      sections = null
    }
  }

  private val settingsFiles = ConcurrentHashMap<String, SettingsFile>()

  @Volatile private var pendingPick: CompletableDeferred<Uri?>? = null

  // Expo only picks the zero-argument Coroutine overload when the empty arrow is written out,
  // and ktlint's function-literal rule removes it.
  @Suppress("ktlint:standard:function-literal")
  override fun definition() = ModuleDefinition {
    Name("T3Ssh")

    OnDestroy {
      for (session in sessions.values) session.close()
      sessions.clear()
      for (file in settingsFiles.values) file.wipe()
      settingsFiles.clear()
      pendingPick?.complete(null)
    }

    OnActivityResult { _, (requestCode, resultCode, intent) ->
      if (requestCode == PICK_REQUEST) {
        pendingPick?.complete(intent?.data?.takeIf { resultCode == Activity.RESULT_OK })
      }
    }

    // Seals this module's SSH state and the app's own settings (JSON it alone reads) into one
    // file, then asks the system where to save it. Nothing unencrypted is written anywhere.
    AsyncFunction("exportSettings") Coroutine { passphrase: String, app: String, name: String ->
      val sections = io { store.exportSections() + (APP_SECTION to app.toByteArray()) }
      val sealed = io { SettingsArchive.seal(sections, passphrase) }
      sections[SshSections.SEED]?.fill(0)
      val uri = pick(
        Intent(Intent.ACTION_CREATE_DOCUMENT)
          .addCategory(Intent.CATEGORY_OPENABLE)
          .setType("application/octet-stream")
          .putExtra(Intent.EXTRA_TITLE, name),
      )
      if (uri == null) {
        mapOf("status" to "cancelled")
      } else {
        io { write(uri, sealed) }
        mapOf(
          "status" to "saved",
          "name" to (displayName(uri) ?: name),
          "sshKey" to sections.containsKey(SshSections.SEED),
        )
      }
    }

    AsyncFunction("pickSettingsFile") Coroutine { ->
      val uri = pick(
        Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),
      )
      if (uri == null) {
        mapOf("status" to "cancelled")
      } else {
        io {
          val bytes = read(uri)
          SettingsArchive.check(bytes)
          val id = UUID.randomUUID().toString()
          settingsFiles[id] = SettingsFile(bytes)
          mapOf("status" to "picked", "id" to id, "name" to (displayName(uri) ?: ""))
        }
      }
    }

    AsyncFunction("openSettingsFile") Coroutine { id: String, passphrase: String ->
      io {
        val file = settingsFile(id)
        val sections = SettingsArchive.open(file.bytes, passphrase)
        val ssh = SshArchive.read(sections)
        file.sections = sections
        mapOf(
          "key" to ssh.publicKeyLine?.let(::publicKeyInfo),
          "config" to ssh.config,
          "knownHosts" to ssh.knownHosts.map(::knownHostInfo),
          "app" to sections[APP_SECTION]?.toString(Charsets.UTF_8),
        )
      }
    }

    AsyncFunction("importSshSettings") Coroutine {
        id: String,
        key: String,
        config: String,
        hosts: String
      ->
      io {
        val sections = settingsFile(id).sections
          ?: throw CodedException("ERR_SETTINGS_LOCKED", "Enter the passphrase first.", null)
        val result = store.importSections(
          sections,
          SshImport.valueOf(key.uppercase()),
          SshImport.valueOf(config.uppercase()),
          SshImport.valueOf(hosts.uppercase()),
        )
        mapOf(
          "keyImported" to result.keyImported,
          "configImported" to result.configImported,
          "knownHostsAdded" to result.knownHostsAdded,
          "knownHostsKept" to result.knownHostsKept,
        )
      }
    }

    AsyncFunction("closeSettingsFile") Coroutine { id: String ->
      io { settingsFiles.remove(id)?.wipe() }
    }

    AsyncFunction("getPublicKey") Coroutine { ->
      io { store.publicKeyLine()?.let(::publicKeyInfo) }
    }

    AsyncFunction("createKey") Coroutine { comment: String ->
      io { publicKeyInfo(store.createKey(comment)) }
    }

    AsyncFunction("deleteKey") Coroutine { ->
      io { store.deleteKey() }
    }

    AsyncFunction("readConfig") Coroutine { ->
      io { store.readConfig() }
    }

    AsyncFunction("writeConfig") Coroutine { text: String ->
      io { store.writeConfig(text) }
    }

    AsyncFunction("listKnownHosts") Coroutine { ->
      io { store.knownHosts().map(::knownHostInfo) }
    }

    AsyncFunction("trustHostKey") Coroutine { line: String ->
      io { store.trust(line) }
    }

    AsyncFunction("forgetHostKey") Coroutine { line: String ->
      io { store.forget(line) }
    }

    AsyncFunction("connect") Coroutine { hops: List<SshHopRecord> ->
      io { connect(hops) }
    }

    AsyncFunction("exec") Coroutine { id: String, command: String, stdin: String, ms: Double ->
      io {
        val result = session(id).exec(command, stdin, ms.toLong())
        mapOf("exitCode" to result.exitCode, "stdout" to result.stdout, "stderr" to result.stderr)
      }
    }

    AsyncFunction("forward") Coroutine { sessionId: String, remotePort: Int ->
      io { session(sessionId).forward(remotePort) }
    }

    Function("isOpen") { sessionId: String -> sessions[sessionId]?.isOpen == true }

    AsyncFunction("close") Coroutine { sessionId: String ->
      io { sessions.remove(sessionId)?.close() }
    }
  }

  private fun connect(hops: List<SshHopRecord>): Map<String, Any?> {
    val key =
      store.key() ?: throw CodedException("ERR_SSH_NO_KEY", "Create an SSH key first.", null)
    sessions.entries.removeIf { (_, session) ->
      val dead = !session.isOpen
      if (dead) session.close()
      dead
    }
    val result = SshSession.connect(
      hops.map { SshHop(it.host, it.port, it.user, it.hostKeyAlias) },
      key.toKeyPair(),
      store.knownHosts(),
    )
    return when (result) {
      is SshConnectResult.Connected -> {
        val id = UUID.randomUUID().toString()
        sessions[id] = result.session
        mapOf("status" to "connected", "sessionId" to id)
      }
      is SshConnectResult.Rejected -> with(result.rejection) {
        mapOf(
          "status" to "host-key-rejected",
          "host" to hop.host,
          "port" to hop.port,
          "knownHostsName" to hop.knownHostsName,
          "keyType" to keyType,
          "fingerprint" to fingerprint,
          "knownHostsLine" to knownHostsLine,
          "changed" to changed,
        )
      }
    }
  }

  private fun settingsFile(id: String): SettingsFile = settingsFiles[id]
    ?: throw CodedException("ERR_SETTINGS_CLOSED", "Choose the settings file again.", null)

  /** Shows a system document picker and waits for the document it returns, or null. */
  private suspend fun pick(intent: Intent): Uri? {
    val activity = appContext.currentActivity
      ?: throw CodedException("ERR_SETTINGS_PICKER", "Open this screen in the foreground.", null)
    if (pendingPick != null) {
      throw CodedException("ERR_SETTINGS_PICKER", "A file picker is already open.", null)
    }
    val picked = CompletableDeferred<Uri?>()
    pendingPick = picked
    try {
      withContext(Dispatchers.Main) { activity.startActivityForResult(intent, PICK_REQUEST) }
      return picked.await()
    } catch (error: ActivityNotFoundException) {
      throw CodedException("ERR_SETTINGS_PICKER", "This device has no file picker.", error)
    } finally {
      pendingPick = null
    }
  }

  private fun read(uri: Uri): ByteArray {
    val input = context.contentResolver.openInputStream(uri)
      ?: throw IOException("Could not open the file.")
    // One byte past the limit is enough to tell an oversized pick from a settings file.
    val limit = SettingsArchive.MAX_FILE_BYTES + 1
    val bytes = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    input.use {
      while (bytes.size() < limit) {
        val read = it.read(buffer, 0, minOf(buffer.size, limit - bytes.size()))
        if (read < 0) break
        bytes.write(buffer, 0, read)
      }
    }
    return bytes.toByteArray()
  }

  private fun write(uri: Uri, bytes: ByteArray) {
    try {
      val output = context.contentResolver.openOutputStream(uri, "wt")
        ?: throw IOException("Could not write the file.")
      output.use { it.write(bytes) }
    } catch (error: IOException) {
      // Leave no empty or half-written file behind where the user chose to save.
      runCatching { DocumentsContract.deleteDocument(context.contentResolver, uri) }
      throw error
    }
  }

  private fun displayName(uri: Uri): String? = runCatching {
    context.contentResolver
      .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
  }.getOrNull()

  private fun session(id: String): SshSession =
    sessions[id]?.takeIf { it.isOpen }
      ?: throw CodedException("ERR_SSH_SESSION_CLOSED", "The SSH connection closed.", null)

  private fun knownHostInfo(entry: KnownHost): Map<String, Any> = mapOf(
    "line" to entry.line,
    "names" to entry.names,
    "keyType" to entry.keyType,
    "fingerprint" to sshFingerprint(Base64.getDecoder().decode(entry.keyBase64)),
  )

  private fun publicKeyInfo(line: String): Map<String, String> {
    val blob = Base64.getDecoder().decode(line.split(Regex("\\s+"))[1])
    return mapOf("line" to line, "fingerprint" to sshFingerprint(blob))
  }

  private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) {
    try {
      block()
    } catch (error: SettingsArchiveException) {
      throw CodedException(error.reason.code, error.message, error)
    } catch (error: UserAuthException) {
      throw CodedException("ERR_SSH_AUTH", "The server did not accept this device's key.", error)
    } catch (error: UnknownHostException) {
      throw unreachable(error)
    } catch (error: ConnectException) {
      throw unreachable(error)
    } catch (error: NoRouteToHostException) {
      throw unreachable(error)
    } catch (error: SocketTimeoutException) {
      throw unreachable(error)
    } catch (error: IOException) {
      throw failure(error)
    } catch (error: GeneralSecurityException) {
      throw failure(error)
    } catch (error: SSHRuntimeException) {
      throw failure(error)
    } catch (error: IllegalArgumentException) {
      throw failure(error)
    } catch (error: IllegalStateException) {
      throw failure(error)
    }
  }

  private companion object {
    const val APP_SECTION = "app"
    const val PICK_REQUEST = 4721
  }

  private fun unreachable(error: Exception) =
    CodedException("ERR_SSH_UNREACHABLE", error.message ?: error.javaClass.simpleName, error)

  private fun failure(error: Exception) =
    CodedException("ERR_SSH", error.message ?: error.javaClass.simpleName, error)
}
