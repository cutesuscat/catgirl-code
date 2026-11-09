const { withMainApplication } = require("expo/config-plugins");

const install = "expo.modules.t3clientcertificates.T3CertificateTransport.install(this)";
const reassert = "expo.modules.t3clientcertificates.T3CertificateTransport.reassert(this)";
const lifecycle = /ApplicationLifecycleDispatcher\.onApplicationCreate\(this\)[ \t]*;?/g;

// Expo lifecycle listeners (expo-app-metrics) replace React Native's OkHttp factory after the
// early install. Re-assert right after them, wrapping theirs, or Expo fetch sends no certificate.
function reassertAfterLifecycle(source) {
  const matches = [...source.matchAll(lifecycle)];
  if (matches.length !== 1)
    throw new Error("Cannot re-assert client certificates after Expo lifecycle startup");
  const offset = matches[0].index + matches[0][0].length;
  if (source.includes(reassert)) {
    if (!source.slice(offset).trimStart().startsWith(reassert) || source.split(reassert).length !== 2)
      throw new Error(
        "Client certificate transport must be re-asserted immediately after Expo lifecycle startup",
      );
    return source;
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return source.slice(0, offset) + `${newline}    ${reassert}` + source.slice(offset);
}

function installCertificateTransport(source) {
  // Anchor to the method body, not a comment or another lifecycle method. Fail closed if
  // a future Expo template runs initialization before super.onCreate(). These hooks must
  // precede every eagerly created Expo fetch / Fresco client.
  const marker = /override fun onCreate\(\)\s*\{\s*super\.onCreate\(\)[ \t]*;?/g;
  const matches = [...source.matchAll(marker)];
  if (matches.length !== 1)
    throw new Error("Cannot install client certificates before React Native startup");
  const match = matches[0];
  const offset = match.index + match[0].length;
  if (source.includes(install)) {
    if (!source.slice(offset).trimStart().startsWith(install) || source.split(install).length !== 2)
      throw new Error(
        "Client certificate transport must be installed immediately after super.onCreate()",
      );
    return source;
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return source.slice(0, offset) + `${newline}    ${install}` + source.slice(offset);
}

function wireCertificateTransport(source) {
  return reassertAfterLifecycle(installCertificateTransport(source));
}

module.exports = (config) =>
  withMainApplication(config, (next) => {
    if (next.modResults.language !== "kt")
      throw new Error("Client certificate startup requires Kotlin MainApplication");
    next.modResults.contents = wireCertificateTransport(next.modResults.contents);
    return next;
  });
module.exports.installCertificateTransport = installCertificateTransport;
module.exports.reassertAfterLifecycle = reassertAfterLifecycle;
module.exports.wireCertificateTransport = wireCertificateTransport;
