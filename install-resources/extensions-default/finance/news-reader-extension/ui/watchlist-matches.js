(() => {
  "use strict";

  const WATCHLIST_FILE = "mocu-finance-watchlist.json";
  const tokenize = (value) => String(value || "").toLocaleLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]+/gu) || [];
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function bm25(query, documents) {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !documents.length) return documents.map(() => 0);
    const tokenized = documents.map(tokenize);
    const averageLength = tokenized.reduce((sum, words) => sum + words.length, 0) / tokenized.length || 1;
    const k1 = 1.5;
    const b = 0.75;
    return tokenized.map((words) => {
      let score = 0;
      for (const term of terms) {
        const frequency = words.filter((word) => word === term).length;
        if (!frequency) continue;
        const documentFrequency = tokenized.filter((other) => other.includes(term)).length;
        const idf = Math.log(1 + (tokenized.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
        score += idf * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * words.length / averageLength));
      }
      return score;
    });
  }

  function assetQuery(asset) {
    return [asset.name, asset.symbol, asset.company, asset.notes]
      .filter((value) => typeof value === "string" && value.trim()).join(" ");
  }

  function splitParagraphs(content) {
    return String(content || "").replace(/\r\n?/g, "\n").split(/\n\s*\n+/)
      .map((part) => part.trim()).filter(Boolean);
  }

  async function loadWatchlist() {
    const entries = await window.mocu.filesystem.list("");
    if (!entries.some((entry) => entry?.kind === "file" && entry.name === WATCHLIST_FILE)) return { assets: [], topics: [] };
    const data = JSON.parse(await window.mocu.filesystem.readText(WATCHLIST_FILE));
    return {
      assets: Array.isArray(data.assets) ? data.assets.filter((item) => item && item.name) : [],
      topics: Array.isArray(data.topics) ? data.topics.filter((item) => item && item.name) : [],
    };
  }

  async function analyze(article, watchlist) {
    const paragraphs = splitParagraphs(article.content);
    const documents = [clean(`${article.title || ""} ${article.content || ""}`), ...paragraphs];
    const assetMatches = [];
    for (const asset of watchlist.assets) {
      const scores = bm25(assetQuery(asset), documents);
      const articleScore = scores[0] || 0;
      const paragraphIndices = scores.slice(1).flatMap((score, index) => score > 0 ? [index] : []);
      if (articleScore > 0 || paragraphIndices.length) {
        assetMatches.push({ name: asset.name, paragraphIndices });
      }
    }

    let topicMatches = [];
    if (watchlist.topics.length) {
      try {
        const result = await window.mocu.extension.execute("match-topics", {
          topics: watchlist.topics.map(({ name, notes }) => ({ name: String(name), notes: String(notes || "") })),
          title: article.title,
          text: article.content,
          paragraphs,
        });
        topicMatches = result && Array.isArray(result.matches) ? result.matches : [];
      } catch (error) {
        console.warn("News watchlist topic matching failed:", error);
      }
    }
    return { paragraphs, assets: assetMatches, topics: topicMatches };
  }

  window.newsWatchlistMatches = { loadWatchlist, analyze, splitParagraphs };
})();
