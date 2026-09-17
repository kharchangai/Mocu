import { Bot, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  listAvailableAgents,
  type AvailableAgent,
} from '../../agent/agent-loader';
import './agents.css';

export function AgentsPage() {
  const [agents, setAgents] = useState<AvailableAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setAgents(await listAvailableAgents());
    } catch (loadError) {
      setAgents([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load agents.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  return (
    <section className="agents-page">
      <header className="agents-page-header">
        <div>
          <p className="agents-page-eyebrow">Specialists</p>
          <h1>Agents</h1>
          <p>Saved agents can be called from chat with <code>/agent</code>.</p>
        </div>
        <button
          type="button"
          className="agents-refresh-button"
          onClick={() => void loadAgents()}
          disabled={isLoading}
          aria-label="Refresh agents"
          title="Refresh agents"
        >
          <RefreshCw size={16} className={isLoading ? 'agents-refresh-spin' : ''} />
        </button>
      </header>

      {error ? <p className="agents-message agents-message-error">{error}</p> : null}
      {isLoading ? (
        <p className="agents-message">Loading agents...</p>
      ) : agents.length === 0 ? (
        <div className="agents-empty-state">
          <Bot size={28} />
          <h2>No agents yet</h2>
          <p>Create an agent definition in AppData/agents or use the agent definition parser.</p>
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
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
