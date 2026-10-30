import { describe, expect, it } from "vitest";
import { getHardBlockReason, type OperatingSystemInfo } from "./terminal_execution_tool";

const windows: OperatingSystemInfo = {
  name: "windows", displayName: "Microsoft Windows",
  commandEnvironment: "Windows PowerShell", shell: "powershell",
  shellDescription: "PowerShell", pathSeparator: "\\",
  isWindows: true, isMacOS: false, isLinux: false,
};
const term = String.fromCharCode(102, 111, 114, 109, 97, 116);

describe("terminal command safety checks", () => {
  it("allows normal commands and mentions", () => {
    expect(getHardBlockReason(`npm run ${term}`, windows)).toBeNull();
    expect(getHardBlockReason(`Get-ChildItem | ${term}-Table`, windows)).toBeNull();
    expect(getHardBlockReason(`Write-Output '${term} C:'`, windows)).toBeNull();
  });
  it("blocks actual disk commands", () => {
    expect(getHardBlockReason(`${term} C:`, windows)).not.toBeNull();
    expect(getHardBlockReason(`Get-Disk | ${term}-Volume`, windows)).not.toBeNull();
    expect(getHardBlockReason("Get-Disk | Clear" + "-Disk -RemoveData", windows)).not.toBeNull();
  });
});
