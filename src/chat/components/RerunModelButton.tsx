import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, RotateCcw, Search, X } from 'lucide-react';

import {
  getMainAgentDefaultModel,
  listGatewayModels,
  type GatewayModel,
  type GatewayReasoningEffort,
} from '../../services/ai/model-catalog';

type RerunModelButtonProps = {
  currentModel: string | null;
  currentReasoningEffort: GatewayReasoningEffort | null;
  disabled?: boolean;
  onSelect: (
    model: string | null,
    reasoningEffort: GatewayReasoningEffort | null,
  ) => void;
};

export function RerunModelButton({
  currentModel,
  currentReasoningEffort,
  disabled = false,
  onSelect,
}: RerunModelButtonProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<GatewayModel[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const loadModels = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [modelsResult, defaultModelResult] = await Promise.allSettled([
      listGatewayModels(),
      getMainAgentDefaultModel(),
    ]);

    if (modelsResult.status === 'fulfilled') {
      setModels(modelsResult.value);
    } else {
      setError(
        modelsResult.reason instanceof Error
          ? modelsResult.reason.message
          : 'Could not load the available models.',
      );
    }

    if (defaultModelResult.status === 'fulfilled') {
      setDefaultModel(defaultModelResult.value);
    }

    setIsLoading(false);
  }, []);

  const handleToggle = () => {
    if (disabled) return;
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && models.length === 0 && !isLoading) {
      void loadModels();
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const filteredModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return models;
    return models.filter((model) =>
      `${model.name ?? ''} ${model.id}`.toLowerCase().includes(query),
    );
  }, [models, search]);

  const selectModel = (
    modelId: string | null,
    capabilities?: GatewayModel,
  ) => {
    const reasoningEfforts = capabilities?.supportedReasoningEfforts ?? [];
    onSelect(
      modelId,
      currentReasoningEffort && reasoningEfforts.includes(currentReasoningEffort)
        ? currentReasoningEffort
        : null,
    );
    setIsOpen(false);
    setSearch('');
  };

  const configuredDefault = models.find((model) => model.id === defaultModel);

  return (
    <div className="user-message-rerun-control" ref={rootRef}>
      <button
        type="button"
        className="message-action-button"
        onClick={handleToggle}
        disabled={disabled}
        aria-label="Try another model for this reply"
        aria-expanded={isOpen}
        title="Try another model for this reply"
      >
        <RotateCcw size={14} aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="user-message-model-menu" role="dialog" aria-label="Choose a model for this reply">
          <div className="user-message-model-menu-heading">Regenerate with model</div>
          {models.length > 5 ? (
            <label className="user-message-model-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search models"
                aria-label="Search models"
                autoFocus
              />
              {search ? (
                <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                  <X size={13} />
                </button>
              ) : null}
            </label>
          ) : null}

          <div className="user-message-model-list" role="listbox" aria-label="Available models">
            <button
              type="button"
              role="option"
              aria-selected={currentModel === null}
              className="user-message-model-option"
              onClick={() => selectModel(null, configuredDefault)}
            >
              <span>
                <strong>Configured default</strong>
                <small>{defaultModel || 'Use the configured default model'}</small>
              </span>
              {currentModel === null ? <Check size={15} aria-hidden="true" /> : null}
            </button>

            {isLoading ? <div className="user-message-model-status">Loading models…</div> : null}
            {error ? (
              <div className="user-message-model-error">
                <span>{error}</span>
                <button type="button" onClick={() => void loadModels()}>Retry</button>
              </div>
            ) : null}
            {!isLoading && filteredModels.length === 0 && !error ? (
              <div className="user-message-model-status">No matching models.</div>
            ) : null}
            {filteredModels.map((model) => (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={currentModel === model.id}
                className="user-message-model-option"
                onClick={() => selectModel(model.id, model)}
                title={model.id}
              >
                <span>
                  <strong>{model.name ?? model.id}</strong>
                  <small>{model.id}</small>
                </span>
                {currentModel === model.id ? <Check size={15} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
