import { fetchVideoDetails, getApiKey, parseVideoId } from "../youtube-api.js";
import { readObjectInput } from "../input.js";

// Input: a video URL/ID as a string, or { videoId } / { url }
export async function getVideoDetails(input, context, config) {
  const options = readObjectInput(input);
  const source = typeof input === "string" ? input : options.videoId ?? options.url;
  const videoId = parseVideoId(source);
  if (!videoId) {
    throw new Error("Provide a valid YouTube video ID or URL.");
  }

  const apiKey = getApiKey(config);
  return fetchVideoDetails(apiKey, videoId);
}
