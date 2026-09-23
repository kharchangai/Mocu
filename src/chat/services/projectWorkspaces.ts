import { exists, mkdir } from '@tauri-apps/plugin-fs';

export type ProjectWorkspace = {
  path: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = 'mocu-project-workspaces-v1';

export function normalizeProjectPath(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, '');
  return normalized.includes('\\') ? normalized.toLowerCase() : normalized;
}

export function getProjectFolderName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || 'Project';
}

export function loadProjectWorkspaces(): ProjectWorkspace[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is ProjectWorkspace =>
      Boolean(
        item &&
          typeof item === 'object' &&
          typeof item.path === 'string' &&
          typeof item.name === 'string' &&
          typeof item.description === 'string' &&
          typeof item.createdAt === 'string' &&
          typeof item.updatedAt === 'string',
      ),
    );
  } catch (error) {
    console.warn('[Projects] Could not load saved projects:', error);
    return [];
  }
}

export function saveProjectWorkspaces(
  projects: ProjectWorkspace[],
): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (error) {
    console.error('[Projects] Could not save projects:', error);
  }
}

export function upsertProjectWorkspace(
  projects: ProjectWorkspace[],
  details: Pick<ProjectWorkspace, 'path' | 'name' | 'description'>,
): ProjectWorkspace[] {
  const normalizedPath = normalizeProjectPath(details.path);
  const existing = projects.find(
    (project) => normalizeProjectPath(project.path) === normalizedPath,
  );
  const now = new Date().toISOString();
  const project: ProjectWorkspace = {
    ...details,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  return [
    project,
    ...projects.filter(
      (item) => normalizeProjectPath(item.path) !== normalizedPath,
    ),
  ];
}

export function getNewProjectPath(
  parentPath: string,
  projectName: string,
): string {
  const safeFolderName = projectName
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ');

  if (!safeFolderName || safeFolderName === '.' || safeFolderName === '..') {
    throw new Error('Choose a project name that can be used as a folder name.');
  }

  const normalizedParent = parentPath.trim().replace(/[\\/]+$/, '');
  const separator = normalizedParent.includes('\\') ? '\\' : '/';
  return `${normalizedParent}${separator}${safeFolderName}`;
}

/** Creates a new, empty project directory without touching existing folders. */
export async function createProjectFolder(path: string): Promise<void> {
  if (await exists(path)) {
    throw new Error(
      'A folder with that name already exists here. Open it as an existing project, or choose another location or name.',
    );
  }

  await mkdir(path);
}
