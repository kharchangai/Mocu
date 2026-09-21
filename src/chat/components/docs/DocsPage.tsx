import { useCallback, useEffect, useState } from 'react';

import { confirm } from '@tauri-apps/plugin-dialog';

import {
  createDocFromText,
  deleteDoc,
  listDocs,
  updateDocFields,
} from '../../docs';

import type { StoredDoc } from '../../docs';

import './docs.css';

type DocsPageStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'creating' }
  | { kind: 'error'; message: string };

type CreateModalState = {
  open: boolean;
  text: string;
};

type EditModalState = {
  open: boolean;
  file: string | null;
  name: string;
  description: string;
  keywords: string;
  body: string;
};

const EMPTY_CREATE: CreateModalState = {
  open: false,
  text: '',
};

const EMPTY_EDIT: EditModalState = {
  open: false,
  file: null,
  name: '',
  description: '',
  keywords: '',
  body: '',
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

/*
 * Docs page: the user's saved searchable knowledge documents.
 *
 * Documents live in the global folder AppData/docs and are used
 * automatically (BM25 + Jev section retrieval) before the agent answers.
 */
export function DocsPage() {
  const [docs, setDocs] = useState<StoredDoc[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<DocsPageStatus>({ kind: 'idle' });
  const [createModal, setCreateModal] = useState<CreateModalState>(EMPTY_CREATE);
  const [editModal, setEditModal] = useState<EditModalState>(EMPTY_EDIT);

  const refreshDocs = useCallback(async (): Promise<void> => {
    try {
      setDocs(await listDocs());
    } catch (error) {
      setStatus({
        kind: 'error',
        message: getErrorMessage(error, 'Failed to load documents.'),
      });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setStatus({ kind: 'loading' });
      await refreshDocs();
      setStatus({ kind: 'idle' });
    })();
  }, [refreshDocs]);

  /*
   * Ranked search when a query is typed, plain list otherwise.
   */
  const visibleDocs = query.trim()
    ? rankedDocs(docs, query)
    : docs;

  const handleCreate = useCallback(async (): Promise<void> => {
    const text = createModal.text.trim();

    if (!text) {
      return;
    }

    setStatus({ kind: 'creating' });

    try {
      await createDocFromText(text);

      setCreateModal(EMPTY_CREATE);
      await refreshDocs();
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: getErrorMessage(error, 'Failed to create the document.'),
      });
    }
  }, [createModal.text, refreshDocs]);

  const handleDelete = useCallback(
    async (doc: StoredDoc): Promise<void> => {
      const confirmed = await confirm(
        `Delete "${doc.name}"? This cannot be undone.`,
        { title: 'Delete document', kind: 'warning' },
      );

      if (!confirmed) {
        return;
      }

      try {
        await deleteDoc(doc.file);
        await refreshDocs();
      } catch (error) {
        setStatus({
          kind: 'error',
          message: getErrorMessage(error, 'Failed to delete the document.'),
        });
      }
    },
    [refreshDocs],
  );

  const openEditModal = useCallback((doc: StoredDoc): void => {
    setEditModal({
      open: true,
      file: doc.file,
      name: doc.name,
      description: doc.description,
      keywords: doc.keywords.join(', '),
      body: doc.body,
    });
  }, []);

  const handleSaveEdit = useCallback(async (): Promise<void> => {
    const { file, name, description, keywords, body } = editModal;

    if (!file) {
      return;
    }

    setStatus({ kind: 'creating' });

    try {
      await updateDocFields(file, {
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        keywords: keywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean),
        body,
      });

      setEditModal(EMPTY_EDIT);
      await refreshDocs();
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: getErrorMessage(error, 'Failed to update the document.'),
      });
    }
  }, [editModal, refreshDocs]);

  return (
    <div className="docs-page">
      <header className="docs-page-header">
        <div>
          <p className="docs-page-eyebrow">Knowledge</p>
          <h1>Docs</h1>
          <p className="docs-page-subtitle">
            Searchable knowledge documents. Mocu searches them automatically
            before answering, and injects the most related section into its
            context.
          </p>
        </div>

        <button
          type="button"
          className="docs-primary-button"
          onClick={() => setCreateModal({ open: true, text: '' })}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Doc
        </button>
      </header>

      <div className="docs-toolbar">
        <div className="docs-search">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            placeholder="Search documents…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="docs-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>

        <span className="docs-count">
          {docs.length} {docs.length === 1 ? 'document' : 'documents'}
        </span>
      </div>

      {status.kind === 'error' ? (
        <div className="docs-message docs-message-error">{status.message}</div>
      ) : null}

      {status.kind === 'loading' ? (
        <div className="docs-loading">Loading documents…</div>
      ) : null}

      {status.kind !== 'loading' && visibleDocs.length === 0 ? (
        <div className="docs-empty-state">
          {query.trim() ? (
            <>
              <p className="docs-empty-title">No matching documents</p>
              <p>Try a different search term.</p>
            </>
          ) : (
            <>
              <p className="docs-empty-title">No documents yet</p>
              <p>
                Click <strong>New Doc</strong> and paste any text — an LLM turns
                it into a complete searchable document. Agents can also create
                docs for you in chat.
              </p>
            </>
          )}
        </div>
      ) : null}

      <div className="docs-grid">
        {visibleDocs.map((doc) => (
          <article key={doc.file} className="docs-card">
            <div className="docs-card-head">
              <h3 className="docs-card-title">{doc.name}</h3>
              <span className="docs-card-file">{doc.file}</span>
            </div>

            <p className="docs-card-description">{doc.description}</p>

            {doc.keywords.length > 0 ? (
              <div className="docs-card-keywords">
                {doc.keywords.slice(0, 6).map((keyword) => (
                  <span key={keyword} className="docs-keyword-chip">
                    {keyword}
                  </span>
                ))}
                {doc.keywords.length > 6 ? (
                  <span className="docs-keyword-chip docs-keyword-chip-more">
                    +{doc.keywords.length - 6}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="docs-card-actions">
              <button
                type="button"
                className="docs-secondary-button"
                onClick={() => openEditModal(doc)}
              >
                Edit
              </button>
              <button
                type="button"
                className="docs-danger-button"
                onClick={() => void handleDelete(doc)}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {createModal.open ? (
        <div className="docs-modal-backdrop">
          <div className="docs-modal">
            <h2>Create document</h2>
            <p className="docs-modal-hint">
              Paste the raw text. An LLM turns it into a complete document with
              a title, description, keywords and a full explanation.
            </p>

            <textarea
              className="docs-textarea"
              rows={10}
              placeholder="Paste the text to turn into a document…"
              value={createModal.text}
              onChange={(event) =>
                setCreateModal((current) => ({
                  ...current,
                  text: event.target.value,
                }))
              }
            />

            <div className="docs-modal-actions">
              <button
                type="button"
                className="docs-secondary-button"
                onClick={() => setCreateModal(EMPTY_CREATE)}
                disabled={status.kind === 'creating'}
              >
                Cancel
              </button>
              <button
                type="button"
                className="docs-primary-button"
                onClick={() => void handleCreate()}
                disabled={status.kind === 'creating' || !createModal.text.trim()}
              >
                {status.kind === 'creating' ? 'Generating…' : 'Create with AI'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editModal.open ? (
        <div className="docs-modal-backdrop">
          <div className="docs-modal docs-modal-edit">
            <h2>Edit document</h2>
            <p className="docs-modal-hint">{editModal.file}</p>

            <label className="docs-field">
              <span>Title</span>
              <input
                type="text"
                value={editModal.name}
                onChange={(event) =>
                  setEditModal((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>

            <label className="docs-field">
              <span>Description</span>
              <input
                type="text"
                value={editModal.description}
                onChange={(event) =>
                  setEditModal((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>

            <label className="docs-field">
              <span>Keywords (comma separated)</span>
              <input
                type="text"
                value={editModal.keywords}
                onChange={(event) =>
                  setEditModal((current) => ({
                    ...current,
                    keywords: event.target.value,
                  }))
                }
              />
            </label>

            <label className="docs-field">
              <span>Content</span>
              <textarea
                className="docs-textarea docs-textarea-tall"
                rows={14}
                value={editModal.body}
                onChange={(event) =>
                  setEditModal((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
              />
            </label>

            <div className="docs-modal-actions">
              <button
                type="button"
                className="docs-secondary-button"
                onClick={() => setEditModal(EMPTY_EDIT)}
                disabled={status.kind === 'creating'}
              >
                Cancel
              </button>
              <button
                type="button"
                className="docs-primary-button"
                onClick={() => void handleSaveEdit()}
                disabled={status.kind === 'creating'}
              >
                {status.kind === 'creating' ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/*
 * Orders the docs by BM25 relevance for the query (fallback: list order).
 */
function rankedDocs(docs: StoredDoc[], query: string): StoredDoc[] {
  const queryText = query.trim();

  if (!queryText) {
    return docs;
  }

  const lowerQuery = queryText.toLowerCase();

  const scoreDoc = (doc: StoredDoc): number => {
    const name = doc.name.toLowerCase();
    const description = doc.description.toLowerCase();
    const keywords = doc.keywords.join(' ').toLowerCase();
    const file = doc.file.toLowerCase();

    let score = 0;

    if (name.includes(lowerQuery)) score += 6;
    if (keywords.includes(lowerQuery)) score += 5;
    if (description.includes(lowerQuery)) score += 3;
    if (file.includes(lowerQuery)) score += 2;
    if (doc.body.toLowerCase().includes(lowerQuery)) score += 1;

    return score;
  };

  return docs
    .map((doc) => ({ doc, score: scoreDoc(doc) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.doc);
}
