import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getTranscript, chooseSubtitle, normalizeLanguages, parseVideoInput, parseVtt, saveTranscriptFile } from "../lib.js";

const VIDEO_ID = "dQw4w9WgXcQ";

test("accepts supported YouTube URL forms and extracts URLs from prompts", () => {
  assert.deepEqual(parseVideoInput(`Please transcribe https://youtu.be/${VIDEO_ID}?si=abc`), {
    videoId: VIDEO_ID,
    url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  });
  assert.equal(parseVideoInput({ video_url: `https://www.youtube.com/shorts/${VIDEO_ID}` }).videoId, VIDEO_ID);
  assert.equal(parseVideoInput(VIDEO_ID).videoId, VIDEO_ID);
  assert.equal(parseVideoInput(`Please summarize the video https://youtu.be/${VIDEO_ID}`).videoId, VIDEO_ID);
});

test("rejects non-YouTube hosts and malformed IDs", () => {
  assert.throws(() => parseVideoInput("https://example.com/watch?v=dQw4w9WgXcQ"), /valid YouTube/);
  assert.throws(() => parseVideoInput("too-short"), /valid YouTube/);
});

test("normalizes language preferences with a useful default", () => {
  assert.deepEqual(normalizeLanguages({ languages: "fa, en,fa" }), ["fa", "en"]);
  assert.deepEqual(normalizeLanguages({ language: ["fr", "de"] }), ["fr", "de"]);
  assert.deepEqual(normalizeLanguages({ language: "" }), ["en", "fa"]);
});

test("prefers manual captions and respects language preference", () => {
  assert.deepEqual(chooseSubtitle({
    subtitles: { "en-US": [{}], fa: [{}] },
    automatic_captions: { en: [{}] },
  }, ["en", "fa"]), { language: "en-US", type: "manual" });
  assert.deepEqual(chooseSubtitle({
    subtitles: {},
    automatic_captions: { fa: [{}] },
  }, ["en", "fa"]), { language: "fa", type: "automatic" });
  assert.throws(() => chooseSubtitle({ subtitles: {}, automatic_captions: {} }, ["en"]), /Available subtitle languages: none/);
});

test("turns WebVTT cues into timestamped plain text", () => {
  const transcript = parseVtt(`WEBVTT\n\nNOTE generated captions\nignored\n\n1\n00:00:01.000 --> 00:00:03.000 align:start\n<c>Hello &amp; welcome.</c>\n\n00:03.200 --> 00:03:04.000\nSecond line<br>continues.\n`);
  assert.equal(transcript, "[00:00:01.000] Hello & welcome.\n[00:03.200] Second line continues.");
  assert.equal(parseVtt("WEBVTT\n\n"), "");
});
test("saves the full transcript and returns its path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mocu-youtube-test-"));
  try {
    const content = "[00:00:01.000] Hello\n[00:00:02.000] World";
    const transcriptPath = await saveTranscriptFile(content, VIDEO_ID, "en-US", directory);
    assert.equal(path.dirname(transcriptPath), directory);
    assert.match(path.basename(transcriptPath), new RegExp(`^${VIDEO_ID}\\.en-US\\.[0-9a-f-]+\\.txt$`));
    assert.equal(await readFile(transcriptPath, "utf8"), content);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("performs a real end-to-end subtitle-only fetch and returns only the transcript path", {
  timeout: 120_000,
}, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mocu-youtube-e2e-"));
  try {
    const transcriptPath = await getTranscript(
      { url: `https://www.youtube.com/watch?v=${VIDEO_ID}`, languages: "en" },
      { transcriptDirectory: directory },
    );
    assert.equal(typeof transcriptPath, "string");
    assert.equal(path.dirname(transcriptPath), directory);
    const transcript = await readFile(transcriptPath, "utf8");
    assert.ok(transcript.startsWith("["));
    assert.ok(transcript.length > 0);
  } catch (error) {
    if (/Unable to download webpage|network|timed out|Sign in|HTTP Error/i.test(error.message)) {
      t.skip(`Live YouTube is unavailable in this environment: ${error.message}`);
      return;
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
