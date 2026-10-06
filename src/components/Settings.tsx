import React, { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  OPENROUTER_GATEWAY_URL, OPENROUTER_DEFAULT_LLM_MODEL,
  OPENROUTER_CHEAP_DEFAULT_MODEL, OPENROUTER_MEDIUM_DEFAULT_MODEL, OPENROUTER_EXPENSIVE_DEFAULT_MODEL,
  OPENROUTER_STT_DEFAULT_MODEL, OPENROUTER_TTS_DEFAULT_MODEL, OPENROUTER_TTS_DEFAULT_VOICE,
  OPENROUTER_VISION_DEFAULT_MODEL, OPENROUTER_EMBEDDING_DEFAULT_MODEL, OPENROUTER_PERPLEXITY_DEFAULT_MODEL,
  OPENROUTER_DECISION_DEFAULT_ENDPOINT, OPENROUTER_DECISION_DEFAULT_MODEL,
  getDecisionEndpointForGateway, readSettings, saveSettings,
} from "../store";
import { DOCS_RETRIEVAL_DEFAULTS } from "../chat/docs/docs-retrieval-config";

import "./Settings.css";

type SettingsProps = {
  onClose?: () => void;
  onSaved?: () => void | Promise<void>;
};

type LlmTierCardProps = { title: string; description: string; model: string; disabled: boolean; onModelChange: (value: string) => void };
const LlmTierCard: React.FC<LlmTierCardProps> = ({ title, description, model, disabled, onModelChange }) => <div className="settings-card"><div className="settings-card-header"><h4 className="settings-card-title">{title}</h4><p className="settings-card-description">{description}</p></div><div className="settings-field"><label className="settings-label">Model Name</label><input type="text" value={model} disabled={disabled} onChange={(event) => onModelChange(event.target.value)} className="settings-input" /></div></div>;

