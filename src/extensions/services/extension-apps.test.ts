import { describe, expect, it } from "vitest";

import { isSafeExtensionAppEntry, parseExtensionApp } from "./extension-apps";

describe("extension app manifest parsing", () => {
  it("accepts nested relative app entry points", () => {
    expect(parseExtensionApp({ entry: "ui/index.html", title: "Dashboard" })).toEqual({
      entry: "ui/index.html",
      title: "Dashboard",
    });
  });

  it.each([
    "../outside.html",
    "ui/../../secret.html",
    "/absolute.html",
    "C:/temp/app.html",
    "C:\\temp\\app.html",
    "https://example.test/app",
    "ui/index.html?x=1",
    "./index.html",
  ])("rejects unsafe app path %s", (entry) => {
    expect(isSafeExtensionAppEntry(entry)).toBe(false);
    expect(parseExtensionApp({ entry })).toBeUndefined();
  });
});
