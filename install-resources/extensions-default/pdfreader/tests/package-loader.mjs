import path from "node:path";
import { pathToFileURL } from "node:url";

const packageFiles = new Map([
  ["@mocu/extension-sdk", "vendor/extension-sdk/dist/index.js"],
  ["@mocu/extension-contracts", "vendor/extension-contracts/dist/index.js"],
]);

export async function resolve(specifier, context, nextResolve) {
  const target = packageFiles.get(specifier);
  if (target) return { url: pathToFileURL(path.resolve(target)).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