export const Settings: React.FC<SettingsProps> = ({
  onClose,
  onSaved,
}) => {
  // Shared LLM gateway settings
  const [apiKey, setApiKey] = useState("");
  const [gatewayProvider, setGatewayProvider] = useState<"openrouter" | "custom">("openrouter");
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState(OPENROUTER_GATEWAY_URL);
  const [llmModel, setLlmModel] = useState(OPENROUTER_DEFAULT_LLM_MODEL);
  // Keep legacy dedicated keys until the user explicitly switches gateways.
  const [dedicatedKeys, setDedicatedKeys] = useState({ embedding: "", vision: "", perplexity: "" });

  const [cheapModel, setCheapModel] = useState(OPENROUTER_CHEAP_DEFAULT_MODEL);
  const [mediumModel, setMediumModel] = useState(OPENROUTER_MEDIUM_DEFAULT_MODEL);
  const [expensiveModel, setExpensiveModel] = useState(OPENROUTER_EXPENSIVE_DEFAULT_MODEL);

  // Speech settings
  const [sttModel, setSttModel] = useState(OPENROUTER_STT_DEFAULT_MODEL);
  const [ttsModel, setTtsModel] = useState(OPENROUTER_TTS_DEFAULT_MODEL);
  const [ttsVoice, setTtsVoice] = useState(OPENROUTER_TTS_DEFAULT_VOICE);

  // Embedding settings
  const [embeddingModel, setEmbeddingModel] = useState(OPENROUTER_EMBEDDING_DEFAULT_MODEL);

  // Vision settings
  const [visionModel, setVisionModel] = useState(OPENROUTER_VISION_DEFAULT_MODEL);

  // Perplexity settings
  const [perplexityModel, setPerplexityModel] = useState(OPENROUTER_PERPLEXITY_DEFAULT_MODEL);
  const [searchDepth, setSearchDepth] = useState(3);

  // Decision (Jev) settings
  const [decisionApiKey, setDecisionApiKey] = useState("");
  const [decisionEndpointUrl, setDecisionEndpointUrl] = useState(OPENROUTER_DECISION_DEFAULT_ENDPOINT);
  const [decisionModel, setDecisionModel] = useState(OPENROUTER_DECISION_DEFAULT_MODEL);

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
  const [gatewayError, setGatewayError] = useState("");

  const appWindow = getCurrentWebviewWindow();

  useEffect(() => {
    let isMounted = true;

    const loadSettings = async () => {
      try {
        const settings = await readSettings();

        if (!isMounted) {
          return;
        }

        setApiKey(settings.apiKey);
        setGatewayBaseUrl(settings.gatewayBaseUrl || OPENROUTER_GATEWAY_URL);
        const isDefaultOpenRouter = settings.gatewayBaseUrl.replace(/\/+$/, "") === OPENROUTER_GATEWAY_URL;
        setGatewayProvider(isDefaultOpenRouter ? "openrouter" : "custom");
        setLlmModel(settings.llmModel);
        setDedicatedKeys({
          embedding: settings.embeddingApiKey === settings.apiKey ? "" : settings.embeddingApiKey,
          vision: settings.visionApiKey === settings.apiKey ? "" : settings.visionApiKey,
          perplexity: settings.perplexityApiKey === settings.apiKey ? "" : settings.perplexityApiKey,
        });
        setCheapModel(settings.cheapModel);
        setMediumModel(settings.mediumModel);
        setExpensiveModel(settings.expensiveModel);
        setSttModel(settings.sttModel);
        setTtsModel(settings.ttsModel);
        setTtsVoice(settings.ttsVoice);

        setEmbeddingModel(settings.embeddingModel);
        setVisionModel(settings.visionModel);
        setPerplexityModel(settings.perplexityModel);
        setSearchDepth(settings.searchDepth);

        setDecisionApiKey(settings.decisionApiKey);
        setDecisionEndpointUrl(settings.decisionEndpointUrl);
        setDecisionModel(settings.decisionModel);

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

  const changeGatewayBaseUrl = (nextBaseUrl: string) => {
    // Follow the shared URL unless the user customized the Decision endpoint.
    if (!decisionEndpointUrl || decisionEndpointUrl === getDecisionEndpointForGateway(gatewayBaseUrl)) {
      setDecisionEndpointUrl(getDecisionEndpointForGateway(nextBaseUrl));
    }
    setGatewayBaseUrl(nextBaseUrl);
    setGatewayError("");
  };

  const changeGatewayProvider = (provider: "openrouter" | "custom") => {
    setGatewayProvider(provider);
    setApiKey("");
    setDedicatedKeys({ embedding: "", vision: "", perplexity: "" });
    setDecisionApiKey("");
    const nextBaseUrl = provider === "openrouter" ? OPENROUTER_GATEWAY_URL : "";
    setGatewayBaseUrl(nextBaseUrl);
    setDecisionEndpointUrl(getDecisionEndpointForGateway(nextBaseUrl));
    setGatewayError("");
    // Deliberately leave all model selections unchanged.
  };
  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    if (!apiKey.trim() || (gatewayProvider === "custom" && !gatewayBaseUrl.trim())) {
      setGatewayError(gatewayProvider === "custom"
        ? "Enter both the custom gateway base URL and API key."
        : "Enter your OpenRouter API key to continue.");
      return;
    }
    setGatewayError("");

    setIsSaving(true);

    try {
      await saveSettings({
        apiKey,
        gatewayBaseUrl,
        llmModel,
        cheapBaseUrl: gatewayBaseUrl,
        cheapModel,

        mediumBaseUrl: gatewayBaseUrl,
        mediumModel,

        expensiveBaseUrl: gatewayBaseUrl,
        expensiveModel,

        // Speech settings
        sttModel,
        ttsModel,
        ttsVoice,

        embeddingApiKey: dedicatedKeys.embedding,
        embeddingBaseUrl: gatewayBaseUrl,
        embeddingModel,

        visionApiKey: dedicatedKeys.vision,
        visionBaseUrl: gatewayBaseUrl,
        visionModel,

        perplexityApiKey: dedicatedKeys.perplexity,
        perplexityBaseUrl: gatewayBaseUrl,
        perplexityModel,
        searchDepth,

        decisionApiKey,
        decisionEndpointUrl,
        decisionModel,

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
      if (onSaved) {
        await onSaved();
      }

      if (onClose) {
        onClose();
      } else {
        await appWindow.close();
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      setGatewayError("Could not save settings. Please try again.");
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

          <div className="settings-model-configuration">
            <div className="settings-card">
              <div className="settings-card-header">
                <h4 className="settings-card-title">AI Gateway</h4>
                <p className="settings-card-description">
                  Start with OpenRouter: add your API key and Mocu is ready. You can switch to another OpenAI-compatible gateway anytime.
                </p>
              </div>

              <div className="settings-field">
                <label className="settings-label">Gateway</label>
                <select value={gatewayProvider} disabled={isSaving}
                  onChange={(event) => changeGatewayProvider(event.target.value as "openrouter" | "custom")}
                  className="settings-input">
                  <option value="openrouter">OpenRouter (recommended)</option>
                  <option value="custom">Custom OpenAI-compatible gateway</option>
                </select>
              </div>
              {gatewayProvider === "custom" && <div className="settings-field">
                <label className="settings-label">Shared Gateway Base URL</label>
                <input type="text" value={gatewayBaseUrl} disabled={isSaving}
                  onChange={(event) => changeGatewayBaseUrl(event.target.value)}
                  placeholder="https://your-gateway.example/v1" className="settings-input" required />
              </div>}
              <div className="settings-field">
                <label className="settings-label">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  disabled={isSaving}
                  onChange={(event) => { setApiKey(event.target.value); setGatewayError(""); }}
                  placeholder="Paste your gateway API key"
                  className="settings-input"
                />
                <p className="settings-card-description">
                  Shared by all models and Decision (Jev), unless you configure a separate key.
                </p>
                {gatewayError && <p className="settings-card-description" role="alert">{gatewayError}</p>}
              </div>
            </div>

          <details className="settings-advanced"><summary>Customize models</summary>
            <div className="settings-card"><label className="settings-label">Main Chat Model</label><input type="text" value={llmModel} disabled={isSaving} onChange={(event) => setLlmModel(event.target.value)} className="settings-input" /></div>
            <LlmTierCard title="Cheap LLM" description="Fast, low-cost tasks." model={cheapModel} disabled={isSaving} onModelChange={setCheapModel} />
            <LlmTierCard title="Medium LLM" description="Balanced daily use." model={mediumModel} disabled={isSaving} onModelChange={setMediumModel} />
            <LlmTierCard title="Expensive LLM" description="Complex requests." model={expensiveModel} disabled={isSaving} onModelChange={setExpensiveModel} />
          </details>
          </div>

          <div className="settings-card settings-model-summary">
            <p className="settings-card-description">Preconfigured models — change any model below if needed. A custom gateway must support the selected models and APIs.</p>
            <div className="settings-model-list">
              {[['Main chat', llmModel], ['Cheap', cheapModel], ['Medium', mediumModel], ['Expensive', expensiveModel], ['STT', sttModel], ['TTS', ttsModel], ['Vision', visionModel], ['Embedding', embeddingModel], ['Perplexity', perplexityModel], ['Decision (Jev)', decisionModel]].map(([name, model]) => <div className="settings-model-row" key={name}><span className="settings-model-tier">{name}</span><span className="settings-model-id">{model}</span></div>)}
            </div>
          </div>
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
        <section className="settings-section"><h5 className="settings-section-label">Embedding Model</h5><div className="settings-card"><p className="settings-card-description">Uses the shared gateway URL and API key configured above.</p><div className="settings-field"><label className="settings-label">Model</label><input value={embeddingModel} disabled={isSaving} onChange={(event)=>setEmbeddingModel(event.target.value)} className="settings-input"/></div></div></section>

        {/* ---------- Vision ---------- */}
        <section className="settings-section"><h5 className="settings-section-label">Vision Model</h5><div className="settings-card"><p className="settings-card-description">Uses the shared gateway URL and API key configured above.</p><div className="settings-field"><label className="settings-label">Model</label><input value={visionModel} disabled={isSaving} onChange={(event)=>setVisionModel(event.target.value)} className="settings-input"/></div></div></section>

        {/* ---------- Perplexity ---------- */}
        <section className="settings-section"><h5 className="settings-section-label">Perplexity (Research Engine)</h5><div className="settings-card"><p className="settings-card-description">Uses the shared gateway URL and API key configured above.</p><div className="settings-grid-2"><div className="settings-field"><label className="settings-label">Model</label><input value={perplexityModel} disabled={isSaving} onChange={(event)=>setPerplexityModel(event.target.value)} className="settings-input"/></div><div className="settings-field"><label className="settings-label">Search Depth</label><input type="number" min="1" max="10" value={searchDepth} disabled={isSaving} onChange={(event)=>setSearchDepth(Number(event.target.value)||3)} className="settings-input"/></div></div></div></section>

        {/* ---------- Decision (Jev) ---------- */}
        <section className="settings-section">
          <h5 className="settings-section-label">Decision (Jev)</h5>

          <div className="settings-card">
            <div className="settings-card-header">
              <h4 className="settings-card-title">Decision settings</h4>
              <p className="settings-card-description">
                Uses the shared gateway API key and an automatically configured endpoint. You can override either below.
              </p>
            </div>

            <details className="settings-advanced">
              <summary>Advanced Decision settings</summary>
              <div className="settings-field">
                <label className="settings-label">Separate API Key (optional)</label>
                <input
                  type="password"
                  value={decisionApiKey}
                  disabled={isSaving}
                  onChange={(event) => setDecisionApiKey(event.target.value)}
                  placeholder="Leave blank to use the shared gateway key"
                  className="settings-input"
                />
              </div>
              <div className="settings-field">
                <label className="settings-label">Endpoint URL</label>
                <input
                  type="text"
                  value={decisionEndpointUrl}
                  disabled={isSaving}
                  onChange={(event) => setDecisionEndpointUrl(event.target.value)}
                  placeholder="https://openrouter.ai/api/alpha/decisions"
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
            </details>
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
              <h4 className="settings-card-title">Jev Relevance Refinement</h4>
              <p className="settings-card-description">
                Optional: one bounded Jev call per search evaluates the top candidates using only compact IDs, titles, and descriptions. Its relevance scores gate and refine the hybrid score; if Jev fails, search falls back to the deterministic hybrid score. The relevance threshold filters final scores, while the result cap separately limits the number of returned results.
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
                <label className="settings-label">Jev Candidate Limit (1–20)</label>
                <input type="number"
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
                <label className="settings-label">Jev Timeout (500–30,000 ms)</label>
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
