import { useState, type FormEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  ArrowRight,
  ArrowUpRight,
  Folder,
  FolderPlus,
  MessageCircle,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';

import type { ProjectWorkspace } from '../services/projectWorkspaces';
import './ProjectLanding.css';

type ProjectLandingProps = {
  projects: ProjectWorkspace[];
  onStartChat: () => void;
  onOpenProject: (path: string) => void | Promise<void>;
  onCreateProject: (
    name: string,
    description: string,
    parentPath: string,
  ) => void | Promise<void>;
};

export function ProjectLanding({
  projects,
  onStartChat,
  onOpenProject,
  onCreateProject,
}: ProjectLandingProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  const chooseFolder = async (title: string): Promise<string | null> => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      });

      if (!selected) return null;
      return Array.isArray(selected) ? selected[0] ?? null : selected;
    } catch (cause) {
      console.error('[Projects] Failed to choose a folder:', cause);
      setError('Mocu could not open the folder picker. Please try again.');
      return null;
    }
  };

  const handleChooseLocation = async () => {
    const path = await chooseFolder('Choose where to create your project');
    if (path) {
      setParentPath(path);
      setError('');
    }
  };

  const handleOpenWorkspace = async (path: string) => {
    setIsBusy(true);
    setError('');
    try {
      await onOpenProject(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open this project.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleOpenExisting = async () => {
    const path = await chooseFolder('Open an existing project folder');
    if (path) await handleOpenWorkspace(path);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectName.trim()) {
      setError('Give your project a name to continue.');
      return;
    }
    if (!parentPath) {
      setError('Choose a location for your new project folder.');
      return;
    }

    setIsBusy(true);
    setError('');
    try {
      await onCreateProject(projectName.trim(), description.trim(), parentPath);
      setIsCreateOpen(false);
      setProjectName('');
      setDescription('');
      setParentPath('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create this project.');
    } finally {
      setIsBusy(false);
    }
  };

  const closeCreate = () => {
    if (isBusy) return;
    setIsCreateOpen(false);
    setProjectName('');
    setDescription('');
    setParentPath('');
    setError('');
  };

  return (
    <section className="project-landing" aria-labelledby="landing-title">
      <div className="project-landing-orb project-landing-orb-one" aria-hidden="true" />
      <div className="project-landing-orb project-landing-orb-two" aria-hidden="true" />

      <div className="project-landing-content">
        <div className="project-landing-eyebrow">
          <span className="project-landing-mark"><Sparkles size={14} /></span>
          YOUR SPACE TO THINK & MAKE
        </div>
        <h1 id="landing-title">What would you like<br />to work on today?</h1>
        <p className="project-landing-intro">
          Start with a quick conversation, or give your work a dedicated project space.
        </p>

        <div className="project-landing-choice-grid">
          <button className="landing-choice landing-choice-chat" type="button" onClick={onStartChat}>
            <span className="landing-choice-icon"><MessageCircle size={21} /></span>
            <span className="landing-choice-copy">
              <span className="landing-choice-kicker">QUICK & FLEXIBLE</span>
              <strong>Start a chat</strong>
              <span>Ask anything, brainstorm, or get help with a one-off task.</span>
            </span>
            <span className="landing-choice-arrow"><ArrowRight size={18} /></span>
          </button>

          <button className="landing-choice landing-choice-project" type="button" onClick={() => { setError(''); setIsCreateOpen(true); }}>
            <span className="landing-choice-icon"><FolderPlus size={21} /></span>
            <span className="landing-choice-copy">
              <span className="landing-choice-kicker">BUILT AROUND YOUR FILES</span>
              <strong>Create a project</strong>
              <span>Keep conversations, context, and project memory together.</span>
            </span>
            <span className="landing-choice-arrow"><ArrowRight size={18} /></span>
          </button>
        </div>

        <div className="project-landing-library">
          <div className="project-library-heading">
            <div>
              <span className="project-section-eyebrow">PICK UP WHERE YOU LEFT OFF</span>
              <h2>Your projects <span>{projects.length}</span></h2>
            </div>
            <button type="button" className="project-open-existing" onClick={() => void handleOpenExisting()} disabled={isBusy}>
              <Folder size={15} /> Open existing folder
            </button>
          </div>

          {projects.length ? (
            <div className="project-library-grid">
              {projects.map((project) => (
                <button
                  className="project-library-card"
                  type="button"
                  key={project.path}
                  onClick={() => void handleOpenWorkspace(project.path)}
                  disabled={isBusy}
                  title={project.path}
                >
                  <span className="project-card-icon"><Folder size={19} /></span>
                  <span className="project-card-content">
                    <strong>{project.name}</strong>
                    <span>{project.description || 'Open your project workspace and continue where you left off.'}</span>
                    <small>{project.path}</small>
                  </span>
                  <ArrowUpRight className="project-card-arrow" size={17} />
                </button>
              ))}
            </div>
          ) : (
            <div className="project-library-empty">
              <span className="project-empty-icon"><Folder size={18} /></span>
              <span><strong>No projects yet</strong><small>Create a project or open a folder you already work in.</small></span>
              <button type="button" onClick={() => { setError(''); setIsCreateOpen(true); }} aria-label="Create your first project"><Plus size={17} /></button>
            </div>
          )}
        </div>

        <div className="project-landing-footnote">
          <span className="landing-footnote-dot" />
          <span>Project files stay on your device. Mocu never moves or deletes your work.</span>
        </div>
      </div>

      {isCreateOpen ? (
        <div className="project-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCreate();
        }}>
          <section className="project-create-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
            <header className="project-modal-header">
              <span className="project-modal-icon"><FolderPlus size={20} /></span>
              <button className="project-modal-close" type="button" onClick={closeCreate} disabled={isBusy} aria-label="Close"><X size={18} /></button>
              <span className="project-section-eyebrow">A HOME FOR YOUR WORK</span>
              <h2 id="project-modal-title">Create a project</h2>
              <p>Mocu will create a new folder for this project and keep its chat and memory there.</p>
            </header>

            <form onSubmit={(event) => void handleCreate(event)}>
              <label className="project-form-field">
                <span>Project name <b>*</b></span>
                <input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="e.g. Website redesign" maxLength={80} required />
              </label>
              <label className="project-form-field">
                <span>Description <small>optional</small></span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What are you working on? Mocu can use this as context." rows={3} maxLength={400} />
              </label>
              <div className="project-form-field">
                <span>Save inside <b>*</b></span>
                <button className={`project-location-picker ${parentPath ? 'project-location-picker-selected' : ''}`} type="button" onClick={() => void handleChooseLocation()} disabled={isBusy}>
                  <Folder size={17} />
                  <span>{parentPath || 'Choose a parent folder…'}</span>
                  <ArrowRight size={15} />
                </button>
                <small className="project-location-hint">A new folder named after your project will be created here.</small>
              </div>
              {error ? <p className="project-form-error" role="alert">{error}</p> : null}
              <footer className="project-modal-actions">
                <button className="project-cancel-button" type="button" onClick={closeCreate} disabled={isBusy}>Cancel</button>
                <button className="project-create-button" type="submit" disabled={isBusy || !projectName.trim()}>
                  {isBusy ? 'Creating…' : 'Create project'}
                  {!isBusy ? <ArrowRight size={16} /> : null}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
