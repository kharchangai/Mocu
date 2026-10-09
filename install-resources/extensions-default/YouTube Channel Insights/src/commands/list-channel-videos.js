import { fetchChannelVideos, getApiKey } from "../youtube-api.js";
import { clampInteger, readObjectInput } from "../input.js";

const MAX_RESULTS = 200;

// Input: { maxResults?: 1-200 (default 20), sortBy?: "date" | "views" (default "date") }
// "views" sorts only the most recent maxResults videos, not the whole channel.
export async function listChannelVideos(input, context, config) {
  const options = readObjectInput(input);
  const maxResults = clampInteger(options.maxResults, 1, MAX_RESULTS, 20);
  const sortBy = options.sortBy === "views" ? "views" : "date";

  const apiKey = getApiKey(config);
  const { channel, videos } = await fetchChannelVideos(config, apiKey, maxResults);

  if (sortBy === "views") {
    videos.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  }

  return {
    channel: { channelId: channel.id, title: channel.snippet?.title ?? null },
    sortBy,
    count: videos.length,
    videos,
  };
}
