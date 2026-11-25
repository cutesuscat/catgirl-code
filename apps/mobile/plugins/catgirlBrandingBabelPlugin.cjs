"use strict";

// Renames the product in every string the bundle shows, shared packages included, so upstream's
// copy needs no edits. The names and what keeps upstream's are decided in the shared module.
const { KEPT_TEXT, renameProduct } = require("../../../scripts/lib/catgirl-branding.ts");

module.exports = function catgirlBrandingBabelPlugin() {
  return {
    name: "catgirl-branding",
    visitor: {
      Program(_path, state) {
        // Kept text is matched in source text, which a string node no longer has.
        const file = String(state.filename ?? "").replaceAll("\\", "/");
        if (KEPT_TEXT.some(([suffix]) => file.endsWith(`/${suffix}`))) {
          throw new Error(`${file} has text that must keep its name; rename it by source text.`);
        }
      },
      StringLiteral(path) {
        const renamed = renameProduct(path.node.value);
        if (renamed === path.node.value) return;
        path.node.value = renamed;
        delete path.node.extra;
      },
      JSXText(path) {
        const renamed = renameProduct(path.node.value);
        if (renamed === path.node.value) return;
        path.node.value = renamed;
        delete path.node.extra;
      },
      TemplateElement(path) {
        const { raw, cooked } = path.node.value;
        const renamed = renameProduct(raw);
        if (renamed === raw) return;
        path.node.value = { raw: renamed, cooked: cooked == null ? cooked : renameProduct(cooked) };
      },
    },
  };
};
