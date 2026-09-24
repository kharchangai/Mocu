/*
 * Dev-only guard against Vite full page reloads while an agent request is
 * running.
 *
 * In `tauri dev` the webview is served by the Vite dev server. When any
 * watched file changes in a way that cannot be hot-updated (ordinary
 * project source files, index.html, config files, newly optimized
 * dependencies, ...), the server sends a "full-reload" HMR frame and the
 * webview reloads. That kills the running agent loop — and every pending
 * Tauri invoke, including long-running extension commands such as the pi
 * bridge `ask` — so the conversation appears to lose the assistant's
 * answer even though the extension keeps working on the Rust side.
 *
 * The actual interception happens in an inline script in `index.html`
 * (which wraps window.WebSocket before the Vite HMR client loads, because
 * Vite 7 swallows listener errors via Promise.allSettled and would reload
 * anyway). This module only drives the guard state:
 *
 *   - `beginGuardedRun()` while a chat request runs,
 *   - `endGuardedRun()` when it finishes; a deferred full reload is dropped
 *     rather than applied while Tauri operations may still be settling.
 *
 * In a production build the inline script still exists but never sees HMR
 * frames (no dev server), so this is a no-op there.
 */

type DevReloadGuardState = {
  activeRuns: number;
  pendingFullReload: boolean;
};

function getGuardState(): DevReloadGuardState | null {
  const state = (window as {
    __mocuDevReloadGuard?: DevReloadGuardState;
  }).__mocuDevReloadGuard;

  return state ?? null;
}

export function beginGuardedRun(): void {
  const state = getGuardState();

  if (state) {
    state.activeRuns += 1;
  }
}

export function endGuardedRun(): void {
  const state = getGuardState();

  if (!state) {
    return;
  }

  state.activeRuns = Math.max(0, state.activeRuns - 1);

  /*
   * A full reload was requested while an agent was running. Do not replay it
   * automatically: Tauri invoke callbacks can still be settling after the
   * chat request returns, and destroying the webview would orphan them. The
   * user can reload manually once all work is finished.
   */
  if (state.activeRuns === 0 && state.pendingFullReload) {
    state.pendingFullReload = false;

    console.warn(
      "[Mocu] A dev-server reload was deferred during agent work. Reload manually when it is safe to apply the latest code.",
    );
  }
}

export function hasGuardedRuns(): boolean {
  const state = getGuardState();

  return (state?.activeRuns ?? 0) > 0;
}
