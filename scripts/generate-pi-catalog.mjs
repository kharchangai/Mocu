/*
 * Generator for src/extensions/services/pi-node-files.ts.
 *
 * Reads the pi-node example extension and embeds its text files (manifest,
 * entry, package.json and the vendored @mocu packages) as string literals so
 * the Extensions catalog can install it with one click — the installed copy
 * then runs `npm install` to fetch @earendil-works/pi-coding-agent.
 *
 * Usage: node scripts/generate-pi-catalog.mjs   (from the repository root)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "extensions-examples/pi-node";

const wanted = [
  "manifest.json",
  "package.json",
  "index.js",
  "vendor/extension-sdk/package.json",
  "vendor/extension-sdk/dist/index.js",
  "vendor/extension-sdk/dist/extension.js",
  "vendor/extension-sdk/dist/decision.js",
  "vendor/extension-sdk/dist/embedding.js",
  "vendor/extension-sdk/dist/llm.js",
  "vendor/extension-sdk/dist/protocol-client.js",
  "vendor/extension-sdk/dist/types.js",
  "vendor/extension-sdk/dist/ui.js",
  "vendor/extension-contracts/package.json",
  "vendor/extension-contracts/dist/index.js",
  "vendor/extension-contracts/dist/decision.js",
  "vendor/extension-contracts/dist/embedding.js",
  "vendor/extension-contracts/dist/llm.js",
  "vendor/extension-contracts/dist/manifest.js",
  "vendor/extension-contracts/dist/protocol.js",
];

const entries = wanted.map((relativePath) => ({
  path: relativePath,
  content: readFileSync(join(root, relativePath), "utf8"),
}));

const output = `/*
 * Generated file — do not edit by hand.
 *
 * Regenerate with: node scripts/generate-pi-catalog.mjs
 * (reads extensions-examples/pi-node and embeds its text files so the
 * Extensions catalog can one-click-install the pi Agent extension; the
 * installer runs \`npm install\` afterwards to fetch the pi SDK.)
 */
import type {
  CatalogFile,
} from "./extension-catalog";

export const PI_NODE_CATALOG_FILES: CatalogFile[] = ${JSON.stringify(entries, null, 2)};
`;

writeFileSync("src/extensions/services/pi-node-files.ts", output);
console.log(`Wrote src/extensions/services/pi-node-files.ts (${entries.length} files embedded).`);
