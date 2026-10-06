import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import './ResourceDeleteDialog.css';

type ResourceDeleteDialogProps = {
  resourceType: string;
  resourceName: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/** A consistent in-app confirmation dialog for destructive resource actions. */
export function ResourceDeleteDialog({
  resourceType,
  resourceName,
  description,
  onCancel,
  onConfirm,
}: ResourceDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleting, onCancel]);

  const handleConfirm = async () => {
    setIsDeleting(true);
    setError('');
    try {
      await onConfirm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setIsDeleting(false);
    }
  };

  return createPortal(
    <div
      className="resource-delete-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel();
      }}
    >
      <section
        className="resource-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="resource-delete-title"
        aria-describedby="resource-delete-description"
      >
        <button
          type="button"
          className="resource-delete-close"
          aria-label="Close confirmation"
          onClick={onCancel}
          disabled={isDeleting}
        >
          <X size={17} aria-hidden="true" />
        </button>
        <div className="resource-delete-icon" aria-hidden="true"><AlertTriangle size={21} /></div>
        <p className="resource-delete-eyebrow">DELETE {resourceType.toLocaleUpperCase()}</p>
        <h2 id="resource-delete-title">Delete this {resourceType.toLocaleLowerCase()}?</h2>
        <p className="resource-delete-description" id="resource-delete-description">{description}</p>
        <div className="resource-delete-summary">
          <span className="resource-delete-summary-icon" aria-hidden="true"><Trash2 size={16} /></span>
          <strong title={resourceName}>{resourceName}</strong>
        </div>
        <div className="resource-delete-notice">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>This action cannot be undone.</span>
        </div>
        {error && <p className="resource-delete-error" role="alert">{error}</p>}
        <footer className="resource-delete-actions">
          <button ref={cancelRef} type="button" className="resource-delete-cancel" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </button>
          <button type="button" className="resource-delete-confirm" onClick={() => void handleConfirm()} disabled={isDeleting}>
            {isDeleting ? <LoaderCircle size={15} className="resource-delete-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
