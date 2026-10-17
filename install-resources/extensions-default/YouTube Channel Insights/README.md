# YouTube Channel Insights — Mocu extension

Reads channel statistics, lists channel videos, fetches video details, and calculates aggregate YouTube channel insights using the YouTube Data API v3.

## Commands

The extension exposes `get_channel_info`, `list_channel_videos`, `get_video_details`, and `analyze_channel`. Configure a YouTube Data API v3 key and your channel ID or handle in Mocu before invoking them.

## Important notes

- **stdout is reserved** for Mocu's JSON-RPC protocol. `index.js` redirects `console.log/info/debug` to stderr; use `console.error` for logs.
- Do not include `node_modules` when zipping the extension for installation.
- Zip the folder so `manifest.json` is at the ZIP root (or one folder below it), then install it in Mocu under **Extensions**.

## Local development

The checked-in SDK is vendored locally, so installation does not depend on npm publishing Mocu's SDK. To refresh the local SDK and contracts from this repository's `install-resources/extension-system` source, run:

```powershell
npm run vendor:sdk
npm install
npm test
node index.js
```

If the SDK source is elsewhere, set `MOCU_EXTENSION_SYSTEM_DIR` to its directory before running `npm run vendor:sdk`. `node index.js` should wait quietly for JSON-RPC input from Mocu.
