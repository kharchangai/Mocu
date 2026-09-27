# YouTube Transcript — Mocu extension

Retrieves a video's subtitles with `yt-dlp` (without downloading the video), converts WebVTT captions into timestamped plain text, saves the complete transcript to a text file, and returns only the file path to Mocu's calling agent. This avoids putting long subtitles into the agent's context.

## Requirements

- Node.js 20 or newer.
- This bundle includes `yt-dlp.exe` for Windows, so no separate yt-dlp install is needed there. On macOS/Linux, install `yt-dlp` separately and make it available on `PATH`, or set the executable in **Mocu → Extensions → YouTube Transcript → Settings**.
- Internet access to YouTube. Some videos have no captions, and YouTube may restrict access to age-restricted/private/region-blocked videos.

Check yt-dlp with `yt-dlp --version`; on Windows, the bundled binary is also used automatically when `yt-dlp` isn't found on `PATH`. On other platforms install from the official documentation: <https://github.com/yt-dlp/yt-dlp#installation-and-updates>.

## Install in Mocu

1. Zip this folder so `manifest.json` is at the ZIP root (or one folder below it). Do not include `node_modules`.
2. In Mocu, open **Extensions** and install the ZIP.
3. In the extension's settings, leave `ytDlpPath` as `yt-dlp` when it is on `PATH`; otherwise set the full executable path.
4. Ask the agent about a video, for example: “What does this video say about memory usage? https://youtu.be/VIDEO_ID”. The command is also available as `get_transcript`.

The command accepts a YouTube URL/video ID (also within a `prompt` or `text` field) and an optional `language`/`languages` field such as `"fa,en"` or `["fa", "en"]`. The default preference is English then Persian. It chooses a matching manually-created subtitle first, then tries automatic captions. The full timestamped transcript is saved as a UTF-8 text file under `~/.mocu/youtube-transcripts` by default (or the configured `transcriptDirectory`), and the extension returns only its path. The agent can use its file-reading tools to search/read the relevant parts instead of loading the entire transcript into context.

## Local development and checks

```powershell
npm install
npm test
node index.js
```

`node index.js` should wait quietly for Mocu's JSON-RPC input. The unit tests exercise input validation, language selection, and caption parsing; a real subtitle fetch requires network access and a reachable video with captions.
