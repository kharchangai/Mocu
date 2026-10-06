import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Bot, Download, LoaderCircle, Pencil, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { ResourceDeleteDialog } from '../../../components/ResourceDeleteDialog';
import { listAvailableAgents, type AvailableAgent } from '../../agent/agent-loader';
import type { AgentDefinition } from '../../agent/agent-definition-parser';
import {
  deleteAgentDefinition,
  exportAgentPackage,
  installAgentPackage,
  saveEditedAgent,
} from '../../agent/agent-storage';
import './agents.css';

type AgentForm = {
  agentName: string;
  description: string;
  mainInstruction: string;
  agents: string;
  skills: string;
  tools: string;
  extensions: string;
  llm: string;
};

const emptyForm: AgentForm = {
  agentName: '', description: '', mainInstruction: '', agents: '', skills: '', tools: '', extensions: '', llm: '',
};

function toForm(agent: AvailableAgent): AgentForm {
  return {
    agentName: agent.agentName,
    description: agent.description,
    mainInstruction: agent.mainInstruction,
    agents: agent.agents.join(', '),
    skills: agent.skills.join(', '),
    tools: agent.tools.join(', '),
    extensions: agent.extensions.join(', '),
    llm: agent.llm ?? '',
  };
}

function toDefinition(form: AgentForm, current: AvailableAgent): AgentDefinition {
  const split = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  return {
    agentName: form.agentName.trim(),
    description: form.description.trim(),
    mainInstruction: form.mainInstruction.trim(),
    agents: split(form.agents),
    skills: split(form.skills),
    tools: split(form.tools),
    toolSelectionConfigured: current.toolSelectionConfigured,
    extensions: split(form.extensions),
    llm: form.llm.trim() || null,
  };
}

