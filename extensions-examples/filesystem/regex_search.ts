import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LINE_CHARS = 10_000;
const MAX_PATTERN_CHARS = 256;

export type SearchResult = {
  file_name: string;
  path: string;
  text: string;
  line_start: number;
  line_end: number;
};

export function search(folder: string, patterns: string[], extensions: string[]): SearchResult[] {
  const root = realpathSync(folder);
  if (!statSync(root).isDirectory()) throw new Error("folder must be a directory");
  if (!Array.isArray(patterns) || patterns.length === 0 ||
      patterns.some((p) => typeof p !== "string" || p.length === 0 || p.length > MAX_PATTERN_CHARS)) {
    throw new Error("patterns must be a nonempty list of nonempty strings (up to 256 characters each)");
  }
  if (!Array.isArray(extensions) || extensions.length === 0 ||
      extensions.some((e) => typeof e !== "string" || !/^\.?[a-zA-Z0-9]+$/.test(e))) {
    throw new Error("extensions must be a nonempty list like ['.txt', '.ts']");
  }

  const compiled = patterns.map((pattern) => new RegExp(pattern, "g"));
  const allowed = new Set(extensions.map((e) => `.${e.replace(/^\./, "").toLowerCase()}`));
  const results: SearchResult[] = [];

  function sectionHasMatch(lines: string[]): boolean {
    return lines.some((line) => {
      if (line.length > MAX_LINE_CHARS) return false;
      return compiled.some((regex) => {
        regex.lastIndex = 0;
        return Array.from(line.matchAll(regex)).some((match) => match[0].length > 0);
      });
    });
  }

  function visit(directory: string): void {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(filePath);
        continue;
      }
      if (!entry.isFile() || !allowed.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        if (lstatSync(filePath).size > MAX_FILE_BYTES) continue;
        const content = readFileSync(filePath, "utf8");
        const lines = content.split(/\r?\n/);
        let sectionLines: string[] = [];
        let sectionStart = 0;

        const addSection = (endIndex: number) => {
          if (sectionLines.length > 0 && sectionHasMatch(sectionLines)) {
            results.push({
              file_name: entry.name,
              path: filePath,
              text: sectionLines.join("\n"),
              line_start: sectionStart + 1,
              line_end: endIndex,
            });
          }
          sectionLines = [];
        };

        for (let index = 0; index < lines.length; index++) {
          if (lines[index].trim() === "") {
            addSection(index);
          } else {
            if (sectionLines.length === 0) sectionStart = index;
            sectionLines.push(lines[index]);
          }
        }
        addSection(lines.length);
      } catch (error) {
        console.error(`Skipped ${filePath}: ${String(error)}`);
      }
    }
  }

  visit(root);
  return results;
}

function parseArgs(args: string[]): { folder: string; patterns: string[]; extensions: string[] } {
  const [folder, ...options] = args;
  if (!folder) throw new Error("Usage: node regex_search.ts <folder> --pattern <regex> --ext <extension>");
  const patterns: string[] = [];
  const extensions: string[] = [];
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    const value = options[++i];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === "--pattern") patterns.push(value);
    else if (option === "--ext") extensions.push(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!patterns.length || !extensions.length) throw new Error("Provide at least one --pattern and one --ext");
  return { folder, patterns, extensions };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const { folder, patterns, extensions } = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(search(folder, patterns, extensions), null, 2));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}

