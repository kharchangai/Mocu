import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mocuDir = resolve(projectDir, "..", "..");
const sources = [
  {
    source: join(mocuDir, "extension-system", "sdk-node", "dist"),
    target: join(projectDir, "vendor", "mocu-sdk", "dist"),
    bundledImport: "../../mocu-contracts/dist/index.js",
    replaceContracts: true,
  },
  {
    source: join(mocuDir, "extension-system", "contracts", "dist"),
    target: join(projectDir, "vendor", "mocu-contracts", "dist"),
    replaceContracts: false,
  },
];

for (const item of sources) {
  await readdir(item.source);
  await rm(item.target, { recursive: true, force: true });
  await mkdir(item.target, { recursive: true });
  await cp(item.source, item.target, { recursive: true });

  if (!item.replaceContracts) continue;
  for (const file of await readdir(item.target)) {
    if (!file.endsWith(".js")) continue;
    const path = join(item.target, file);
    const source = await readFile(path, "utf8");
    await writeFile(path, source.replaceAll('"@mocu/extension-contracts"', `"${item.bundledImport}"`));
  }
}

const entryPath = join(projectDir, "index.js");
const entry = await readFile(entryPath, "utf8");
await writeFile(entryPath, entry.replaceAll(
  '"@mocu/extension-sdk"',
  '"./vendor/mocu-sdk/dist/index.js"',
));

console.log("Vendored the local Mocu Node SDK and extension contracts.");
