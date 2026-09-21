import {
  Bot,
  Blocks,
  ChevronDown,
  PlugZap,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';

import type { AvailableSkill } from './skillTypes';
import type { AvailableExtension } from './extensionTypes';
import type { AvailableAgent } from './agentTypes';
import type { AvailableMcpServer } from './mcpTypes';

import './ResourceToggleMenu.css';

type ResourceToggleMenuProps = {
  skills: AvailableSkill[];
  extensions: AvailableExtension[];
  agents: AvailableAgent[];
  mcpServers: AvailableMcpServer[];

  /** Names/ids pinned (always active) for this conversation. */
  pinnedSkillNames: string[];
  pinnedExtensionIds: string[];
  pinnedAgentName: string | null;
  pinnedMcpServerIds: string[];

  onToggleSkill: (skill: AvailableSkill, nextActive: boolean) => void;
  onToggleExtension: (
    extension: AvailableExtension,
    nextActive: boolean,
  ) => void;
  onToggleAgent: (agent: AvailableAgent, nextActive: boolean) => void;
  onToggleMcpServer: (
    server: AvailableMcpServer,
    nextActive: boolean,
  ) => void;

  isLoading: boolean;
  error: string | null;
  onClose: () => void;
};

type SectionState = {
  items: {
    key: string;
    title: string;
    description: string;
    active: boolean;
    onToggle: () => void;
  }[];
};

function ToggleSwitch({ active }: { active: boolean }) {
  return (
    <span
      className={`resource-toggle-switch${
        active ? ' resource-toggle-switch--on' : ''
      }`}
      aria-hidden="true"
    >
      <span className="resource-toggle-knob" />
    </span>
  );
}

function ResourceSection({
  icon,
  label,
  state,
}: {
  icon: React.ReactNode;
  label: string;
  state: SectionState;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (state.items.length === 0) {
    return null;
  }

  const activeCount = state.items.filter((item) => item.active).length;

  return (
    <div className="resource-section">
      <button
        type="button"
        className="resource-section-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="resource-section-icon">{icon}</span>
        <span className="resource-section-label">{label}</span>
        {activeCount > 0 && (
          <span className="resource-section-count">
            {activeCount} active
          </span>
        )}
        <ChevronDown
          size={13}
          className={`resource-section-chevron${
            isExpanded ? ' resource-section-chevron--open' : ''
          }`}
        />
      </button>

      {isExpanded && (
        <div className="resource-section-items">
          {state.items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`resource-item${
                item.active ? ' resource-item--active' : ''
              }`}
              onClick={item.onToggle}
              role="switch"
              aria-checked={item.active}
              title={
                item.active
                  ? `Click to deactivate ${item.title} for this chat`
                  : `Click to activate ${item.title} for this chat`
              }
            >
              <span className="resource-item-text">
                <span className="resource-item-title">{item.title}</span>
                <span className="resource-item-description">
                  {item.description}
                </span>
              </span>
              <ToggleSwitch active={item.active} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResourceToggleMenu({
  skills,
  extensions,
  agents,
  mcpServers,
  pinnedSkillNames,
  pinnedExtensionIds,
  pinnedAgentName,
  pinnedMcpServerIds,
  onToggleSkill,
  onToggleExtension,
  onToggleAgent,
  onToggleMcpServer,
  isLoading,
  error,
  onClose,
}: ResourceToggleMenuProps) {
  const isEmpty =
    skills.length === 0 &&
    extensions.length === 0 &&
    agents.length === 0 &&
    mcpServers.length === 0;

  return (
    <div
      className="resource-toggle-menu"
      role="dialog"
      aria-label="Activate resources for this chat"
    >
      <div className="resource-toggle-menu-header">
        <span className="resource-toggle-menu-title">
          Active for this chat
        </span>
        <span className="resource-toggle-menu-hint">
          Toggled resources stay active for every message
        </span>
        <button
          type="button"
          className="resource-toggle-menu-close"
          onClick={onClose}
          aria-label="Close resource menu"
        >
          ✕
        </button>
      </div>

      <div className="resource-toggle-menu-body">
        {error ? (
          <p className="resource-toggle-menu-error" role="alert">
            {error}
          </p>
        ) : isLoading && isEmpty ? (
          <p className="resource-toggle-menu-empty">Loading resources…</p>
        ) : isEmpty ? (
          <p className="resource-toggle-menu-empty">
            No skills, extensions, agents, or MCP servers available yet.
          </p>
        ) : (
          <>
            <ResourceSection
              icon={<Sparkles size={14} />}
              label="Skills"
              state={{
                items: skills.map((skill) => ({
                  key: skill.name,
                  title: skill.name,
                  description: skill.description,
                  active: pinnedSkillNames.includes(skill.name),
                  onToggle: () =>
                    onToggleSkill(
                      skill,
                      !pinnedSkillNames.includes(skill.name),
                    ),
                })),
              }}
            />

            <ResourceSection
              icon={<Blocks size={14} />}
              label="Extensions"
              state={{
                items: extensions.map((extension) => ({
                  key: extension.id,
                  title: extension.name,
                  description: extension.description,
                  active: pinnedExtensionIds.includes(extension.id),
                  onToggle: () =>
                    onToggleExtension(
                      extension,
                      !pinnedExtensionIds.includes(extension.id),
                    ),
                })),
              }}
            />

            <ResourceSection
              icon={<Bot size={14} />}
              label="Agents"
              state={{
                items: agents.map((agent) => ({
                  key: agent.id,
                  title: agent.name,
                  description: agent.description,
                  active: pinnedAgentName === agent.name,
                  onToggle: () =>
                    onToggleAgent(agent, pinnedAgentName !== agent.name),
                })),
              }}
            />

            <ResourceSection
              icon={<PlugZap size={14} />}
              label="MCP Servers"
              state={{
                items: mcpServers.map((server) => ({
                  key: server.id,
                  title: server.name,
                  description: server.description,
                  active: pinnedMcpServerIds.includes(server.id),
                  onToggle: () =>
                    onToggleMcpServer(
                      server,
                      !pinnedMcpServerIds.includes(server.id),
                    ),
                })),
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
