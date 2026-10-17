import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = resolve(extensionDir, "..", "..", "..");
const sdkSourceDir = resolve(
  process.env.MOCU_EXTENSION_SYSTEM_DIR ?? join(repositoryDir, "install-resources", "extension-system"),
);

const packages = [
  {
    source: join(sdkSourceDir, "sdk-node"),
    target: join(extensionDir, "vendor", "extension-sdk"),
    dependencyOverrides: {
      "@mocu/extension-contracts": "file:../extension-contracts",
    },
  },
  {
    source: join(sdkSourceDir, "contracts"),
    target: join(extensionDir, "vendor", "extension-contracts"),
  },
];

// Validate all sources before changing any of the checked-in vendor files.
for (const item of packages) {
  await readFile(join(item.source, "package.json"), "utf8");
  await readFile(join(item.source, "dist", "index.js"), "utf8");
}

for (const item of packages) {
  const packageJson = JSON.parse(await readFile(join(item.source, "package.json"), "utf8"));
  if (item.dependencyOverrides) {
    packageJson.dependencies = {
      ...packageJson.dependencies,
      ...item.dependencyOverrides,
    };
  }
  // The extension uses the prebuilt runtime only; do not pull SDK build tooling.
  delete packageJson.devDependencies;
  delete packageJson.scripts;

  await mkdir(item.target, { recursive: true });
  const distTarget = join(item.target, "dist");
  await rm(distTarget, { recursive: true, force: true });
  await cp(join(item.source, "dist"), distTarget, { recursive: true });
  await writeFile(join(item.target, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

console.log("Vendored the current Mocu Node SDK and extension contracts.");
