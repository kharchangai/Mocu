import React, { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readSettings, saveSettings } from "../store";
import { DOCS_RETRIEVAL_DEFAULTS } from "../chat/docs/docs-retrieval-config";

import "./Settings.css";

import "./Settings.css";

/*
 * Optional close callback. When Settings is rendered inside the chat
 * page (its default home now), the chat page provides this so Save /
 * Cancel navigate back instead of closing a standalone OS window.
 */
type SettingsProps = {
  onClose?: () => void;
};

type LlmTierCardProps = {
  title: string;
  description: string;
  baseUrl: string;
  model: string;
  disabled: boolean;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
};

const LlmTierCard: React.FC<LlmTierCardProps> = ({
  title,
  description,
  baseUrl,
  model,
  disabled,
  onBaseUrlChange,
  onModelChange,
}) => {
  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <h4 className="settings-card-title">{title}</h4>
        <p className="settings-card-description">{description}</p>
      </div>

      <div className="settings-field">
        <label className="settings-label">Base URL</label>
        <input
          type="text"
          value={baseUrl}
          disabled={disabled}
          onChange={(event) => onBaseUrlChange(event.target.value)}
          placeholder="https://api.openai.com/v1"
          className="settings-input"
        />
      </div>

      <div className="settings-field">
        <label className="settings-label">Model Name</label>
        <input
          type="text"
          value={model}
          disabled={disabled}
          onChange={(event) => onModelChange(event.target.value)}
          placeholder="Model name"
          className="settings-input"
        />
      </div>
    </div>
  );
};

