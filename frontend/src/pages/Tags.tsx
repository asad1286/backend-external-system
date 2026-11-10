import { useState } from 'react';
import { useApp } from '../state';
import { Badge, Button, Card, Input, when } from '../ui';
import { DataTable, EndpointForm, ScopeNote, Split, Tabs, useAction, useApi } from '../kit';

type Tag = { id: number | null; name: string; source?: string; created_at?: string };
type FieldRow = { id: number; field_key: string; field_label: string; field_type: string; options?: string[]; is_required?: boolean; sort_order?: number };

/** Tags and custom fields: the contact data model of a workspace. */
export default function Tags() {
  const { workspaceId } = useApp();
  const [view, setView] = useState<'tags' | 'fields'>('tags');
  return (
    <>
      <ScopeNote scopes={['contacts.read', 'contacts.write']} />
      <Tabs value={view} onChange={setView} tabs={[{ id: 'tags', label: 'Tags' }, { id: 'fields', label: 'Custom fields' }]} />
      {view === 'tags' ? <TagList workspaceId={workspaceId!} /> : <FieldList workspaceId={workspaceId!} />}
    </>
  );
}

function TagList({ workspaceId }: { workspaceId: number }) {
  const [search, setSearch] = useState('');
  const list = useApi('list-tags', { query: { workspace_id: workspaceId, search: search.trim() || undefined, include_in_use: 1 } });
  const { act, busy } = useAction();
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const rows = list.rows as Tag[];

  return (
    <Split
      side={
        <Card title="Create a tag">
          <EndpointForm slug="create-tag" fixed={{ workspace_id: workspaceId }} submit="Create tag" onDone={list.reload} />
        </Card>
      }
    >
      <Card
        title={`Tags (${rows.length})`}
        actions={
          <>
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 180 }} />
            <Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>
          </>
        }
        pad={false}
      >
        <DataTable
          rows={rows}
          loading={list.loading}
          rowKey={(t) => t.id ?? `in-use-${t.name}`}
          empty="No tags"
          columns={[
            {
              label: 'Name',
              render: (t) =>
                editing === t.id ? (
                  <div className="row">
                    <Input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} autoFocus />
                    <Button className="btn-sm" busy={busy === `ren-${t.id}`} onClick={() => act('rename-tag', { path: { id: t.id! }, body: { name } }, { key: `ren-${t.id}`, done: 'Tag renamed.', onDone: () => { setEditing(null); list.reload(); } })}>Save</Button>
                    <Button variant="ghost" className="btn-sm" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                ) : (
                  <Badge tone="blue">{t.name}</Badge>
                ),
            },
            { label: 'Source', render: (t) => <span className="muted">{t.source || '—'}</span> },
            { label: 'Created', render: (t) => <span className="muted">{when(t.created_at)}</span> },
            {
              label: '',
              render: (t) =>
                t.id === null || t.id === undefined ? (
                  <span className="muted">on contacts only — not in the library</span>
                ) : (
                <div className="row row-end">
                  <Button variant="ghost" className="btn-sm" onClick={() => { setEditing(t.id); setName(t.name); }}>Rename</Button>
                  <Button variant="danger" className="btn-sm" busy={busy === `del-${t.id}`} onClick={() => act('delete-tag', { path: { id: t.id! } }, { key: `del-${t.id}`, confirm: `Delete the tag "${t.name}"? It comes off every contact.`, done: 'Tag deleted.', onDone: list.reload })}>Delete</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </Split>
  );
}

function FieldList({ workspaceId }: { workspaceId: number }) {
  const list = useApi('list-custom-fields', { query: { workspace_id: workspaceId } });
  const { act, busy } = useAction();
  const [selected, setSelected] = useState<FieldRow | null>(null);
  const rows = list.rows as FieldRow[];

  return (
    <Split
      side={
        selected ? (
          <Card title={`Edit “${selected.field_label}”`} actions={<Button variant="ghost" className="btn-sm" onClick={() => setSelected(null)}>New field</Button>}>
            <div className="muted">Key <code>{selected.field_key}</code> stays the same.</div>
            <EndpointForm slug="update-custom-field" path={{ id: selected.id }} initial={selected} changesOnly submit="Save changes" onDone={list.reload} />
          </Card>
        ) : (
          <Card title="Create a custom field">
            <EndpointForm slug="create-custom-field" fixed={{ workspace_id: workspaceId }} submit="Create field" onDone={list.reload} />
          </Card>
        )
      }
    >
      <Card title={`Custom fields (${rows.length})`} actions={<Button variant="ghost" className="btn-sm" busy={list.loading} onClick={list.reload}>Reload</Button>} pad={false}>
        <DataTable
          rows={rows}
          loading={list.loading}
          rowKey={(f) => f.id}
          selected={selected?.id}
          onRow={setSelected}
          empty="No custom fields"
          columns={[
            { label: 'Label', render: (f) => <><div className="strong">{f.field_label}</div><div className="muted"><code>{f.field_key}</code></div></> },
            { label: 'Type', render: (f) => <Badge tone="violet">{f.field_type}</Badge> },
            { label: 'Options', render: (f) => <div className="chips">{(f.options || []).slice(0, 5).map((o) => <Badge key={o} tone="gray">{o}</Badge>)}</div> },
            { label: 'Required', render: (f) => (f.is_required ? <Badge tone="amber">required</Badge> : <span className="muted">no</span>) },
            { label: 'Order', render: (f) => f.sort_order ?? '—' },
            {
              label: '',
              render: (f) => (
                <div className="row row-end" onClick={(e) => e.stopPropagation()}>
                  <Button variant="danger" className="btn-sm" busy={busy === `del-${f.id}`} onClick={() => act('delete-custom-field', { path: { id: f.id } }, { key: `del-${f.id}`, confirm: `Delete “${f.field_label}”? Its values on contacts are dropped.`, done: 'Field deleted.', onDone: () => { if (selected?.id === f.id) setSelected(null); list.reload(); } })}>Delete</Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </Split>
  );
}
