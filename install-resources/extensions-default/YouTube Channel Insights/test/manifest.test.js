import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manifest.json has the required fields", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

  assert.equal(manifest.manifestVersion, 1);
  assert.ok(manifest.id, "id is required");
  assert.ok(manifest.name, "name is required");
  assert.ok(manifest.description, "description is required");
  assert.ok(manifest.version, "version is required");
  assert.equal(manifest.runtime, "node");
  assert.equal(manifest.entry, "index.js");
});

test("every manifest command has an id and title", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

  for (const command of manifest.commands ?? []) {
    assert.ok(command.id, "command id is required");
    assert.ok(command.title, `command ${command.id} needs a title`);
  }
});
