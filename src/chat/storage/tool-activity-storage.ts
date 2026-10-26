import type { AgentToolActivity } from '../services/toolActivity';

const LEGACY_TOOL_ACTIVITY_STORAGE_KEY = 'mocu-tool-activity-v1';

function isAgentToolActivity(value: unknown): value is AgentToolActivity {
  if (!value || typeof value !== 'object') return false;
  const activity = value as Partial<AgentToolActivity>;
  return typeof activity.id === 'string' && typeof activity.tool === 'string' &&
    (activity.status === 'running' || activity.status === 'done' || activity.status === 'error' || activity.status === 'cancelled') &&
    (activity.args === undefined || (typeof activity.args === 'object' && activity.args !== null));
}

/** Read old browser-stored activity logs only while migrating them into chat files. */
export function loadLegacyToolActivities(): Record<string, AgentToolActivity[]> {
  try {
    const raw = localStorage.getItem(LEGACY_TOOL_ACTIVITY_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([, activities]) => Array.isArray(activities))
      .map(([messageId, activities]) => [messageId, (activities as unknown[])
        .filter(isAgentToolActivity)
        .map((activity) => activity.status === 'running' ? { ...activity, status: 'done' as const } : activity)]));
  } catch (error) {
    console.error('[Tool Activity Storage] Failed to read legacy activity logs:', error);
    return {};
  }
}

/** Remove the old browser copy once migration to conversation files succeeds. */
export function clearLegacyToolActivities(): void {
  try {
    localStorage.removeItem(LEGACY_TOOL_ACTIVITY_STORAGE_KEY);
  } catch (error) {
    console.error('[Tool Activity Storage] Failed to clear legacy activity logs:', error);
  }
}