function getError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AgentsPage() {
  const [agents, setAgents] = useState<AvailableAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AvailableAgent | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<AvailableAgent | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyForm);

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setAgents(await listAvailableAgents());
    } catch (loadError) {
      setError(getError(loadError) || 'Could not load agents.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadAgents(); }, [loadAgents]);

  const installAgent = async () => {
    setError(null);
    let selected: string | string[] | null;
    try {
      selected = await open({
        title: 'Install agent package',
        multiple: false,
        directory: false,
        filters: [{ name: 'Agent package', extensions: ['zip'] }],
      });
    } catch (dialogError) {
      setError(getError(dialogError));
      return;
    }
    if (!selected || Array.isArray(selected)) return;

    setBusy(true);
    setBusyMessage('Installing agent package…');
    setNotice(null);
    try {
      const definition = await installAgentPackage(selected);
      setNotice(`“${definition.agentName}” installed.`);
      await loadAgents();
    } catch (installError) {
      setError(getError(installError));
    } finally {
      setBusy(false);
      setBusyMessage(null);
    }
  };

  const beginEdit = (agent: AvailableAgent) => {
    setEditing(agent);
    setForm(toForm(agent));
    setError(null);
    setNotice(null);
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing || busy) return;
    if (!form.agentName.trim() || !form.mainInstruction.trim()) {
      setError('Agent name and main instruction are required.');
      return;
    }

    setBusy(true);
    setBusyMessage('Saving agent changes…');
    setError(null);
    try {
      const name = form.agentName.trim();
      await saveEditedAgent(editing, toDefinition(form, editing));
      setEditing(null);
      setNotice(`“${name}” updated.`);
      await loadAgents();
    } catch (saveError) {
      setError(getError(saveError));
    } finally {
      setBusy(false);
      setBusyMessage(null);
    }
  };

  const removeAgent = (agent: AvailableAgent) => {
    setAgentToDelete(agent);
    setError(null);
    setNotice(null);
  };

  const confirmRemoveAgent = async () => {
    if (!agentToDelete) return;
    setBusy(true);
    setBusyMessage('Deleting agent…');
    setError(null);
    try {
      await deleteAgentDefinition(agentToDelete);
      setNotice(`“${agentToDelete.agentName}” deleted.`);
      setAgentToDelete(null);
      await loadAgents();
    } catch (deleteError) {
      throw deleteError;
    } finally {
      setBusy(false);
      setBusyMessage(null);
    }
  };

  const updateForm = (key: keyof AgentForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const exportAgent = async (agent: AvailableAgent) => {
    try {
      const bytes = await exportAgentPackage(agent);
      const archive = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/zip' });
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${agent.agentName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}.zip`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportError) {
      setError(getError(exportError));
    }
  };

  return (
    <section className="agents-page">
      <header className="agents-page-header">
        <div>
          <p className="agents-page-eyebrow">Specialists</p>
          <h1>Agents</h1>
          <p>Manage saved agents or install an agent package from a ZIP file.</p>
        </div>
        <div className="agents-page-header-actions">
          <button type="button" className="agents-install-button" onClick={() => void installAgent()} disabled={busy}>
            <Upload size={15} /> Install agent
          </button>
          <button type="button" className="agents-refresh-button" onClick={() => void loadAgents()} disabled={isLoading || busy} aria-label="Refresh agents" title="Refresh agents">
            <RefreshCw size={16} className={isLoading ? 'agents-refresh-spin' : ''} />
          </button>
        </div>
      </header>

      {error ? <p className="agents-message agents-message-error" role="alert">{error}</p> : null}
      {notice ? <p className="agents-message agents-message-success" role="status">{notice}</p> : null}
      {busyMessage ? <p className="agents-operation-status" role="status" aria-live="polite"><LoaderCircle size={15} />{busyMessage}</p> : null}
      {isLoading ? (
        <p className="agents-message">Loading agents...</p>
      ) : agents.length === 0 ? (
        <div className="agents-empty-state">
          <Bot size={28} />
          <h2>No agents yet</h2>
          <p>Install an agent from a ZIP package to get started.</p>
        </div>
      ) : (
        <div className="agents-grid">
          {agents.map((agent) => (
            <article className="agent-card" key={agent.path}>
              <div className="agent-card-icon"><Bot size={18} /></div>
              <div className="agent-card-content">
                <h2>{agent.agentName}</h2>
                <p>{agent.description}</p>
                <div className="agent-card-meta">
                  <span>{agent.skills.length} skills</span>
                  <span>{agent.extensions.length} extensions</span>
                  <span>{agent.agents.length} child agents</span>
                </div>
                <div className="agent-card-actions">
                  <button type="button" onClick={() => beginEdit(agent)} disabled={busy} aria-label={`Edit ${agent.agentName}`}><Pencil size={14} /> Edit</button>
                  <button type="button" className="agent-delete-button" onClick={() => void removeAgent(agent)} disabled={busy} aria-label={`Delete ${agent.agentName}`}><Trash2 size={14} /> Delete</button>
                  <button type="button" className="agent-export-button" onClick={() => void exportAgent(agent)} aria-label={`Export ${agent.agentName}`} title="Export agent package"><Download size={14} /> Export ZIP</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing ? (
        <div className="agents-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditing(null); }}>
          <form className="agents-edit-modal" onSubmit={(event) => void saveEdit(event)}>
            <header>
              <div><p className="agents-page-eyebrow">Agent settings</p><h2>Edit agent</h2></div>
              <button type="button" className="agents-modal-close" onClick={() => setEditing(null)} disabled={busy} aria-label="Close"><X size={18} /></button>
            </header>
            <label>Agent name<input value={form.agentName} onChange={(event) => updateForm('agentName', event.target.value)} required /></label>
            <label>Description<textarea rows={2} value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></label>
            <label>Main instruction<textarea rows={7} value={form.mainInstruction} onChange={(event) => updateForm('mainInstruction', event.target.value)} required /></label>
            <div className="agents-edit-fields">
              <label>Child agents (comma-separated)<input value={form.agents} onChange={(event) => updateForm('agents', event.target.value)} /></label>
              <label>Skills (comma-separated)<input value={form.skills} onChange={(event) => updateForm('skills', event.target.value)} /></label>
              <label>Tools (comma-separated)<input value={form.tools} onChange={(event) => updateForm('tools', event.target.value)} /></label>
              <label>Extensions (comma-separated)<input value={form.extensions} onChange={(event) => updateForm('extensions', event.target.value)} /></label>
              <label>Model (optional)<input value={form.llm} onChange={(event) => updateForm('llm', event.target.value)} /></label>
            </div>
            <footer>
              <button type="button" className="agents-cancel-button" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button type="submit" className="agents-install-button" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            </footer>
          </form>
        </div>
      ) : null}

      {agentToDelete ? (
        <ResourceDeleteDialog
          resourceType="Agent"
          resourceName={agentToDelete.agentName}
          description="The saved agent definition and its package files will be permanently removed."
          onCancel={() => setAgentToDelete(null)}
          onConfirm={confirmRemoveAgent}
        />
      ) : null}
    </section>
  );
}