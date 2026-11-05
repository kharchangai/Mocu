import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DesktopNotificationInput } from '../services/desktop-notifications';

type Props = { onDismiss?: () => void };

function escapeInlineTag(value: string): string {
  return value.replace(/<\/(script|style)/gi, '<\\/$1');
}

function buildSandboxDocument(payload: DesktopNotificationInput): string {
  const title = payload.title ?? '';
  const body = payload.body ?? '';
  const content = payload.html?.trim()
    ? payload.html
    : `<main class="notice"><div class="brand">${payload.icon ? `<img class="icon" src="${payload.icon}" alt="">` : '<span class="icon-fallback">●</span>'}<div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div></div></main>`;
  const css = payload.css ?? '';
  const javascript = payload.javascript ?? '';
  const csp = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";
  const publicPayload = JSON.stringify({ title, body, icon: payload.icon ?? null }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,Segoe UI,Arial,sans-serif}.notice{padding:18px;color:#172033;background:linear-gradient(140deg,#fff,#f5f7ff);border:1px solid #dfe5f1;border-radius:18px;box-shadow:0 14px 38px #0f172a22;min-height:100vh}.notice.icon-only{display:grid;place-items:center;padding:0;background:transparent;border:0;border-radius:0;box-shadow:none}.brand{display:flex;gap:13px;align-items:flex-start}.icon{width:42px;height:42px;object-fit:cover;border-radius:12px}.icon-only .brand{display:grid;width:100%;height:100%;place-items:center;gap:0}.icon-only .icon{display:block;width:min(100%,32px);height:min(100%,32px);object-fit:contain;border-radius:0}.icon-only .brand>div{display:none}.icon-fallback{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:#e9edff;color:#5266d8}h1{font-size:15px;margin:1px 0 7px;font-weight:700}p{font-size:13px;line-height:1.5;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}</style><style>${escapeInlineTag(css)}</style></head><body>${content}<script>window.mocuNotification=${publicPayload};</script><script>${escapeInlineTag(javascript)}</script></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

export function DesktopNotificationWindow({ onDismiss }: Props) {
  const [payload, setPayload] = useState<DesktopNotificationInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const takePayloadRef = useRef<Promise<DesktopNotificationInput> | null>(null);
  const readySentRef = useRef(false);

  useEffect(() => {
    let alive = true;
    // Reuse the same take request across React StrictMode's development-only
    // effect cleanup/replay; the backend consumes the payload exactly once.
    takePayloadRef.current ??= invoke<DesktopNotificationInput>('desktop_notification_take');
    void takePayloadRef.current
      .then((value) => { if (alive) setPayload(value); })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (readySentRef.current || (!payload && !error)) return;
    readySentRef.current = true;
    void invoke('desktop_notification_ready', { error }).catch((reason) => {
      console.error('[Mocu notification] Could not acknowledge notification readiness:', reason);
    });
  }, [payload, error]);

  useEffect(() => {
    if (!payload) return;
    const timeout = payload.durationMs === 0 ? undefined : window.setTimeout(() => { void invoke('close_desktop_notification'); onDismiss?.(); }, Math.max(1000, payload.durationMs ?? 6000));
    return () => { if (timeout !== undefined) window.clearTimeout(timeout); };
  }, [payload, onDismiss]);

  useEffect(() => {
    if (!payload?.sound) return;
    const audio = new Audio(payload.sound);
    void audio.play().catch((reason) => console.warn('[Mocu notification] Sound playback was blocked or failed:', reason));
    return () => { audio.pause(); audio.src = ''; };
  }, [payload]);

  const dismiss = () => { void invoke('close_desktop_notification'); onDismiss?.(); };
  if (!payload) return <div style={{ padding: 16, color: '#667085', font: '13px Segoe UI, sans-serif' }}>{error ?? 'Loading notification…'}</div>;

  return <div style={{ position: 'relative', width: '100vw', height: '100vh', padding: 8, background: 'transparent' }}>
    <iframe title={payload.title || 'Desktop notification'} sandbox="allow-scripts" srcDoc={buildSandboxDocument(payload)} style={{ display: 'block', width: '100%', height: '100%', border: 0, borderRadius: 18, background: 'transparent' }} />
    <button aria-label="Dismiss notification" title="Dismiss" onClick={dismiss} style={{ position: 'absolute', top: 13, right: 13, width: 26, height: 26, border: 0, borderRadius: 14, background: '#ffffffdd', color: '#475467', cursor: 'pointer', fontSize: 17, lineHeight: '24px' }}>×</button>
  </div>;
}
