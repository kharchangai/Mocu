import type { AvailableAgent } from './agentTypes';

export function filterAgents(
  agents: AvailableAgent[],
  query: string,
): AvailableAgent[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return agents;
  }

  return agents.filter((agent) =>
    [agent.name, agent.description]
      .some((value) => value.toLowerCase().includes(normalizedQuery)),
  );
}
