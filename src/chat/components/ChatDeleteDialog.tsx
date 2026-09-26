import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, MessageSquare, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';

import './ChatDeleteDialog.css';

type ChatDeleteDialogProps = {
  chatTitle: string;
  /** Whether the chat being deleted is the one currently open. */
  isActive?: boolean;
  /** Extra context shown under the chat title (e.g. the linked project). */
  contextLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/*
 * Custom confirmation dialog for deleting a chat. Mirrors the project
 * removal dialog so destructive actions share one visual language
 * instead of the native Tauri confirm() box.
 */
export function ChatDeleteDialog({
  chatTitle,
  isActive = false,
  contextLabel,
  onCancel,
  onConfirm,
}: ChatDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === 'Tab') {
        if (isDeleting) {
          event.preventDefault();
          return;
        }

        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
          'button:not([disabled])',
        );
        if (!buttons?.length) return;

        const firstButton = buttons[0];
        const lastButton = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === firstButton) {
          event.preventDefault();
          lastButton.focus();
        } else if (!event.shiftKey && document.activeElement === lastButton) {
          event.preventDefault();
          firstButton.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleting, onCancel]);

  const handleConfirm = async () => {
    setIsDeleting(true);
    setDeleteError('');
    try {
      await onConfirm();
    } catch (error) {
      console.error('[Chats] Failed to delete chat:', error);
      setDeleteError(
        error instanceof Error ? error.message : 'Could not delete the chat.',
      );
      setIsDeleting(false);
    }
  };

  return createPortal(
    <div
      className="chat-delete-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="chat-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chat-delete-title"
        aria-describedby="chat-delete-description"
      >
        <button
          type="button"
          className="chat-delete-close"
          onClick={onCancel}
          aria-label="Cancel chat deletion"
          disabled={isDeleting}
        >
          <X size={17} aria-hidden="true" />
        </button>

        <div className="chat-delete-icon" aria-hidden="true">
          <AlertTriangle size={21} />
        </div>
        <p className="chat-delete-eyebrow">CHAT DELETION</p>
        <h2 id="chat-delete-title">Delete this conversation?</h2>
        <p className="chat-delete-description" id="chat-delete-description">
          The conversation and all of its saved messages are permanently
          removed from Mocu.
          {contextLabel
            ? ' Its saved project conversation is removed as well.'
            : ''}
        </p>

        <div className="chat-delete-summary">
          <span className="chat-delete-summary-icon" aria-hidden="true">
            <MessageSquare size={17} />
          </span>
          <span className="chat-delete-summary-copy">
            <strong title={chatTitle}>{chatTitle}</strong>
            <small>
              {isActive
                ? 'Currently open conversation'
                : 'Saved conversation'}
            </small>
          </span>
        </div>

        {contextLabel ? (
          <p className="chat-delete-context" title={contextLabel}>
            {contextLabel}
          </p>
        ) : null}

        <div className="chat-delete-notice">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>The saved messages cannot be restored after deletion.</span>
        </div>

        {deleteError ? (
          <p className="chat-delete-error" role="alert">{deleteError}</p>
        ) : null}

        <footer className="chat-delete-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="chat-delete-cancel"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Keep chat
          </button>
          <button
            type="button"
            className="chat-delete-confirm"
            onClick={() => void handleConfirm()}
            disabled={isDeleting}
          >
            <Trash2 size={15} aria-hidden="true" />
            {isDeleting ? 'Deleting…' : 'Delete chat'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
