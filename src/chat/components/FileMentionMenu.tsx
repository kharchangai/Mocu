import {
  ArrowLeft,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  HardDrive,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

export type ProjectFileEntry = {
  name: string;
  relativePath: string;
  isDirectory: boolean;
};

type FileMentionMenuProps = {
  projectName: string;
  directoryPath: string;
  entries: ProjectFileEntry[];
  selectedIndex: number;
  isLoading: boolean;
  error: string | null;
  hasProject: boolean;
  isDeepSearch?: boolean;
  onSelect: (entry: ProjectFileEntry) => void;
  onOpenDirectory: (relativePath: string) => void;
  onGoBack: () => void;
  onHover: (index: number) => void;
};

export function FileMentionMenu({
  projectName,
  directoryPath,
  entries,
  selectedIndex,
  isLoading,
  error,
  hasProject,
  isDeepSearch = false,
  onSelect,
  onOpenDirectory,
  onGoBack,
  onHover,
}: FileMentionMenuProps) {
  const selectedEntryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedEntryRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const breadcrumbs = directoryPath.split('/').filter(Boolean);

  return (
    <div
      id="file-mention-menu-list"
      className="command-menu file-mention-menu"
      role="listbox"
      aria-label="Project files and folders"
    >
      <div className="file-mention-header">
        <div className="file-mention-heading">
          <span className="file-mention-heading-icon"><HardDrive size={14} /></span>
          <span>{isDeepSearch ? 'Search project files' : 'Project files'}</span>
        </div>
        <span className="command-menu-hint">↑↓ Select · → Open folder · Enter Add · Esc Close</span>
      </div>

      <div className="file-mention-location">
        <button
          type="button"
          className="file-mention-breadcrumb"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onOpenDirectory('')}
          title={projectName}
        >
          {projectName}
        </button>
        {breadcrumbs.map((part, index) => (
          <span className="file-mention-breadcrumb-part" key={`${part}-${index}`}>
            <ChevronRight size={12} />
            <button
              type="button"
              className="file-mention-breadcrumb"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onOpenDirectory(breadcrumbs.slice(0, index + 1).join('/'))}
            >
              {part}
            </button>
          </span>
        ))}
        {directoryPath && (
          <button
            type="button"
            className="file-mention-back"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onGoBack}
            aria-label="Go to parent folder"
            title="Go to parent folder"
          >
            <ArrowLeft size={14} />
          </button>
        )}
      </div>

      <div className="file-mention-list">
        {!hasProject ? (
          <div className="command-menu-status">
            Select a project folder to browse its files.
          </div>
        ) : isLoading ? (
          <div className="command-menu-status file-mention-loading">
            <span className="file-mention-spinner" />
            Loading project files…
          </div>
        ) : error ? (
          <div className="command-menu-status command-menu-status--error">
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="command-menu-status">
            No matching files or folders. Try another name.
          </div>
        ) : (
          entries.map((entry, index) => {
            const isSelected = selectedIndex === index;

            return (
              <div
                key={entry.relativePath}
                className={`file-mention-row${isSelected ? ' file-mention-row--selected' : ''}`}
                onMouseEnter={() => onHover(index)}
              >
                <button
                  ref={isSelected ? selectedEntryRef : null}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className="file-mention-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(entry)}
                  title={`Insert @${entry.relativePath}`}
                >
                  <span className={`file-mention-item-icon${entry.isDirectory ? ' file-mention-item-icon--folder' : ''}`}>
                    {entry.isDirectory ? <Folder size={16} /> : <File size={16} />}
                  </span>
                  <span className="file-mention-item-information">
                    <span className="file-mention-item-name">{entry.name}</span>
                    {isDeepSearch && entry.relativePath !== entry.name && (
                      <span className="file-mention-item-path">{entry.relativePath}</span>
                    )}
                  </span>
                  <span className="file-mention-item-type">
                    {entry.isDirectory ? 'Folder' : 'File'}
                  </span>
                </button>
                {entry.isDirectory && (
                  <button
                    type="button"
                    className="file-mention-open-folder"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onOpenDirectory(entry.relativePath)}
                    aria-label={`Open folder ${entry.name}`}
                    title={`Browse ${entry.name}`}
                  >
                    <FolderOpen size={15} />
                    <ChevronRight size={13} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="file-mention-footer">
        <span><Folder size={12} /> Choose a folder to reference it</span>
        <span>Files stay on your device</span>
      </div>
    </div>
  );
}
