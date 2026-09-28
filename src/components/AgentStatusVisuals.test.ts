// src/components/AgentStatusVisuals.test.ts
//
// Guards the Mocu avatar bubble: EVERY tool the avatar can run must
// have its OWN icon (no empty bubble, no shared generic look for two
// different tools).

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AgentStatusIcon,
  AVATAR_TOOL_ICONS,
  getStatusAccent,
} from './AgentStatusVisuals';

// Tools the Mocu avatar can use (src/services/ai/nodes.ts).
const AVATAR_TOOLS = [
  'schedule_action',
  'desktop_vision_action',
  'terminal_executor',
  'perplexity_search',
  'text_to_speech',
  'speech_control',
  'save_note',
  'read_note',
  'update_note',
  'delete_note',
  'list_notes',
];

// Planning / workflow / focus tools.
const PLANNING_TOOLS = [
  'update_plan',
  'move_to_next_step',
  'finish_workflow',
  'read_step_logs',
  'read_log_entry',
  'read_step_memory',
  'read_focus_section_memory',
  'read_focus_section_history',
  'read_focus_history_entry',
  'record_focus_milestone',
  'next_focus_section',
  'end_focus',
];

const ALL_TOOLS = [...AVATAR_TOOLS, ...PLANNING_TOOLS];

describe('every avatar tool has its own icon', () => {
  it('registers an icon for every tool', () => {
    for (const tool of ALL_TOOLS) {
      expect(AVATAR_TOOL_ICONS[tool], tool).toBeDefined();
    }
  });

  it('renders a visible icon for every tool', () => {
    for (const tool of ALL_TOOLS) {
      const html = renderToStaticMarkup(
        createElement(AgentStatusIcon, { state: tool }),
      );
      expect(html.length, tool).toBeGreaterThan(50);
    }
  });

  it('gives every tool a DIFFERENT icon', () => {
    const seen = new Map<string, string>();

    for (const tool of ALL_TOOLS) {
      const html = renderToStaticMarkup(
        createElement(AVATAR_TOOL_ICONS[tool]),
      );
      const duplicate = seen.get(html);
      expect(duplicate, `${tool} reuses the icon of ${duplicate}`).toBeUndefined();
      seen.set(html, tool);
    }

    expect(seen.size).toBe(ALL_TOOLS.length);
  });

  it('never renders an empty bubble for unknown tools', () => {
    const html = renderToStaticMarkup(
      createElement(AgentStatusIcon, { state: 'some_future_tool' }),
    );
    expect(html).toContain('<svg');
  });
});

describe('getStatusAccent', () => {
  it('returns a color for every tool', () => {
    for (const tool of ALL_TOOLS) {
      expect(getStatusAccent(tool), tool).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
