import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROCESS_TIMEOUT_MS = 75_000;
const MAX_PROCESS_OUTPUT_BYTES = 20 * 1024 * 1024;

/** Accept a YouTube URL/video ID, or a prompt containing one; reject other hosts. */
export function parseVideoInput(input) {
  const candidates = [];
  if (typeof input === "string") {
    candidates.push(input);
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const key of ["url", "videoUrl", "video_url", "videoId", "video_id", "id", "prompt", "text", "query", "message"]) {
      if (typeof input[key] === "string") candidates.push(input[key]);
    }
  }

  for (const candidate of candidates) {
    const value = candidate.trim();
    const urlMatch = value.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch) {
      const cleanedUrl = urlMatch[0].replace(/[),.;!?]+$/g, "");
      let parsed;
      try {
        parsed = new URL(cleanedUrl);
      } catch {
        continue;
      }

      const host = parsed.hostname.toLowerCase();
      const isYoutubeHost =
        host === "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "youtu.be" ||
        host.endsWith(".youtu.be") ||
        host === "youtube-nocookie.com" ||
        host.endsWith(".youtube-nocookie.com");
      if (!isYoutubeHost) continue;

      let videoId = "";
      if (host === "youtu.be" || host.endsWith(".youtu.be")) {
        videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
      } else {
        videoId = parsed.searchParams.get("v") ?? "";
        if (!videoId) {
          const parts = parsed.pathname.split("/").filter(Boolean);
          if (["embed", "shorts", "live", "v"].includes(parts[0])) videoId = parts[1] ?? "";
        }
      }
      if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
      }
      continue;
    }

    if (/^[A-Za-z0-9_-]{11}$/.test(value)) {
      return { videoId: value, url: `https://www.youtube.com/watch?v=${value}` };
    }
  }

  throw new Error("Provide a valid YouTube video URL or its 11-character video ID.");
}

/** Normalize a comma-separated or array language preference into language tags. */
export function normalizeLanguages(input) {
  let value = input;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    value = value.languages ?? value.language ?? value.lang;
  }
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const languages = [...new Set(values
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/.test(item)))];
  return languages.length ? languages : ["en", "fa"];
}

function findPreferredLanguage(available, requested) {
  if (!available || typeof available !== "object") return null;
  const codes = Object.keys(available);
  for (const preference of requested) {
    const exact = codes.find((code) => code.toLowerCase() === preference.toLowerCase());
    if (exact) return exact;
    const regional = codes.find((code) => code.toLowerCase().startsWith(`${preference.toLowerCase()}-`));
    if (regional) return regional;
    const preferenceBase = preference.split(/[-_]/, 1)[0].toLowerCase();
    const sameBase = codes.find((code) => code.split(/[-_]/, 1)[0].toLowerCase() === preferenceBase);
    if (sameBase) return sameBase;
  }
  return null;
}

/** Prefer a requested manual caption; only then consider automatic captions. */
export function chooseSubtitle(metadata, requested) {
  const manualLanguage = findPreferredLanguage(metadata?.subtitles, requested);
  if (manualLanguage) return { language: manualLanguage, type: "manual" };
  const automaticLanguage = findPreferredLanguage(metadata?.automatic_captions, requested);
  if (automaticLanguage) return { language: automaticLanguage, type: "automatic" };

  const manual = Object.keys(metadata?.subtitles ?? {});
  const automatic = Object.keys(metadata?.automatic_captions ?? {});
  const available = [...new Set([...manual, ...automatic])].slice(0, 30);
  const availableText = available.length ? available.join(", ") : "none";
  throw new Error(`No subtitles found for the requested languages (${requested.join(", ")}). Available subtitle languages: ${availableText}.`);
}

