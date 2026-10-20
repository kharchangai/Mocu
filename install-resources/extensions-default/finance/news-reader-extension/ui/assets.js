(() => {
  "use strict";

  const root = document.getElementById("assets-view");
  if (!root) return;

  const ASSET_KINDS = [
    ["stock", "Stock"], ["bond", "Bond"], ["commodity", "Commodity"],
    ["metal", "Metal"], ["fund", "Fund / ETF"], ["crypto", "Cryptocurrency"], ["other", "Other"]
  ];
  const state = { assets: [], topics: [], editingAsset: null, editingTopic: null, busy: false };
  const kindLabel = (kind) => ASSET_KINDS.find(([value]) => value === kind)?.[1] || "Other";
  const makeId = () => window.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  async function loadData() {
    try {
      const entries = await window.mocu.filesystem.list("");
      if (!entries.some((entry) => entry && entry.kind === "file" && entry.name === "mocu-finance-watchlist.json")) {
        state.assets = [];
        state.topics = [];
        clearStatus();
        render();
        return;
      }
      const raw = await window.mocu.filesystem.readText("mocu-finance-watchlist.json");
      const data = JSON.parse(raw);
      state.assets = Array.isArray(data.assets) ? data.assets.filter((item) => item && typeof item.id === "string") : [];
      state.topics = Array.isArray(data.topics) ? data.topics.filter((item) => item && typeof item.id === "string") : [];
      clearStatus();
    } catch (error) {
      // A missing file on first use is normal; distinguish it from unreadable JSON/I/O.
      const message = error instanceof Error ? error.message : String(error);
      if (/not found|no such file|does not exist|cannot find|enoent/i.test(message)) {
        state.assets = [];
        state.topics = [];
        clearStatus();
      } else if (message.toLowerCase().includes("json")) {
        setStatus("Your saved watchlist file contains invalid JSON. Fix or remove mocu-finance-watchlist.json to continue.", true);
      } else {
        state.assets = [];
        state.topics = [];
        setStatus(`${message} — Add an item to create the watchlist file.`, true);
      }
    }
    render();
  }

  async function persist() {
    state.busy = true;
    render();
    try {
      const data = {
        version: 1,
        assets: state.assets,
        topics: state.topics,
      };
      await window.mocu.filesystem.writeText("mocu-finance-watchlist.json", `${JSON.stringify(data, null, 2)}\n`);
      clearStatus();
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
      return false;
    } finally {
      state.busy = false;
      render();
    }
  }

  function setStatus(message, isError = false) {
    const status = root.querySelector("#assets-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("hidden", !message);
    status.classList.toggle("assets-status-error", Boolean(isError));
  }
  function clearStatus() { setStatus(""); }
  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);
  }
  function attr(text) { return escapeHtml(text).replace(/`/g, "&#96;"); }

  function assetCard(asset) {
    const details = [asset.symbol && `Symbol: ${asset.symbol}`, asset.company && `Company / issuer: ${asset.company}`, asset.market && `Market: ${asset.market}`].filter(Boolean).join(" · ");
    return `<article class="asset-card"><div class="asset-card-main"><span class="asset-kind">${escapeHtml(kindLabel(asset.kind))}</span><h4 class="asset-card-title">${escapeHtml(asset.name)}</h4>${details ? `<p class="asset-card-subtitle">${escapeHtml(details)}</p>` : ""}${asset.notes ? `<p class="asset-card-notes">${escapeHtml(asset.notes)}</p>` : ""}</div><div class="asset-card-actions"><button class="assets-button" type="button" data-edit-asset="${attr(asset.id)}">Edit</button><button class="assets-button assets-button-danger" type="button" data-delete-asset="${attr(asset.id)}">Delete</button></div></article>`;
  }

  function render() {
    const assetList = root.querySelector("#asset-list");
    const topicList = root.querySelector("#topic-list");
    const assetForm = root.querySelector("#asset-form");
    const topicForm = root.querySelector("#topic-form");
    const assetSubmit = assetForm.querySelector("[type=submit]");
    const topicSubmit = topicForm.querySelector("[type=submit]");
    assetSubmit.textContent = state.editingAsset ? "Save changes" : "Add asset";
    topicSubmit.textContent = state.editingTopic ? "Save changes" : "Add topic";
    root.querySelector("#asset-cancel").classList.toggle("hidden", !state.editingAsset);
    root.querySelector("#topic-cancel").classList.toggle("hidden", !state.editingTopic);
    root.querySelectorAll(".assets-button,.assets-form input,.assets-form select,.assets-form textarea").forEach((el) => { el.disabled = state.busy; });

    if (!state.assets.length) {
      assetList.innerHTML = '<div class="assets-empty">No assets yet. Add a stock, bond, commodity, metal, fund, cryptocurrency, or another asset to get started.</div>';
    } else {
      const byKind = new Map(ASSET_KINDS.map(([kind]) => [kind, []]));
      for (const asset of state.assets) (byKind.get(asset.kind) || byKind.get("other")).push(asset);
      assetList.innerHTML = ASSET_KINDS.filter(([kind]) => (byKind.get(kind) || []).length).map(([kind, label]) => `<section class="asset-type-group"><h3>${escapeHtml(label)}s</h3>${byKind.get(kind).map(assetCard).join("")}</section>`).join("");
    }
    topicList.innerHTML = state.topics.length
      ? state.topics.map((topic) => `<article class="asset-card"><div class="asset-card-main"><span class="asset-kind">News topic</span><h4 class="asset-card-title">${escapeHtml(topic.name)}</h4>${topic.notes ? `<p class="asset-card-notes">${escapeHtml(topic.notes)}</p>` : ""}</div><div class="asset-card-actions"><button class="assets-button" type="button" data-edit-topic="${attr(topic.id)}">Edit</button><button class="assets-button assets-button-danger" type="button" data-delete-topic="${attr(topic.id)}">Delete</button></div></article>`).join("")
      : '<div class="assets-empty">No topics yet. Add subjects such as currency-market volatility or Federal Reserve news.</div>';
  }

  root.querySelector("#asset-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const previous = state.editingAsset ? state.assets.find((item) => item.id === state.editingAsset) : null;
    const asset = {
      id: previous?.id || makeId(),
      kind: String(values.get("kind") || "other"),
      name: String(values.get("name") || "").trim(),
      symbol: String(values.get("symbol") || "").trim(),
      company: String(values.get("company") || "").trim(),
      market: String(values.get("market") || "").trim(),
      notes: String(values.get("notes") || "").trim(),
    };
    if (!asset.name) return;
    const previousAssets = state.assets;
    if (previous) state.assets = state.assets.map((item) => item.id === previous.id ? asset : item);
    else state.assets = [...state.assets, asset];
    if (!await persist()) state.assets = previousAssets;
    else { state.editingAsset = null; form.reset(); }
    render();
  });

  root.querySelector("#topic-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const previous = state.editingTopic ? state.topics.find((item) => item.id === state.editingTopic) : null;
    const topic = { id: previous?.id || makeId(), name: String(values.get("name") || "").trim(), notes: String(values.get("notes") || "").trim() };
    if (!topic.name) return;
    const previousTopics = state.topics;
    if (previous) state.topics = state.topics.map((item) => item.id === previous.id ? topic : item);
    else state.topics = [...state.topics, topic];
    if (!await persist()) state.topics = previousTopics;
    else { state.editingTopic = null; form.reset(); }
    render();
  });

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || state.busy) return;
    if (button.id === "asset-cancel") { state.editingAsset = null; root.querySelector("#asset-form").reset(); render(); return; }
    if (button.id === "topic-cancel") { state.editingTopic = null; root.querySelector("#topic-form").reset(); render(); return; }
    if (button.dataset.editAsset) {
      const item = state.assets.find((asset) => asset.id === button.dataset.editAsset);
      if (!item) return;
      state.editingAsset = item.id;
      for (const [key, value] of Object.entries(item)) { const field = root.querySelector(`#asset-form [name="${key}"]`); if (field) field.value = value; }
      root.querySelector("#asset-form").scrollIntoView({ behavior: "smooth", block: "center" });
      render(); return;
    }
    if (button.dataset.editTopic) {
      const item = state.topics.find((topic) => topic.id === button.dataset.editTopic);
      if (!item) return;
      state.editingTopic = item.id;
      root.querySelector('#topic-form [name="name"]').value = item.name;
      root.querySelector('#topic-form [name="notes"]').value = item.notes || "";
      root.querySelector("#topic-form").scrollIntoView({ behavior: "smooth", block: "center" });
      render(); return;
    }
    if (button.dataset.deleteAsset) {
      const previous = state.assets;
      state.assets = state.assets.filter((asset) => asset.id !== button.dataset.deleteAsset);
      if (state.editingAsset === button.dataset.deleteAsset) { state.editingAsset = null; root.querySelector("#asset-form").reset(); }
      if (!await persist()) state.assets = previous;
      render(); return;
    }
    if (button.dataset.deleteTopic) {
      const previous = state.topics;
      state.topics = state.topics.filter((topic) => topic.id !== button.dataset.deleteTopic);
      if (state.editingTopic === button.dataset.deleteTopic) { state.editingTopic = null; root.querySelector("#topic-form").reset(); }
      if (!await persist()) state.topics = previous;
      render();
    }
  });

  root.addEventListener("assets-view:show", () => void loadData());
  render();
})();
