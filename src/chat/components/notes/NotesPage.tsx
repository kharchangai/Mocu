import { useCallback, useEffect, useMemo, useState } from 'react';

import { confirm } from '@tauri-apps/plugin-dialog';

import {
  deleteNote,
  listNotes,
  saveNote,
  updateNote,
} from '../../notes';

import type { StoredNote } from '../../notes';

import './notes.css';

type NotesPageStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string };

type NoteModalState = {
  open: boolean;
  file: string | null;
  title: string;
  body: string;
};

const EMPTY_MODAL: NoteModalState = {
  open: false,
  file: null,
  title: '',
  body: '',
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function formatDate(iso: string): string {
  if (!iso) {
    return '';
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/*
 * Notes page: the user's saved notes.
 *
 * Notes live in the global folder AppData/notes and are saved exactly as
 * written. Before every answer, Mocu searches them and only tells the
 * agent a related note exists; the agent reads it with a tool when needed.
 */
export function NotesPage() {
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<NotesPageStatus>({ kind: 'idle' });
  const [modal, setModal] = useState<NoteModalState>(EMPTY_MODAL);

  const refreshNotes = useCallback(async (): Promise<void> => {
    try {
      setNotes(await listNotes());
    } catch (error) {
      setStatus({
        kind: 'error',
        message: getErrorMessage(error, 'Failed to load notes.'),
      });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setStatus({ kind: 'loading' });
      await refreshNotes();
      setStatus({ kind: 'idle' });
    })();
  }, [refreshNotes]);

  const visibleNotes = useMemo(
    () => (query.trim() ? filterNotes(notes, query) : notes),
    [notes, query],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    const title = modal.title.trim();
    const body = modal.body.trim();

    if (!body) {
      return;
    }

    setStatus({ kind: 'saving' });

    try {
      if (modal.file) {
        await updateNote(modal.file, {
          title: title || undefined,
          body,
        });
      } else {
        await saveNote(body, title || undefined);
      }

      setModal(EMPTY_MODAL);
      await refreshNotes();
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: getErrorMessage(error, 'Failed to save the note.'),
      });
    }
  }, [modal, refreshNotes]);

  const handleDelete = useCallback(
    async (note: StoredNote): Promise<void> => {
      const confirmed = await confirm(
        `Delete "${note.title}"? This cannot be undone.`,
        { title: 'Delete note', kind: 'warning' },
      );

      if (!confirmed) {
        return;
      }

      try {
        await deleteNote(note.file);
        await refreshNotes();
      } catch (error) {
        setStatus({
          kind: 'error',
          message: getErrorMessage(error, 'Failed to delete the note.'),
        });
      }
    },
    [refreshNotes],
  );

  return (
    <div className="notes-page">
      <header className="notes-page-header">
        <div>
          <p className="notes-page-eyebrow">Memory</p>
          <h1>Notes</h1>
          <p className="notes-page-subtitle">
            Quick notes saved exactly as you write them. Mocu checks them
            before answering and reads one only when it helps.
          </p>
        </div>

        <button
          type="button"
          className="notes-primary-button"
          onClick={() => setModal({ ...EMPTY_MODAL, open: true })}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Note
        </button>
      </header>

      <div className="notes-toolbar">
        <div className="notes-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            placeholder="Search notes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="notes-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>

        <span className="notes-count">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
      </div>

      {status.kind === 'error' ? (
        <div className="notes-message notes-message-error">{status.message}</div>
      ) : null}

      {status.kind === 'loading' ? (
        <div className="notes-loading">Loading notes…</div>
      ) : null}

      {status.kind !== 'loading' && visibleNotes.length === 0 ? (
        <div className="notes-empty-state">
          {query.trim() ? (
            <>
              <p className="notes-empty-title">No matching notes</p>
              <p>Try a different search term.</p>
            </>
          ) : (
            <>
              <p className="notes-empty-title">No notes yet</p>
              <p>
                Click <strong>New Note</strong> and write anything down, or
                simply tell Mocu to save something in chat.
              </p>
            </>
          )}
        </div>
      ) : null}

      <div className="notes-grid">
        {visibleNotes.map((note) => (
          <article key={note.file} className="notes-card">
            <div className="notes-card-head">
              <h3 className="notes-card-title">{note.title}</h3>
              <span className="notes-card-date">
                {formatDate(note.updatedAt || note.createdAt)}
              </span>
            </div>

            <p className="notes-card-body">{note.body}</p>

            <div className="notes-card-actions">
              <button
                type="button"
                className="notes-secondary-button"
                onClick={() =>
                  setModal({
                    open: true,
                    file: note.file,
                    title: note.title,
                    body: note.body,
                  })
                }
              >
                Edit
              </button>
              <button
                type="button"
                className="notes-danger-button"
                onClick={() => void handleDelete(note)}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {modal.open ? (
        <div className="notes-modal-backdrop">
          <div className="notes-modal">
            <h2>{modal.file ? 'Edit note' : 'New note'}</h2>
            {modal.file ? (
              <p className="notes-modal-hint">{modal.file}</p>
            ) : (
              <p className="notes-modal-hint">
                Saved exactly as you write it — no AI rewriting.
              </p>
            )}

            <label className="notes-field">
              <span>Title</span>
              <input
                type="text"
                placeholder="Optional title"
                value={modal.title}
                onChange={(event) =>
                  setModal((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </label>

            <label className="notes-field">
              <span>Note</span>
              <textarea
                className="notes-textarea"
                rows={10}
                placeholder="Write your note…"
                value={modal.body}
                onChange={(event) =>
                  setModal((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
              />
            </label>

            <div className="notes-modal-actions">
              <button
                type="button"
                className="notes-secondary-button"
                onClick={() => setModal(EMPTY_MODAL)}
                disabled={status.kind === 'saving'}
              >
                Cancel
              </button>
              <button
                type="button"
                className="notes-primary-button"
                onClick={() => void handleSave()}
                disabled={status.kind === 'saving' || !modal.body.trim()}
              >
                {status.kind === 'saving' ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/*
 * Simple keyword filter over title and body (case-insensitive).
 */
function filterNotes(notes: StoredNote[], query: string): StoredNote[] {
  const lowerQuery = query.trim().toLowerCase();

  if (!lowerQuery) {
    return notes;
  }

  return notes.filter(
    (note) =>
      note.title.toLowerCase().includes(lowerQuery) ||
      note.body.toLowerCase().includes(lowerQuery),
  );
}
