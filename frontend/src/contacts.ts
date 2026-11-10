import { useCallback, useEffect, useState } from 'react';
import { ext, ok } from './api';

export type Contact = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  company_name?: string | null;
  tags?: string[] | null;
  created_at?: string;
};

export const contactName = (c: Contact) => [c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone_number || c.email || `Contact #${c.id}`;

/** Up to 200 contacts of the workspace, for pickers. */
export function useContactPicker(workspaceId: number | null) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const load = useCallback(async () => {
    if (!workspaceId) return setContacts([]);
    const r = await ext('GET', '/contacts', { query: { workspace_id: workspaceId, limit: 200 } });
    setContacts(ok(r) && Array.isArray(r.data?.data) ? r.data.data : []);
  }, [workspaceId]);
  useEffect(() => {
    load();
  }, [load]);
  return { contacts, reload: load };
}
