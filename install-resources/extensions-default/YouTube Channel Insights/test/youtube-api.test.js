import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseIsoDurationToSeconds,
  parseVideoId,
  uploadsPlaylistIdFromChannelId,
  toVideoSummary,
  getApiKey,
} from "../src/youtube-api.js";
import { summarizeVideos } from "../src/analysis.js";

test("parseVideoId accepts bare IDs and common URL forms", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(parseVideoId(id), id);
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${id}&t=10s`), id);
  assert.equal(parseVideoId(`https://youtu.be/${id}`), id);
  assert.equal(parseVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(parseVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(parseVideoId("not a video"), null);
});

test("uploadsPlaylistIdFromChannelId swaps UC prefix for UU", () => {
  const channelId = "UC" + "a".repeat(22);
  assert.equal(uploadsPlaylistIdFromChannelId(channelId), "UU" + "a".repeat(22));
  assert.throws(() => uploadsPlaylistIdFromChannelId("nope"));
});

test("parseIsoDurationToSeconds handles ISO 8601 durations", () => {
  assert.equal(parseIsoDurationToSeconds("PT45S"), 45);
  assert.equal(parseIsoDurationToSeconds("PT1M30S"), 90);
  assert.equal(parseIsoDurationToSeconds("PT1H2M3S"), 3723);
  assert.equal(parseIsoDurationToSeconds("P1DT1H"), 90000);
  assert.equal(parseIsoDurationToSeconds("garbage"), null);
});

test("getApiKey requires a non-empty key", () => {
  assert.equal(getApiKey({ apiKey: "  abc  " }), "abc");
  assert.throws(() => getApiKey({ apiKey: "" }), /API key is not set/);
  assert.throws(() => getApiKey({}), /API key is not set/);
});

test("toVideoSummary computes engagement rate and handles missing stats", () => {
  const summary = toVideoSummary({
    id: "dQw4w9WgXcQ",
    snippet: { title: "t", publishedAt: "2026-01-01T00:00:00Z" },
    statistics: { viewCount: "1000", likeCount: "50", commentCount: "10" },
    contentDetails: { duration: "PT2M" },
  });
  assert.equal(summary.viewCount, 1000);
  assert.equal(summary.durationSeconds, 120);
  assert.equal(summary.engagementRate, 6);

  const hidden = toVideoSummary({ id: "dQw4w9WgXcQ", snippet: {}, statistics: {}, contentDetails: {} });
  assert.equal(hidden.viewCount, null);
  assert.equal(hidden.engagementRate, null);
});

test("summarizeVideos aggregates a sample", () => {
  const now = new Date("2026-02-01T00:00:00Z");
  const videos = [
    { videoId: "a", title: "A", publishedAt: "2026-01-31T00:00:00Z", viewCount: 300, likeCount: 30, commentCount: 0, engagementRate: 10, durationSeconds: 30 },
    { videoId: "b", title: "B", publishedAt: "2026-01-01T00:00:00Z", viewCount: 100, likeCount: 10, commentCount: 0, engagementRate: 10, durationSeconds: 600 },
    { videoId: "c", title: "C", publishedAt: "2025-12-02T00:00:00Z", viewCount: 200, likeCount: 20, commentCount: 0, engagementRate: 10, durationSeconds: 120 },
  ];
  const summary = summarizeVideos(videos, now);
  assert.equal(summary.videoCount, 3);
  assert.equal(summary.totalViews, 600);
  assert.equal(summary.averageViews, 200);
  assert.equal(summary.medianViews, 200);
  assert.equal(summary.videosUnder60Seconds, 1);
  assert.equal(summary.videosPublishedLast30Days, 1);
  assert.equal(summary.topVideosByViews[0].videoId, "a");
});

test("summarizeVideos returns just a count for an empty sample", () => {
  assert.deepEqual(summarizeVideos([]), { videoCount: 0 });
});
