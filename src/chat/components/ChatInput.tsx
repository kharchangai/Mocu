import {
  FolderOpen,
  Mic,
  Paperclip,
  SendHorizontal,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import './ChatInput.css';

type SendOptions = {
  projectPath: string | null;
};

type ChatInputProps = {
  value?: string;
  projectPath?: string;
  isLoading?: boolean;
  agentName?: string;
  modelLabel?: string;
  effortLabel?: string;
  onValueChange: (value: string) => void;
  onProjectPathChange?: (path: string) => void;
  onChooseProjectFolder?: () => void | Promise<void>;
  onSend: (text: string, options: SendOptions) => void | Promise<void>;
  onStop?: () => void;
};

export function ChatInput({
  value = '',
  projectPath = '',
  isLoading = false,
  agentName = 'Mocu',
  modelLabel = 'Mocu · Standard',
  effortLabel = 'Balanced',
  onValueChange,
  onProjectPathChange = () => undefined,
  onChooseProjectFolder,
  onSend,
  onStop,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(false);

  const safeValue = typeof value === 'string' ? value : '';
  const safeProjectPath =
    typeof projectPath === 'string' ? projectPath : '';

  const canSend = safeValue.trim().length > 0 && !isLoading;
  const hasProjectPath = safeProjectPath.trim().length > 0;

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [safeValue]);

  const handleMessageChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    onValueChange(event.target.value);
  };

  const handleProjectPathChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    onProjectPathChange(event.target.value);
  };

  const handleSend = async () => {
    const message = safeValue.trim();

    if (!message || isLoading) {
      return;
    }

    const normalizedProjectPath = safeProjectPath.trim() || null;

    onValueChange('');

    await onSend(message, {
      projectPath: normalizedProjectPath,
    });
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleChooseFolder = async () => {
    if (!onChooseProjectFolder) {
      return;
    }

    await onChooseProjectFolder();
  };

  return (
    <div className="chat-input-shell">
      <div className="chat-input-inner">
        <div className="project-folder-section">
          <button
            type="button"
            className={`project-folder-trigger ${
              hasProjectPath ? 'project-folder-trigger--active' : ''
            }`}
            onClick={() => setIsProjectPanelOpen((current) => !current)}
            aria-expanded={isProjectPanelOpen}
          >
            <FolderOpen size={16} />
            <span>
              {hasProjectPath ? 'Project folder connected' : 'Project folder'}
            </span>
            <span className="project-folder-optional">Optional</span>
          </button>

          {isProjectPanelOpen && (
            <div className="project-folder-panel">
              <div className="project-folder-panel-header">
                <div>
                  <h3>Project workspace</h3>
                  <p>
                    Mocu can use this folder for project files, chat memory,
                    and project-related data.
                  </p>
                </div>

                <button
                  type="button"
                  className="project-folder-close-button"
                  onClick={() => setIsProjectPanelOpen(false)}
                  aria-label="Close project folder panel"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="project-folder-controls">
                <input
                  type="text"
                  value={safeProjectPath}
                  onChange={handleProjectPathChange}
                  placeholder="Select or enter a project folder path..."
                  aria-label="Project folder path"
                />

                <button
                  type="button"
                  className="choose-folder-button"
                  onClick={() => void handleChooseFolder()}
                >
                  <FolderOpen size={16} />
                  Choose folder
                </button>
              </div>

              {hasProjectPath && (
                <p className="selected-project-path">{safeProjectPath}</p>
              )}
            </div>
          )}
        </div>

        <div className="chat-composer">
          <textarea
            ref={textareaRef}
            value={safeValue}
            onChange={handleMessageChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agentName}`}
            rows={1}
            disabled={isLoading}
            aria-label={`Message ${agentName}`}
          />

          <div className="chat-composer-footer">
            <div className="chat-composer-left-actions">
              <button
                type="button"
                className="composer-icon-button"
                aria-label="Attach a file"
              >
                <Paperclip size={18} />
              </button>

              <button type="button" className="composer-menu-button">
                {modelLabel}
                <span>⌄</span>
              </button>

              <button type="button" className="composer-menu-button">
                {effortLabel}
                <span>⌄</span>
              </button>
            </div>

            <div className="chat-composer-right-actions">
              <button
                type="button"
                className="composer-icon-button"
                aria-label="Voice input"
              >
                <Mic size={17} />
              </button>

              {isLoading ? (
                <button
                  type="button"
                  className="send-button send-button--stop"
                  onClick={onStop}
                  aria-label="Stop generating"
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button"
                  onClick={() => void handleSend()}
                  disabled={!canSend}
                  aria-label="Send message"
                >
                  <SendHorizontal size={18} />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="chat-input-disclaimer">
          Mocu can make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}