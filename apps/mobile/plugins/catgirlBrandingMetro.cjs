"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadHashSource, rebrandCatalogFile } = require("../../../scripts/lib/catgirl-branding.ts");

const mobileRoot = path.resolve(__dirname, "..");
const catalogRoot = path.join(mobileRoot, "src", "i18n", "translations");
const renamedRoot = path.join(mobileRoot, ".generated", "catgirl-translations");

function writeFileIfChanged(filePath, contents) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === contents) return;
  fs.writeFileSync(filePath, contents, "utf8");
}

// Metro does not pass JSON through Babel, so the plugin beside this one cannot reach the
// translation catalogs. They are written out renamed, before Metro lists the project's files,
// and the resolver serves those copies in place of the committed ones.
module.exports = function withCatgirlTranslations(config) {
  const hashSource = loadHashSource(path.join(mobileRoot, "package.json"));
  fs.mkdirSync(renamedRoot, { recursive: true });
  for (const name of fs.readdirSync(catalogRoot)) {
    const file = path.join(catalogRoot, name);
    const renamed = rebrandCatalogFile(file, fs.readFileSync(file, "utf8"), hashSource, (key) =>
      console.warn(`catgirl-branding: ${name}: ${key} keeps its English text`),
    );
    writeFileIfChanged(path.join(renamedRoot, name), renamed);
  }

  const resolveRequest = config.resolver?.resolveRequest;
  config.resolver = {
    ...config.resolver,
    resolveRequest(context, moduleName, platform) {
      const resolve = resolveRequest ?? context.resolveRequest;
      const resolution = resolve(context, moduleName, platform);
      return resolution.type === "sourceFile" && path.dirname(resolution.filePath) === catalogRoot
        ? { ...resolution, filePath: path.join(renamedRoot, path.basename(resolution.filePath)) }
        : resolution;
    },
  };
  return config;
};
