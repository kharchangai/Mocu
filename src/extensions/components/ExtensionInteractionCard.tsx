import type { ExtensionInteraction } from '../services/extension-interaction-store';

import './ExtensionInteractionCard.css';

type ExtensionInteractionCardProps = {
  interaction: ExtensionInteraction;
  onChoose: (actionId: string) => void;
};

export function ExtensionInteractionCard({
  interaction,
  onChoose,
}: ExtensionInteractionCardProps) {
  const extensionName = interaction.extensionName || interaction.extensionId;

  return (
    <section
      className="extension-interaction-notice"
      aria-label={`${extensionName} interaction`}
      aria-live="polite"
    >
      <div className="extension-interaction-notice-copy">
        <div className="extension-interaction-notice-heading">
          <strong>{extensionName}</strong>
          <span aria-hidden="true">·</span>
          <span>{interaction.title}</span>
          <span className="extension-interaction-notice-state">
            {interaction.isResponding
              ? 'Sending…'
              : interaction.inputEnabled
                ? 'Reply goes to extension'
                : 'Choose an action'}
          </span>
        </div>
        {interaction.message && (
          <p className="extension-interaction-notice-message">
            {interaction.message}
          </p>
        )}
      </div>

      {interaction.buttons.length > 0 && (
        <div className="extension-interaction-notice-actions">
          {interaction.buttons.map((button) => (
            <button
              key={button.id}
              type="button"
              className={`extension-interaction-action extension-interaction-action--${button.variant ?? 'secondary'}`}
              onClick={() => onChoose(button.id)}
              disabled={interaction.isResponding}
            >
              {button.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
