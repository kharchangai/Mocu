import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PATTERN_CHARS = 256;
function splitParagraphs(content) {
    // Normalize line endings so offsets and line counting behave consistently.
    const lines = content.replace(/\r\n?/g, "\n").split("\n");
    const paragraphs = [];
    let current = [];
    let startLine = 1;
    const flush = () => {
        if (current.length > 0)
            paragraphs.push({ text: current.join("\n"), startLine });
        current = [];
    };
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "") {
            flush();
        }
        else {
            if (current.length === 0)
                startLine = i + 1;
            current.push(lines[i]);
        }
    }
    flush();
    return paragraphs;
}
export function search(folder, patterns, extensions) {
    const root = realpathSync(folder);
    if (!statSync(root).isDirectory())
        throw new Error("folder must be a directory");
    if (!Array.isArray(patterns) || patterns.length === 0 ||
        patterns.some((p) => typeof p !== "string" || p.length === 0 || p.length > MAX_PATTERN_CHARS)) {
        throw new Error("patterns must be a nonempty list of nonempty strings (up to 256 characters each)");
    }
    if (!Array.isArray(extensions) || extensions.length === 0 ||
        extensions.some((e) => typeof e !== "string" || !/^\.?[a-zA-Z0-9]+$/.test(e))) {
        throw new Error("extensions must be a nonempty list like ['.txt', '.ts']");
    }
    // Regex is evaluated against an entire paragraph, not one line. The `s` flag
    // lets `.` match newlines, so the agent can describe a multi-line excerpt.
    const compiled = patterns.map((pattern) => new RegExp(pattern, "gs"));
    const allowed = new Set(extensions.map((e) => `.${e.replace(/^\./, "").toLowerCase()}`));
    const results = [];
    function visit(directory) {
        let entries;
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const filePath = path.join(directory, entry.name);
            if (entry.isSymbolicLink())
                continue;
            if (entry.isDirectory()) {
                visit(filePath);
                continue;
            }
            if (!entry.isFile() || !allowed.has(path.extname(entry.name).toLowerCase()))
                continue;
            try {
                if (lstatSync(filePath).size > MAX_FILE_BYTES)
                    continue;
                const content = readFileSync(filePath, "utf8");
                const paragraphs = splitParagraphs(content);
                for (const paragraph of paragraphs) {
                    for (const regex of compiled) {
                        regex.lastIndex = 0;
                        for (const match of paragraph.text.matchAll(regex)) {
                            const text = match[0];
                            if (text.length === 0)
                                continue;
                            const before = paragraph.text.slice(0, match.index);
                            const line_start = paragraph.startLine + (before.match(/\n/g)?.length ?? 0);
                            // Count through the final matched character, not a newline just after it.
                            const lastCharacterOffset = match.index + text.length - 1;
                            const line_end = paragraph.startLine +
                                ((paragraph.text.slice(0, lastCharacterOffset).match(/\n/g)?.length) ?? 0);
                            results.push({
                                file_name: entry.name,
                                path: filePath,
                                text,
                                line_start,
                                line_end,
                            });
                        }
                    }
                }
            }
            catch (error) {
                console.error(`Skipped ${filePath}: ${String(error)}`);
            }
        }
    }
    visit(root);
    return results;
}
function parseArgs(args) {
    const [folder, ...options] = args;
    if (!folder)
        throw new Error("Usage: node regex_search.ts <folder> --pattern <regex> --ext <extension>");
    const patterns = [];
    const extensions = [];
    for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const value = options[++i];
        if (!value)
            throw new Error(`Missing value for ${option}`);
        if (option === "--pattern")
            patterns.push(value);
        else if (option === "--ext")
            extensions.push(value);
        else
            throw new Error(`Unknown option: ${option}`);
    }
    if (!patterns.length || !extensions.length)
        throw new Error("Provide at least one --pattern and one --ext");
    return { folder, patterns, extensions };
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
    try {
        const { folder, patterns, extensions } = parseArgs(process.argv.slice(2));
        console.log(JSON.stringify(search(folder, patterns, extensions), null, 2));
    }
    catch (error) {
        console.error(String(error));
        process.exitCode = 1;
    }
}
