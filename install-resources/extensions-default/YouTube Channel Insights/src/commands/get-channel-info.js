import { getApiKey, resolveChannel, toChannelInfo } from "../youtube-api.js";

// Returns the channel's public info and totals (subscribers, videos, views).
export async function getChannelInfo(input, context, config) {
  const apiKey = getApiKey(config);
  const channel = await resolveChannel(config, apiKey);
  return toChannelInfo(channel);
}
