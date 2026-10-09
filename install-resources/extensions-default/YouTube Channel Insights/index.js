import { createExtension } from "@mocu/extension-sdk";
import { getChannelInfo } from "./src/commands/get-channel-info.js";
import { listChannelVideos } from "./src/commands/list-channel-videos.js";
import { getVideoDetails } from "./src/commands/get-video-details.js";
import { analyzeChannel } from "./src/commands/analyze-channel.js";

// stdout is reserved for the SDK's JSON-RPC protocol.
// Redirect all console output to stderr so it never corrupts the protocol.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.debug = (...args) => console.error(...args);

const extension = createExtension({
  commands: {
    // Each command name must match an "id" in manifest.json.
    async get_channel_info(input, context, config) {
      return getChannelInfo(input, context, config);
    },
    async list_channel_videos(input, context, config) {
      return listChannelVideos(input, context, config);
    },
    async get_video_details(input, context, config) {
      return getVideoDetails(input, context, config);
    },
    async analyze_channel(input, context, config) {
      return analyzeChannel(input, context, config);
    },
  },
});

extension.start();
