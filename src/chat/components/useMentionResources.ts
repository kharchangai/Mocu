import { useEffect, useState } from 'react';
import { listAvailableSkills } from '../services/skillService';
import { listAvailableAgents } from '../agent/agent-loader';
import { scanInstalledExtensions } from '../../extensions/services/extension-scanner';
import type { MentionResourceNames } from './SlashMentionText';

/*
 * Loads the names of every available skill, extension, and agent so
 * rendered text can tell which "/command <name>" tokens reference a
 * real resource. Sent user messages use this to highlight exactly the
 * resource names that were selected, instead of guessing where a name
 * ends.
 */
export function useMentionResources(): MentionResourceNames {
  const [resourceNames, setResourceNames] =
    useState<MentionResourceNames>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [skills, extensions, agents] = await Promise.all([
        listAvailableSkills().catch(() => []),
        scanInstalledExtensions().catch(() => []),
        listAvailableAgents().catch(() => []),
      ]);

      if (cancelled) {
        return;
      }

      setResourceNames({
        skill: skills.map((skill) => skill.name),
        extension: extensions.map(
          (extension) => extension.manifest.name,
        ),
        agent: agents.map((agent) => agent.agentName),
      });
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return resourceNames;
}
