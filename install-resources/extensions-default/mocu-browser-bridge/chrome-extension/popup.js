const statusEl = document.getElementById("status");
const detailEl = document.getElementById("detail");

async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ type: "getBridgeStatus" });
    statusEl.textContent = state?.bridgeStatus === "connected" ? "Connected to Mocu" : state?.bridgeStatus === "error" ? "Connection error" : "Waiting for Mocu";
    statusEl.className = `status ${state?.bridgeStatus || ""}`;
    detailEl.textContent = state?.bridgeMessage || "Start the Mocu Browser Bridge App to connect.";
  } catch (error) {
    statusEl.textContent = "Connection status unavailable";
    statusEl.className = "status error";
    detailEl.textContent = String(error?.message || error);
  }
}

document.getElementById("reconnect").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "reconnect" });
  await refresh();
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "bridgeStatus") void refresh();
});
void refresh();
