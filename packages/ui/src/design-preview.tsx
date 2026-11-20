import { useState } from 'react';
import {
  Button,
  Card,
  Chip,
  DataTable,
  DialogFrame,
  EmptyState,
  PageHeader,
  SearchBar,
  SelectField,
  Sheet,
  TabsBar,
  TextAreaField,
  TextField,
  useToast,
} from './components';

const rows = [
  { id: '1', name: 'Harbour sample tea', code: 'HST-1', onHand: '24 tins' },
  { id: '2', name: 'North pier soap', code: 'NPS-4', onHand: '80 bars' },
];

/** Operator and local preview of the shared components. Fictional data only. */
export function DesignPreview() {
  const notify = useToast();
  const [name, setName] = useState('Harbour sample tea');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('stock');
  const [tab, setTab] = useState('buttons');
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [filter, setFilter] = useState('all');

  return (
    <>
      <PageHeader
        title="Design Preview"
        description="The shared pieces both apps use. This page is for checking the standard, not for company work."
        actions={
          <Button onClick={() => notify({ title: 'Saved. This is a sample toast.' })}>
            Primary Action
          </Button>
        }
      />
      <TabsBar
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'buttons', label: 'Actions' },
          { value: 'fields', label: 'Fields' },
          { value: 'table', label: 'Table' },
        ]}
      />
      {tab === 'buttons' ? (
        <Card title="Buttons And Status">
          <div className="ui-actions">
            <Button>Save</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Remove</Button>
          </div>
          <div className="ui-chips" style={{ marginTop: 16 }}>
            <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </Chip>
            <Chip pressed={filter === 'open'} onClick={() => setFilter('open')}>
              Open
            </Chip>
            <Chip>Quiet</Chip>
          </div>
          <div className="ui-actions" style={{ marginTop: 16 }}>
            <Button variant="secondary" onClick={() => setDialog(true)}>
              Open Dialog
            </Button>
            <Button variant="secondary" onClick={() => setSheet(true)}>
              Open Sheet
            </Button>
          </div>
        </Card>
      ) : null}
      {tab === 'fields' ? (
        <Card title="Fields">
          <div className="ui-form">
            <TextField label="Name" value={name} onChange={setName} />
            <SelectField label="Kind" value={kind} onChange={setKind}>
              <option value="stock">Stock</option>
              <option value="service">Service</option>
            </SelectField>
            <TextAreaField label="Note" value={note} onChange={setNote} hint="Optional." />
            <SearchBar onOpen={() => notify({ title: 'Search opens the jump list.' })} />
          </div>
        </Card>
      ) : null}
      {tab === 'table' ? (
        <Card title="Table">
          <DataTable
            rows={filter === 'open' ? rows.slice(0, 1) : rows}
            getRowId={(row) => row.id}
            emptyTitle="Nothing to show"
            emptyBody="Clear the filter to see the sample rows again."
            columns={[
              {
                key: 'name',
                header: 'Name',
                cell: (row) => row.name,
                sortValue: (row) => row.name,
              },
              { key: 'code', header: 'Code', cell: (row) => row.code },
              { key: 'onHand', header: 'On Hand', cell: (row) => row.onHand },
            ]}
          />
        </Card>
      ) : null}
      <div style={{ height: 16 }} />
      <EmptyState
        title="Nothing waiting"
        body="Empty states say what to do next. This one is only an example."
        action={<Button variant="secondary">Start Something</Button>}
      />
      <DialogFrame
        open={dialog}
        onOpenChange={setDialog}
        title="Confirm"
        description="A short dialog."
      >
        <div className="ui-actions">
          <Button variant="secondary" onClick={() => setDialog(false)}>
            Cancel
          </Button>
          <Button onClick={() => setDialog(false)}>Continue</Button>
        </div>
      </DialogFrame>
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Details"
        description="A sheet from the side."
      >
        <p>Sheets hold a short task without leaving the page.</p>
        <Button variant="secondary" onClick={() => setSheet(false)}>
          Close
        </Button>
      </Sheet>
    </>
  );
}
