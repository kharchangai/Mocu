const API_BASE = "https://www.googleapis.com/youtube/v3";
const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/;
const MAX_BATCH_SIZE = 50;

export function getApiKey(config) {
  const apiKey = typeof config?.apiKey === "string" ? config.apiKey.trim() : "";
  if (!apiKey) {
    throw new Error("YouTube API key is not set. Add it in the extension settings in Mocu.");
  }
  return apiKey;
}

export function parseVideoId(value) {
  const text = String(value ?? "").trim();
  if (VIDEO_ID_PATTERN.test(text)) {
    return text;
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m)\./, "");
  let candidate = null;

  if (host === "youtu.be") {
    candidate = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      candidate = url.searchParams.get("v");
    } else {
      candidate = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? null;
    }
  }

  return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}

export function uploadsPlaylistIdFromChannelId(channelId) {
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    throw new Error(`Invalid channel ID: ${channelId}`);
  }
  return `UU${channelId.slice(2)}`;
}

export function parseIsoDurationToSeconds(iso) {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso ?? "");
  if (!match) {
    return null;
  }
  const [, days = 0, hours = 0, minutes = 0, seconds = 0] = match;
  return Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export async function youtubeGet(resource, params, apiKey) {
  const url = new URL(`${API_BASE}/${resource}`);
  const allParams = { ...params, key: apiKey };
  for (const [name, value] of Object.entries(allParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`YouTube API request to "${resource}" failed: ${reason}`);
  }
  return body;
}

export async function resolveChannel(config, apiKey) {
  const raw = typeof config?.channelId === "string" ? config.channelId.trim() : "";
  if (!raw) {
    throw new Error("Channel ID is not set. Add your channel ID (UC...) or @handle in the extension settings in Mocu.");
  }

  const selector = CHANNEL_ID_PATTERN.test(raw)
    ? { id: raw }
    : { forHandle: `@${raw.replace(/^@/, "")}` };

  const body = await youtubeGet(
    "channels",
    { part: "snippet,statistics,contentDetails", ...selector },
    apiKey,
  );
  const channel = body.items?.[0];
  if (!channel) {
    throw new Error(`YouTube channel not found: ${raw}`);
  }
  return channel;
}

export function toChannelInfo(channel) {
  const snippet = channel.snippet ?? {};
  const statistics = channel.statistics ?? {};
  const contentDetails = channel.contentDetails ?? {};
  const hidden = Boolean(statistics.hiddenSubscriberCount);

  return {
    channelId: channel.id,
    title: snippet.title ?? null,
    customUrl: snippet.customUrl ?? null,
    url: snippet.customUrl
      ? `https://www.youtube.com/${snippet.customUrl}`
      : `https://www.youtube.com/channel/${channel.id}`,
    country: snippet.country ?? null,
    publishedAt: snippet.publishedAt ?? null,
    description: snippet.description ?? "",
    subscriberCount: hidden ? null : toNumberOrNull(statistics.subscriberCount),
    subscriberCountHidden: hidden,
    videoCount: toNumberOrNull(statistics.videoCount),
    viewCount: toNumberOrNull(statistics.viewCount),
    uploadsPlaylistId: contentDetails.relatedPlaylists?.uploads ?? null,
  };
}

export function toVideoSummary(item) {
  const snippet = item.snippet ?? {};
  const statistics = item.statistics ?? {};
  const contentDetails = item.contentDetails ?? {};

  const viewCount = toNumberOrNull(statistics.viewCount);
  const likeCount = toNumberOrNull(statistics.likeCount);
  const commentCount = toNumberOrNull(statistics.commentCount);

  const engagementRate =
    viewCount && likeCount !== null
      ? round(((likeCount + (commentCount ?? 0)) / viewCount) * 100, 2)
      : null;

  return {
    videoId: item.id,
    title: snippet.title ?? null,
    publishedAt: snippet.publishedAt ?? null,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    durationSeconds: parseIsoDurationToSeconds(contentDetails.duration),
    viewCount,
    likeCount,
    commentCount,
    engagementRate,
  };
}

export async function fetchChannelVideos(config, apiKey, maxResults) {
  const channel = await resolveChannel(config, apiKey);
  const uploadsPlaylistId =
    channel.contentDetails?.relatedPlaylists?.uploads ??
    uploadsPlaylistIdFromChannelId(channel.id);

  // Playlist order is newest first.
  const videoIds = [];
  let pageToken;
  while (videoIds.length < maxResults) {
    const body = await youtubeGet(
      "playlistItems",
      {
        part: "contentDetails",
        playlistId: uploadsPlaylistId,
        maxResults: Math.min(MAX_BATCH_SIZE, maxResults - videoIds.length),
        pageToken,
      },
      apiKey,
    );
    for (const item of body.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) {
        videoIds.push(id);
      }
    }
    pageToken = body.nextPageToken;
    if (!pageToken || !body.items?.length) {
      break;
    }
  }

  const videos = [];
  for (let i = 0; i < videoIds.length; i += MAX_BATCH_SIZE) {
    const batch = videoIds.slice(i, i + MAX_BATCH_SIZE);
    const body = await youtubeGet(
      "videos",
      { part: "snippet,statistics,contentDetails", id: batch.join(","), maxResults: MAX_BATCH_SIZE },
      apiKey,
    );
    for (const item of body.items ?? []) {
      videos.push(toVideoSummary(item));
    }
  }

  const order = new Map(videoIds.map((id, index) => [id, index]));
  videos.sort((a, b) => order.get(a.videoId) - order.get(b.videoId));

  return { channel, videos };
}

export async function fetchVideoDetails(apiKey, videoId) {
  const body = await youtubeGet(
    "videos",
    { part: "snippet,statistics,contentDetails", id: videoId },
    apiKey,
  );
  const item = body.items?.[0];
  if (!item) {
    throw new Error(`YouTube video not found: ${videoId}`);
  }

  return {
    ...toVideoSummary(item),
    description: item.snippet?.description ?? "",
    tags: item.snippet?.tags ?? [],
    categoryId: item.snippet?.categoryId ?? null,
    definition: item.contentDetails?.definition ?? null,
  };
}

export function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
