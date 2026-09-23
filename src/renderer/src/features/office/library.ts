import type { Workspace } from '../../../../shared/types';
import { useApp } from '../../state';

export const OFFICE_LIBRARY_ID = 'office-library';
/** The coworkers who work in the Library and can search imported documents. */
export const LIBRARY_RESIDENTS: readonly string[] = ['knowledge-librarian', 'research-analyst', 'writer'];

/**
 * The workspace through which the Library's coworkers reach every imported document. Knowledge
 * retrieval is scoped to a conversation's workspace, and the office has no other workspace UI.
 * Returns null when the saved workspace already lists exactly these documents.
 */
export function officeLibraryWorkspace(
  existing: Workspace | undefined,
  documentIds: string[],
  now: number
): Workspace | null {
  const ids = [...documentIds].sort();
  if (existing && [...existing.knowledgeDocIds].sort().join('\n') === ids.join('\n')) return null;
  return {
    id: OFFICE_LIBRARY_ID,
    name: 'Office Library',
    description: 'Documents the Library can search.',
    icon: '📚',
    systemPrompt: '',
    instructions: '',
    defaultProviderId: null,
    defaultModelId: null,
    enabledTools: [],
    knowledgeDocIds: ids,
    skillIds: [],
    roleIds: [],
    fileAccess: { enabled: false, roots: [] },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

/** Brings the Office Library in line with the imported documents; returns its id. */
export async function syncOfficeLibrary(): Promise<string> {
  const data = useApp.getState().data;
  if (!data) return OFFICE_LIBRARY_ID;
  const next = officeLibraryWorkspace(
    data.workspaces.find((w) => w.id === OFFICE_LIBRARY_ID),
    data.documents.map((d) => d.id),
    Date.now()
  );
  if (next) {
    await window.axon.workspaceSave(next);
    await useApp.getState().refresh();
  }
  return OFFICE_LIBRARY_ID;
}
