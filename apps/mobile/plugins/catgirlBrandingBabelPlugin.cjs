"use strict";

// Renames the product in every string the bundle shows, shared packages included, so upstream's
// copy needs no edits. \s+ also covers a name that JSX text wraps across two lines.
const OLD_NAME = /T3\s+(?:Code|Connect)\b/;
const rename = (text) => text.replace(/T3(\s+)(Code|Connect)\b/g, "Catgirl$1$2");

module.exports = function catgirlBrandingBabelPlugin() {
  return {
    name: "catgirl-branding",
    visitor: {
      StringLiteral(path) {
        if (!OLD_NAME.test(path.node.value)) return;
        path.node.value = rename(path.node.value);
        delete path.node.extra;
      },
      JSXText(path) {
        if (!OLD_NAME.test(path.node.value)) return;
        path.node.value = rename(path.node.value);
        delete path.node.extra;
      },
      TemplateElement(path) {
        const { raw, cooked } = path.node.value;
        if (!OLD_NAME.test(raw)) return;
        path.node.value = { raw: rename(raw), cooked: cooked == null ? cooked : rename(cooked) };
      },
    },
  };
};