export const Settings: React.FC<SettingsProps> = ({
  onClose,
}) => {
  // Shared LLM API key
  const [apiKey, setApiKey] = useState("");

  // Cheap LLM settings
  const [cheapBaseUrl, setCheapBaseUrl] = useState("");
  const [cheapModel, setCheapModel] = useState("");

  // Medium LLM settings
  const [mediumBaseUrl, setMediumBaseUrl] = useState("");
  const [mediumModel, setMediumModel] = useState("");

  // Expensive LLM settings
  const [expensiveBaseUrl, setExpensiveBaseUrl] = useState("");
  const [expensiveModel, setExpensiveModel] = useState("");

  // Speech settings
  const [sttModel, setSttModel] = useState("");
  const [ttsModel, setTtsModel] = useState("");
  const [ttsVoice, setTtsVoice] = useState("");

  // Embedding settings
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");

  // Vision settings
  const [visionApiKey, setVisionApiKey] = useState("");
  const [visionBaseUrl, setVisionBaseUrl] = useState("");
  const [visionModel, setVisionModel] = useState("");

  // Perplexity settings
  const [perplexityApiKey, setPerplexityApiKey] = useState("");
  const [perplexityBaseUrl, setPerplexityBaseUrl] = useState("");
  const [perplexityModel, setPerplexityModel] = useState("");
  const [searchDepth, setSearchDepth] = useState(3);

  // Decision (Jev) settings
  const [decisionApiKey, setDecisionApiKey] = useState("");
  const [decisionBaseUrl, setDecisionBaseUrl] = useState("");
  const [decisionModel, setDecisionModel] = useState("");

  // Docs retrieval settings (hybrid search)
  const [docsBm25Weight, setDocsBm25Weight] = useState(
    DOCS_RETRIEVAL_DEFAULTS.weights.bm25,
  );
  const [docsKeywordWeight, setDocsKeywordWeight] = useState(
    DOCS_RETRIEVAL_DEFAULTS.weights.keyword,
  );
  const [docsEmbeddingWeight, setDocsEmbeddingWeight] = useState(
    DOCS_RETRIEVAL_DEFAULTS.weights.embedding,
  );
  const [docsRelevanceThreshold, setDocsRelevanceThreshold] = useState(
    DOCS_RETRIEVAL_DEFAULTS.relevanceThreshold,
  );
  const [docsResultCap, setDocsResultCap] = useState(
    DOCS_RETRIEVAL_DEFAULTS.resultCap,
  );
  const [docsCandidateDepth, setDocsCandidateDepth] = useState(
    DOCS_RETRIEVAL_DEFAULTS.candidateDepth,
  );
  const [docsJevEnabled, setDocsJevEnabled] = useState(
    DOCS_RETRIEVAL_DEFAULTS.jev.enabled,
  );
  const [docsJevCandidateLimit, setDocsJevCandidateLimit] = useState(
    DOCS_RETRIEVAL_DEFAULTS.jev.candidateLimit,
  );
  const [docsJevTimeoutMs, setDocsJevTimeoutMs] = useState(
    DOCS_RETRIEVAL_DEFAULTS.jev.timeoutMs,
  );
  const [docsJevWeight, setDocsJevWeight] = useState(
    DOCS_RETRIEVAL_DEFAULTS.jev.weight,
  );

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const appWindow = getCurrentWebviewWindow();

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const settings = await readSettings();

        if (!isMounted) {
          return;
        }

        // LLM settings
        setApiKey(settings.apiKey);

        setCheapBaseUrl(settings.cheapBaseUrl);
        setCheapModel(settings.cheapModel);

        setMediumBaseUrl(settings.mediumBaseUrl);
        setMediumModel(settings.mediumModel);

        setExpensiveBaseUrl(settings.expensiveBaseUrl);
        setExpensiveModel(settings.expensiveModel);

        // Speech settings
        setSttModel(settings.sttModel);
        setTtsModel(settings.ttsModel);
        setTtsVoice(settings.ttsVoice);

        // Embedding settings
        setEmbeddingApiKey(settings.embeddingApiKey);
        setEmbeddingBaseUrl(settings.embeddingBaseUrl);
        setEmbeddingModel(settings.embeddingModel);

        // Vision settings
        setVisionApiKey(settings.visionApiKey);
        setVisionBaseUrl(settings.visionBaseUrl);
        setVisionModel(settings.visionModel);

        // Perplexity settings
        setPerplexityApiKey(settings.perplexityApiKey);
        setPerplexityBaseUrl(settings.perplexityBaseUrl);
        setPerplexityModel(settings.perplexityModel);
        setSearchDepth(settings.searchDepth);

        // Decision (Jev) settings
        setDecisionApiKey(settings.decisionApiKey);
        setDecisionBaseUrl(settings.decisionBaseUrl);
        setDecisionModel(settings.decisionModel);

        // Docs retrieval settings
        setDocsBm25Weight(settings.docsBm25Weight);
        setDocsKeywordWeight(settings.docsKeywordWeight);
        setDocsEmbeddingWeight(settings.docsEmbeddingWeight);
        setDocsRelevanceThreshold(settings.docsRelevanceThreshold);
        setDocsResultCap(settings.docsResultCap);
        setDocsCandidateDepth(settings.docsCandidateDepth);
        setDocsJevEnabled(settings.docsJevEnabled);
        setDocsJevCandidateLimit(settings.docsJevCandidateLimit);
        setDocsJevTimeoutMs(settings.docsJevTimeoutMs);
        setDocsJevWeight(settings.docsJevWeight);
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      await saveSettings({
        // LLM settings
        apiKey,

        cheapBaseUrl,
        cheapModel,

        mediumBaseUrl,
        mediumModel,

        expensiveBaseUrl,
        expensiveModel,

        // Speech settings
        sttModel,
        ttsModel,
        ttsVoice,

        // Embedding settings
        embeddingApiKey,
        embeddingBaseUrl,
        embeddingModel,

        // Vision settings
        visionApiKey,
        visionBaseUrl,
        visionModel,

        // Perplexity settings
        perplexityApiKey,
        perplexityBaseUrl,
        perplexityModel,
        searchDepth,

        // Decision (Jev) settings
        decisionApiKey,
        decisionBaseUrl,
        decisionModel,

        // Docs retrieval settings
        docsBm25Weight,
        docsKeywordWeight,
        docsEmbeddingWeight,
        docsRelevanceThreshold,
        docsResultCap,
        docsCandidateDepth,
        docsJevEnabled,
        docsJevCandidateLimit,
        docsJevTimeoutMs,
        docsJevWeight,
      });

      /*
       * Embedded mode: hand control back to the chat page.
       * Standalone fallback: close the settings window.
       */
      if (onClose) {
        onClose();
      } else {
        await appWindow.close();
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    if (isSaving) {
      return;
    }

    if (onClose) {
      onClose();
      return;
    }

    await appWindow.close();
  };

  if (isLoading) {
    return (
      <div className="settings-page">
        <div className="settings-loading">
          <span className="settings-loading-text">
            Loading settings...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h3 className="settings-title">Settings</h3>
          <p className="settings-subtitle">
            Configure API keys, models and research options for Mocu.
          </p>
        </div>
      </header>

      <div className="settings-scroll">
        {/* ---------- Models ---------- */}
        <section className="settings-section">
          <h5 className="settings-section-title">Models</h5>

          <div className="settings-card">
            <div className="settings-card-header">
              <h4 className="settings-card-title">LLM API Key</h4>
              <p className="settings-card-description">
                Shared API key used by all language model tiers.
              </p>
            </div>

            <div className="settings-field">
              <label className="settings-label">API Key</label>
              <input
                type="password"
                value={apiKey}
                disabled={isSaving}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="Shared API key for LLM providers"
                className="settings-input"
              />
            </div>
          </div>

          <LlmTierCard
            title="Cheap LLM"
            description="Used for fast, low-cost tasks."
            baseUrl={cheapBaseUrl}
            model={cheapModel}
            disabled={isSaving}
            onBaseUrlChange={setCheapBaseUrl}
            onModelChange={setCheapModel}
          />

          <LlmTierCard
            title="Medium LLM"
            description="Balanced quality and speed for daily use."
            baseUrl={mediumBaseUrl}
            model={mediumModel}
            disabled={isSaving}
            onBaseUrlChange={setMediumBaseUrl}
            onModelChange={setMediumModel}
          />

          <LlmTierCard
            title="Expensive LLM"
            description="Best reasoning model for complex requests."
            baseUrl={expensiveBaseUrl}
            model={expensiveModel}
            disabled={isSaving}
            onBaseUrlChange={setExpensiveBaseUrl}
            onModelChange={setExpensiveModel}
          />
        </section>

        {/* ---------- Speech ---------- */}
        <section className="settings-section">
          <h5 className="settings-section-label">Speech</h5>

          <div className="settings-card">
            <div className="settings-field">
              <label className="settings-label">STT Model</label>
              <input
                type="text"
                value={sttModel}
                disabled={isSaving}
                onChange={(event) => setSttModel(event.target.value)}
                placeholder="Your speech-to-text model name"
                className="settings-input"
              />
            </div>

            <div className="settings-grid-2">
              <div className="settings-field">
                <label className="settings-label">TTS Model</label>
                <input
                  type="text"
                  value={ttsModel}
                  disabled={isSaving}
                  onChange={(event) => setTtsModel(event.target.value)}
                  placeholder="TTS model"
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">TTS Voice</label>
                <input
                  type="text"
                  value={ttsVoice}
                  disabled={isSaving}
                  onChange={(event) => setTtsVoice(event.target.value)}
                  placeholder="Voice name"
                  className="settings-input"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Embedding ---------- */}
        <section className="settings-section">
          <h5 className="settings-section-label">Embedding Model</h5>

          <div className="settings-card">
            <div className="settings-field">
              <label className="settings-label">API Key</label>
              <input
                type="password"
                value={embeddingApiKey}
                disabled={isSaving}
                onChange={(event) => setEmbeddingApiKey(event.target.value)}
                placeholder="Leave empty if not required"
                className="settings-input"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">Base URL</label>
              <input
                type="text"
                value={embeddingBaseUrl}
                disabled={isSaving}
                onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className="settings-input"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">Model Name</label>
              <input
                type="text"
                value={embeddingModel}
                disabled={isSaving}
                onChange={(event) => setEmbeddingModel(event.target.value)}
                placeholder="Embedding model name"
                className="settings-input"
              />
            </div>
          </div>
        </section>

        {/* ---------- Vision ---------- */}
        <section className="settings-section">
          <h5 className="settings-section-label">Vision Model</h5>

          <div className="settings-card">
            <div className="settings-field">
              <label className="settings-label">API Key</label>
              <input
                type="password"
                value={visionApiKey}
                disabled={isSaving}
                onChange={(event) => setVisionApiKey(event.target.value)}
                placeholder="Enter Vision API key"
                className="settings-input"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">Base URL</label>
              <input
                type="text"
                value={visionBaseUrl}
                disabled={isSaving}
                onChange={(event) => setVisionBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                className="settings-input"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">Model Name</label>
              <input
                type="text"
                value={visionModel}
                disabled={isSaving}
                onChange={(event) => setVisionModel(event.target.value)}
                placeholder="Vision model name"
                className="settings-input"
              />
            </div>
          </div>
        </section>

        {/* ---------- Perplexity ---------- */}
        <section className="settings-section">
          <h5 className="settings-section-label">
            Perplexity (Research Engine)
          </h5>

          <div className="settings-card">
            <div className="settings-field">
              <label className="settings-label">API Key</label>
              <input
                type="password"
                value={perplexityApiKey}
                disabled={isSaving}
                onChange={(event) => setPerplexityApiKey(event.target.value)}
                placeholder="Enter Perplexity API key"
                className="settings-input"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">Base URL</label>
              <input
                type="text"
                value={perplexityBaseUrl}
                disabled={isSaving}
                onChange={(event) => setPerplexityBaseUrl(event.target.value)}
                placeholder="https://api.perplexity.ai"
                className="settings-input"
              />
            </div>

            <div className="settings-grid-2">
              <div className="settings-field">
                <label className="settings-label">Model</label>
                <input
                  type="text"
                  value={perplexityModel}
                  disabled={isSaving}
                  onChange={(event) => setPerplexityModel(event.target.value)}
                  placeholder="sonar"
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Search Depth</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={searchDepth}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setSearchDepth(
                      Number.isFinite(nextValue) ? nextValue : 3,
                    );
                  }}
                  className="settings-input"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Decision (Jev) ---------- */}
        <section className="settings-section">
          <h5 className="settings-section-label">Decision (Jev)</h5>

          <div className="settings-card">
            <div className="settings-field">
              <label className="settings-label">API Key</label>
              <input
                type="password"
                value={decisionApiKey}
                disabled={isSaving}
                onChange={(event) => setDecisionApiKey(event.target.value)}
                placeholder="Enter OpenRouter API key"
                className="settings-input"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">Base URL</label>
              <input
                type="text"
                value={decisionBaseUrl}
                disabled={isSaving}
                onChange={(event) => setDecisionBaseUrl(event.target.value)}
                placeholder="https://openrouter.ai/api"
                className="settings-input"
              />
            </div>

            <div className="settings-field">
              <label className="settings-label">Model</label>
              <input
                type="text"
                value={decisionModel}
                disabled={isSaving}
                onChange={(event) => setDecisionModel(event.target.value)}
                placeholder="~typesafe/jev-latest"
                className="settings-input"
              />
            </div>
          </div>
        </section>
        {/* ---------- Docs search ---------- */}
        <section className="settings-section">
          <h5 className="settings-section-label">Docs Search</h5>

          <div className="settings-card">
            <div className="settings-card-header">
              <h4 className="settings-card-title">Hybrid Retrieval</h4>
              <p className="settings-card-description">
                Saved docs are ranked by combining BM25, keyword and embedding
                scores with these weights. Signals that are unavailable for a
                query are dropped and the remaining weights are re-normalized.
              </p>
            </div>

            <div className="settings-grid-2">
              <div className="settings-field">
                <label className="settings-label">BM25 Weight (0–1)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={docsBm25Weight}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsBm25Weight(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.weights.bm25,
                    );
                  }}
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Keyword Weight (0–1)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={docsKeywordWeight}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsKeywordWeight(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.weights.keyword,
                    );
                  }}
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Embedding Weight (0–1)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={docsEmbeddingWeight}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsEmbeddingWeight(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.weights.embedding,
                    );
                  }}
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Relevance Threshold (0–1)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={docsRelevanceThreshold}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsRelevanceThreshold(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.relevanceThreshold,
                    );
                  }}
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Result Cap (1–50)</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={docsResultCap}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsResultCap(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.resultCap,
                    );
                  }}
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Candidate Depth (1–200)</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={docsCandidateDepth}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsCandidateDepth(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.candidateDepth,
                    );
                  }}
                  className="settings-input"
                />
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">
              <h4 className="settings-card-title">Jev Relevance (bounded)</h4>
              <p className="settings-card-description">
                Optional: one bounded Jev call per search evaluates the top
                candidates (compact id/title/description only, short timeout).
                Its probability gates and refines the hybrid score; on
                failure search falls back to the deterministic hybrid score.
                The relevance threshold applies to the final score, then the
                result cap — two distinct controls.
              </p>
            </div>

            <div className="settings-grid-2">
              <div className="settings-field">
                <label className="settings-label">Enable Jev Refinement</label>
                <select
                  value={docsJevEnabled ? "on" : "off"}
                  disabled={isSaving}
                  onChange={(event) =>
                    setDocsJevEnabled(event.target.value === "on")
                  }
                  className="settings-input"
                >
                  <option value="off">Off (deterministic hybrid only)</option>
                  <option value="on">On (one bounded Jev call per search)</option>
                </select>
              </div>

              <div className="settings-field">
                <label className="settings-label">
                  Jev Candidate Limit (1–20)
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={docsJevCandidateLimit}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsJevCandidateLimit(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.jev.candidateLimit,
                    );
                  }}
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Jev Timeout (ms, 500–30000)</label>
                <input
                  type="number"
                  min="500"
                  max="30000"
                  step="100"
                  value={docsJevTimeoutMs}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsJevTimeoutMs(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.jev.timeoutMs,
                    );
                  }}
                  className="settings-input"
                />
              </div>

              <div className="settings-field">
                <label className="settings-label">Jev Weight (0–1)</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={docsJevWeight}
                  disabled={isSaving}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setDocsJevWeight(
                      Number.isFinite(nextValue)
                        ? nextValue
                        : DOCS_RETRIEVAL_DEFAULTS.jev.weight,
                    );
                  }}
                  className="settings-input"
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className="settings-footer">
        <button
          type="button"
          onClick={handleCancel}
          disabled={isSaving}
          className="settings-button-secondary"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="settings-button-primary"
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </footer>
    </div>
  );
};