/** Extract a readable cue list from WebVTT, preserving each cue's start time. */
export function parseVtt(vtt) {
  const lines = String(vtt).replace(/^\uFEFF/, "").replace(/\r/g, "").split("\n");
  const cues = [];
  for (let i = 0; i < lines.length; i += 1) {
    const timing = lines[i].match(/^(?:(\d{2,}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+\S+/);
    if (!timing) continue;
    const timestamp = timing[0].split(/\s+-->/, 1)[0];
    const textLines = [];
    for (i += 1; i < lines.length && lines[i].trim() !== ""; i += 1) {
      textLines.push(lines[i]);
    }
    const text = textLines.join(" ")
      .replace(/<\/?(?:c(?:\.[^ >]+)?|v(?:\s+[^>]*)?|lang(?:\s+[^>]*)?|ruby|rt|i|b|u|font(?:\s+[^>]*)?)>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (entity) => ({
        "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
      })[entity.toLowerCase()] ?? entity)
      .replace(/&#(x[\da-f]+|\d+);/gi, (_entity, code) => {
        const numeric = code[0].toLowerCase() === "x" ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
        return Number.isFinite(numeric) && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : "";
      })
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push(`[${timestamp}] ${text}`);
  }
  return cues.join("\n");
}

/** Save a full transcript outside the short-lived yt-dlp working directory. */
export async function saveTranscriptFile(transcript, videoId, language, configuredDirectory = "") {
  const outputDir = typeof configuredDirectory === "string" && configuredDirectory.trim()
    ? path.resolve(configuredDirectory.trim())
    : path.join(os.homedir(), ".mocu", "youtube-transcripts");
  await mkdir(outputDir, { recursive: true });
  const safeLanguage = String(language).replace(/[^A-Za-z0-9_-]/g, "_");
  const transcriptPath = path.join(outputDir, `${videoId}.${safeLanguage}.${randomUUID()}.txt`);
  await writeFile(transcriptPath, transcript, { encoding: "utf8", flag: "wx" });
  return transcriptPath;
}
function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`yt-dlp did not finish within ${PROCESS_TIMEOUT_MS / 1000} seconds.`));
    }, PROCESS_TIMEOUT_MS);

    for (const [stream, label] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
          child.kill();
          finish(reject, new Error("yt-dlp output exceeded the 20 MB safety limit."));
          return;
        }
        if (label === "stdout") stdout += chunk;
        else stderr += chunk;
      });
    }

    child.on("error", (error) => {
      const message = error.code === "ENOENT"
        ? `Could not start yt-dlp at '${executable}'. Install yt-dlp or set the ytDlpPath extension setting to its executable.`
        : `Could not run yt-dlp: ${error.message}`;
      const wrapped = new Error(message, { cause: error });
      wrapped.code = error.code;
      finish(reject, wrapped);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        finish(resolve, { stdout, stderr });
      } else {
        const detail = stderr.trim().slice(-1200);
        finish(reject, new Error(`yt-dlp failed${signal ? ` (${signal})` : ` with exit code ${code}`}.${detail ? ` ${detail}` : ""}`));
      }
    });
  });
}

function getExecutables(config) {
  const configured = typeof config?.ytDlpPath === "string" ? config.ytDlpPath.trim() : "";
  if (configured && configured.toLowerCase() !== "yt-dlp") return [configured];

  const executables = [configured || "yt-dlp"];
  const bundledWindowsExecutable = path.join(path.dirname(fileURLToPath(import.meta.url)), "yt-dlp.exe");
  if (process.platform === "win32" && existsSync(bundledWindowsExecutable)) {
    executables.push(bundledWindowsExecutable);
  }
  return executables;
}

async function runYtDlp(config, args) {
  const executables = getExecutables(config);
  for (let i = 0; i < executables.length; i += 1) {
    try {
      return await runProcess(executables[i], args);
    } catch (error) {
      if (error?.code !== "ENOENT" || i === executables.length - 1) throw error;
    }
  }
  throw new Error("Could not start yt-dlp.");
}

function parseMetadata(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("yt-dlp returned invalid video metadata. Check that yt-dlp is current and the video URL is accessible.");
  }
}

/** Retrieve only subtitles; yt-dlp is never instructed to download the video. */
export async function getTranscript(input, config = {}) {
  const { videoId, url } = parseVideoInput(input);
  const requested = normalizeLanguages(input);
  const metadataResult = await runYtDlp(config, [
    "--no-warnings", "--no-progress", "--no-playlist", "--skip-download", "--dump-single-json", url,
  ]);
  const metadata = parseMetadata(metadataResult.stdout);
  const subtitle = chooseSubtitle(metadata, requested);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mocu-youtube-"));
  const outputTemplate = path.join(tempDir, "%(id)s.%(language)s.%(ext)s");

  try {
    const subtitleFlag = subtitle.type === "manual" ? "--write-subs" : "--write-auto-subs";
    await runYtDlp(config, [
      "--no-warnings", "--no-progress", "--no-playlist", "--skip-download",
      subtitleFlag, `--sub-langs=${subtitle.language}`, "--sub-format", "vtt",
      "--output", outputTemplate, url,
    ]);

    const files = await readdir(tempDir);
    const vttFile = files.find((file) => file.toLowerCase().endsWith(".vtt"));
    if (!vttFile) {
      throw new Error(`yt-dlp found ${subtitle.type} subtitles (${subtitle.language}) but did not create a WebVTT subtitle file.`);
    }
    const vtt = await readFile(path.join(tempDir, vttFile), "utf8");
    let transcript = parseVtt(vtt);
    if (!transcript) throw new Error(`The ${subtitle.language} subtitle file contained no readable transcript cues.`);
    const transcriptPath = await saveTranscriptFile(
      transcript,
      videoId,
      subtitle.language,
      config?.transcriptDirectory,
    );

    // Keep the command result small: the agent can read just the relevant parts from this file.
    return transcriptPath;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
