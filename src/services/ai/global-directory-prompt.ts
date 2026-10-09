import { appDataDir } from "@tauri-apps/api/path";

/**
 * Gives an agent the runtime-resolved root of Mocu's global application data.
 * This is distinct from the active project's directory.
 */
export async function buildGlobalDirectoryPrompt(): Promise<string> {
  let globalDirectory: string;
  try {
    globalDirectory = await appDataDir();
  } catch {
    // Unit tests and non-Tauri callers may not have the runtime path API.
    return [
      "MOCU GLOBAL DIRECTORY",
      "The global Mocu application-data directory is Tauri's BaseDirectory.AppData (resolve its absolute path with appDataDir() at runtime).",
      "This is separate from the active project's directory. For global user resources, use this root and the relevant subfolder: agents/, skills/, extensions/, docs/, or notes/. Do not substitute the project directory or invent a different global path.",
    ].join("\n");
  }

  return [
    "MOCU GLOBAL DIRECTORY",
    `The global Mocu application-data directory (resolved at runtime by Tauri appDataDir) is: ${globalDirectory}`,
    "This is separate from the active project's directory. For global user resources, use this absolute root and the relevant subfolder: agents/, skills/, extensions/, docs/, or notes/. Do not substitute the project directory or invent a different global path.",
  ].join("\n");
}
