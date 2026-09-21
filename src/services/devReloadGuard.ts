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
 *   - `endGuardedRun()` when it finishes; if a full reload was deferred in
 *     the meantime, the page reloads at that point.
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
   * A full reload was requested (file change, dependency re-optimization,
   * ...) while a request was running. Now that the last request finished,
   * apply it so the dev code stays fresh.
   */
  if (state.activeRuns === 0 && state.pendingFullReload) {
    state.pendingFullReload = false;

    console.info(
      "[Mocu] Agent request finished — applying the deferred dev-server reload.",
    );

    window.location.reload();
  }
}

export function hasGuardedRuns(): boolean {
  const state = getGuardState();

  return (state?.activeRuns ?? 0) > 0;
}
