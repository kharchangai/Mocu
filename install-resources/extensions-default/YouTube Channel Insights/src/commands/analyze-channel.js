import { summarizeVideos } from "../analysis.js";
import { fetchChannelVideos, getApiKey, toChannelInfo } from "../youtube-api.js";
import { clampInteger, readObjectInput } from "../input.js";

const MAX_SAMPLE_SIZE = 200;

// Input: { sampleSize?: 1-200 (default 50) }
// Analyzes the most recent sampleSize videos and returns aggregate statistics.
export async function analyzeChannel(input, context, config) {
  const options = readObjectInput(input);
  const sampleSize = clampInteger(options.sampleSize, 1, MAX_SAMPLE_SIZE, 50);

  const apiKey = getApiKey(config);
  const { channel, videos } = await fetchChannelVideos(config, apiKey, sampleSize);

  return {
    channel: toChannelInfo(channel),
    sampleSize: videos.length,
    summary: summarizeVideos(videos),
  };
}
