import React, { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readSettings, saveSettings } from "../store";

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