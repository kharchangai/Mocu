import { round } from "./youtube-api.js";

const DAY_MS = 86400000;
const SHORT_MAX_SECONDS = 60;
const TOP_VIDEO_COUNT = 5;

const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Summarizes a sample of video summaries (as produced by toVideoSummary).
// Rates such as uploadsPerMonth are based on the sample only, not the whole channel.
export function summarizeVideos(videos, now = new Date()) {
  if (!videos.length) {
    return { videoCount: 0 };
  }

  const views = videos.map((video) => video.viewCount).filter((value) => value !== null);
  const durations = videos.map((video) => video.durationSeconds).filter((value) => value !== null);
  const engagement = videos.map((video) => video.engagementRate).filter((value) => value !== null);
  const dates = videos
    .map((video) => Date.parse(video.publishedAt))
    .filter((value) => Number.isFinite(value));

  const newest = dates.length ? Math.max(...dates) : null;
  const oldest = dates.length ? Math.min(...dates) : null;
  const spanDays = newest !== null ? (newest - oldest) / DAY_MS : 0;

  const topVideosByViews = videos
    .filter((video) => video.viewCount !== null)
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, TOP_VIDEO_COUNT)
    .map(({ videoId, title, publishedAt, viewCount, durationSeconds }) => ({
      videoId,
      title,
      publishedAt,
      viewCount,
      durationSeconds,
    }));

  return {
    videoCount: videos.length,
    totalViews: views.reduce((sum, value) => sum + value, 0),
    averageViews: round(average(views), 0),
    medianViews: median(views),
    averageEngagementRate: round(average(engagement), 2),
    averageDurationSeconds: round(average(durations), 0),
    videosUnder60Seconds: durations.filter((value) => value <= SHORT_MAX_SECONDS).length,
    uploadsPerMonth: spanDays >= 1 ? round(videos.length / (spanDays / 30.44), 2) : null,
    videosPublishedLast30Days: dates.filter((value) => now.getTime() - value <= 30 * DAY_MS).length,
    oldestPublishedAt: oldest !== null ? new Date(oldest).toISOString() : null,
    newestPublishedAt: newest !== null ? new Date(newest).toISOString() : null,
    topVideosByViews,
  };
}
