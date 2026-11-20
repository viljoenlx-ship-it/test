import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, Card, ConfirmDialog, PageHeader, SelectField } from './components';
import { useToast } from './components';

export type ImportCaller = {
  request(
    path: string,
    init?: { method?: string; json?: unknown; form?: FormData },
  ): Promise<{ status: number; body: unknown }>;
  download(path: string, filename: string): Promise<void>;
};

type TargetInfo = {
  id: string;
  label: string;
  summary: string;
  needsVatChoice: boolean;
  fields: { key: string; label: string; required: boolean; hint: string }[];
};

type Counts = {
  total: number;
  ready: number;
  invalid: number;
  duplicate: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  processed: number;
};

type Batch = {
  id: string;
  targetId: string;
  targetLabel: string;
  fileName: string;
  status: string;
  duplicatePolicy: 'skip' | 'update';
  vatTreatment: string;
  columns: { header: string; fieldKey: string | null }[];
  fields: { key: string; label: string; required: boolean }[];
  warnings: string[];
  counts: Counts;
  canUndo: boolean;
};

type PreviewRow = {
  rowNumber: number;
  status: string;
  messages: string[];
  values: Record<string, string>;
};

type HistoryRow = {
  id: string;
  targetLabel: string;
  fileName: string;
  status: string;
  createdAt: string;
  created: number;
};

const STEPS = ['Choose', 'File', 'Columns', 'Check', 'Done'] as const;

function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return fallback;
}

function isBatch(value: unknown): value is Batch {
  return Boolean(value && typeof value === 'object' && 'counts' in value && 'id' in value);
}

export function ImportWizard({
  caller,
  companyName,
}: {
  caller: ImportCaller;
  companyName?: string;
}) {
  const notify = useToast();
  const [targets, setTargets] = useState<TargetInfo[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [targetId, setTargetId] = useState('');
  const [step, setStep] = useState<(typeof STEPS)[number] | 'Working'>('Choose');
  const [policy, setPolicy] = useState<'skip' | 'update'>('skip');
  const [vat, setVat] = useState<'exclusive' | 'inclusive'>('exclusive');
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmUndo, setConfirmUndo] = useState(false);

  const target = targets?.find((item) => item.id === targetId) ?? null;

  async function loadHome() {
    const listed = await caller.request('/imports/targets');
    if (listed.status === 401) {
      setError('Sign in to import a spreadsheet.');
      setTargets([]);
      return;
    }
    if (listed.status >= 400) {
      setError(messageOf(listed.body, 'The import list could not be loaded.'));
      setTargets([]);
      return;
    }
    const body = listed.body as { targets?: TargetInfo[] };
    setTargets(body.targets ?? []);
    const past = await caller.request('/imports');
    if (
      past.status === 200 &&
      past.body &&
      typeof past.body === 'object' &&
      'batches' in past.body
    ) {
      setHistory((past.body as { batches: HistoryRow[] }).batches);
    }
  }

  useEffect(() => {
    void loadHome();
  }, []);

  const trail = step === 'Working' ? 'Check' : step;

  const workTotal = batch
    ? batch.counts.processed + batch.counts.ready + batch.counts.duplicate
    : 0;
  const percent = workTotal === 0 ? 0 : Math.round((batch!.counts.processed / workTotal) * 100);

  const columnFields = useMemo(() => batch?.fields ?? target?.fields ?? [], [batch, target]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !target) {
      setError('Choose a file first.');
      return;
    }
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('targetId', target.id);
    form.set('duplicatePolicy', policy);
    form.set('vatTreatment', target.needsVatChoice ? vat : 'exclusive');
    form.set('file', file);
    const result = await caller.request('/imports', { method: 'POST', form });
    setBusy(false);
    if (result.status >= 400 || !result.body || typeof result.body !== 'object') {
      setError(messageOf(result.body, 'That file could not be read.'));
      return;
    }
    const payload = result.body as { batch?: Batch; rows?: PreviewRow[] };
    if (!payload.batch) {
      setError('That file could not be read.');
      return;
    }
    openBatch(payload.batch, payload.rows ?? [], 'Columns');
  }

  function openBatch(next: Batch, preview: PreviewRow[], nextStep: (typeof STEPS)[number]) {
    setBatch(next);
    setRows(preview);
    const map: Record<string, string> = {};
    for (const column of next.columns) {
      map[column.header] = column.fieldKey ?? '';
    }
    setColumns(map);
    setPolicy(next.duplicatePolicy);
    if (next.vatTreatment === 'inclusive' || next.vatTreatment === 'exclusive') {
      setVat(next.vatTreatment);
    }
    setStep(nextStep);
  }

  async function saveColumns(): Promise<boolean> {
    if (!batch) {
      return false;
    }
    setBusy(true);
    setError('');
    const result = await caller.request(`/imports/${batch.id}/mapping`, {
      method: 'PUT',
      json: {
        columns,
        duplicatePolicy: policy,
        vatTreatment: vat,
      },
    });
    setBusy(false);
    if (result.status >= 400 || !result.body || typeof result.body !== 'object') {
      setError(messageOf(result.body, 'The column match was not saved.'));
      return false;
    }
    const payload = result.body as { batch?: Batch; rows?: PreviewRow[] };
    if (!payload.batch) {
      setError('The column match was not saved.');
      return false;
    }
    openBatch(payload.batch, payload.rows ?? [], 'Check');
    return true;
  }

  async function runImport() {
    if (!batch) {
      return;
    }
    setStep('Working');
    setError('');
    let current = batch;
    for (let guard = 0; guard < 200; guard += 1) {
      const result = await caller.request(`/imports/${current.id}/advance`, { method: 'POST' });
      if (result.status >= 400 || !result.body || typeof result.body !== 'object') {
        setError(messageOf(result.body, 'The import stopped.'));
        setStep('Check');
        return;
      }
      const next = (result.body as { batch?: Batch }).batch;
      if (!next || !isBatch(next)) {
        setError('The import stopped.');
        setStep('Check');
        return;
      }
      current = next;
      setBatch(next);
      if (next.status === 'completed' || next.status === 'undone') {
        setStep('Done');
        notify({ title: 'Import finished.' });
        await loadHome();
        return;
      }
    }
    setError('The import is still running. Refresh this page to see it.');
  }

  async function undo() {
    if (!batch) {
      return;
    }
    setBusy(true);
    const result = await caller.request(`/imports/${batch.id}/undo`, { method: 'POST' });
    setBusy(false);
    setConfirmUndo(false);
    if (result.status >= 400 || !result.body || typeof result.body !== 'object') {
      setError(messageOf(result.body, 'This import could not be undone.'));
      notify({ title: messageOf(result.body, 'This import could not be undone.'), tone: 'bad' });
      return;
    }
    const next = (result.body as { batch?: Batch }).batch;
    if (next) {
      setBatch(next);
    }
    notify({ title: 'Import undone. The records were archived, not deleted.' });
    await loadHome();
  }

  const title = companyName ? `Import Data For ${companyName}` : 'Import Data';

  return (
    <>
      <PageHeader
        title={title}
        description="Bring in contacts or stock from Excel or CSV. You can also take a copy out."
      />
      <p className="ui-steps">
        {STEPS.map((name) => (
          <span key={name} aria-current={trail === name ? 'step' : undefined}>
            {name}
          </span>
        ))}
      </p>
      {error ? (
        <Card>
          <p className="ui-error">{error}</p>
        </Card>
      ) : null}

      {step === 'Choose' ? (
        <Card title="What are you importing?">
          {targets === null ? <p>Loading…</p> : null}
          {targets && targets.length === 0 ? (
            <p>You do not have permission to import, or you need to sign in.</p>
          ) : null}
          <div className="ui-choice-grid">
            {(targets ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                className="ui-choice"
                onClick={() => {
                  setTargetId(item.id);
                  setFile(null);
                  setError('');
                  setStep('File');
                }}
              >
                <strong>{item.label}</strong>
                <span>{item.summary}</span>
              </button>
            ))}
          </div>
          {targets && targets.length > 0 ? (
            <>
              <h2>Take A Copy Out</h2>
              <p className="ui-note">
                Download the contacts or stock items already stored for this company.
              </p>
              <div className="ui-actions">
                {targets.map((item) => (
                  <span key={item.id} className="ui-actions">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void caller
                          .download(`/exports/${item.id}/xlsx`, `${item.id}.xlsx`)
                          .catch(() => setError('The Excel file could not be downloaded.'));
                      }}
                    >
                      {item.label} Excel
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void caller
                          .download(`/exports/${item.id}/csv`, `${item.id}.csv`)
                          .catch(() => setError('The CSV file could not be downloaded.'));
                      }}
                    >
                      {item.label} CSV
                    </Button>
                  </span>
                ))}
              </div>
            </>
          ) : null}
          {history.length > 0 ? (
            <>
              <h2>Recent Imports</h2>
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Type</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td>{row.fileName}</td>
                        <td>{row.targetLabel}</td>
                        <td>
                          {statusText(row.status)}
                          {row.created > 0 ? ` · ${row.created} added` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      {step === 'File' && target ? (
        <Card title={`Upload ${target.label}`}>
          <p className="ui-note">
            Start from a template, or upload a file you already have. The first row must be the
            column names.
          </p>
          <div className="ui-actions">
            <Button
              variant="secondary"
              onClick={() => {
                void caller.download(
                  `/imports/templates/${target.id}/xlsx`,
                  `${target.id}-template.xlsx`,
                );
              }}
            >
              Download Excel Template
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void caller.download(
                  `/imports/templates/${target.id}/csv`,
                  `${target.id}-template.csv`,
                );
              }}
            >
              Download CSV Template
            </Button>
          </div>
          <form className="ui-form" onSubmit={(event) => void upload(event)}>
            <label className="ui-field ui-file">
              <span>Your File</span>
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <SelectField
              label="If A Row Matches One You Already Have"
              value={policy}
              onChange={(value) => setPolicy(value === 'update' ? 'update' : 'skip')}
            >
              <option value="skip">Skip It</option>
              <option value="update">Update The Existing Record</option>
            </SelectField>
            {target.needsVatChoice ? (
              <SelectField
                label="Prices In The File"
                value={vat}
                onChange={(value) => setVat(value === 'inclusive' ? 'inclusive' : 'exclusive')}
              >
                <option value="exclusive">Are Before VAT</option>
                <option value="inclusive">Include VAT</option>
              </SelectField>
            ) : null}
            <div className="ui-actions">
              <Button type="submit" disabled={busy || !file}>
                {busy ? 'Reading…' : 'Read The File'}
              </Button>
              <Button variant="secondary" onClick={() => setStep('Choose')}>
                Back
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {step === 'Columns' && batch ? (
        <Card title="Match The Columns">
          <p className="ui-note">
            {batch.fileName}. We matched columns by their names. Change any that landed in the wrong
            place. This match is remembered for next time.
          </p>
          {batch.warnings.map((warning) => (
            <p key={warning} className="ui-error">
              {warning}
            </p>
          ))}
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Column In Your File</th>
                  <th>Field In Omnivate</th>
                </tr>
              </thead>
              <tbody>
                {batch.columns.map((column) => (
                  <tr key={column.header}>
                    <td>{column.header}</td>
                    <td>
                      <label className="ui-sr" htmlFor={`map-${column.header}`}>
                        Field for {column.header}
                      </label>
                      <select
                        id={`map-${column.header}`}
                        value={columns[column.header] ?? ''}
                        onChange={(event) =>
                          setColumns((current) => ({
                            ...current,
                            [column.header]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Do Not Import</option>
                        {columnFields.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                            {field.required ? ' (Required)' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ui-actions">
            <Button disabled={busy} onClick={() => void saveColumns()}>
              {busy ? 'Checking…' : 'Check The Rows'}
            </Button>
            <Button variant="secondary" onClick={() => setStep('File')}>
              Back
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 'Check' && batch ? (
        <Card title="Check Before Importing">
          <CountsLine counts={batch.counts} />
          {batch.vatTreatment === 'inclusive' ? (
            <p className="ui-note">
              Prices in this file include VAT. Omnivate stores the amount before VAT.
            </p>
          ) : null}
          {batch.vatTreatment === 'exclusive' ? (
            <p className="ui-note">Prices in this file are before VAT.</p>
          ) : null}
          <SelectField
            label="Duplicates"
            value={policy}
            onChange={(value) => setPolicy(value === 'update' ? 'update' : 'skip')}
          >
            <option value="skip">Skip Rows That Already Exist</option>
            <option value="update">Update Rows That Already Exist</option>
          </SelectField>
          <PreviewTable rows={rows} total={batch.counts.total} />
          <div className="ui-actions">
            <Button
              disabled={busy || batch.counts.ready + batch.counts.duplicate === 0}
              onClick={() => {
                void (async () => {
                  if (policy !== batch.duplicatePolicy) {
                    const saved = await saveColumns();
                    if (!saved) {
                      return;
                    }
                  }
                  await runImport();
                })();
              }}
            >
              Import {batch.counts.ready + batch.counts.duplicate} Rows
            </Button>
            <Button variant="secondary" onClick={() => setStep('Columns')}>
              Back
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 'Working' && batch ? (
        <Card title="Importing">
          <p>
            {batch.counts.processed.toLocaleString('en-ZA')} of {workTotal.toLocaleString('en-ZA')}{' '}
            rows
          </p>
          <div
            className="ui-progress"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Import Progress"
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        </Card>
      ) : null}

      {step === 'Done' && batch ? (
        <Card title="Import Finished">
          <p>
            <Badge tone={batch.status === 'undone' ? 'warn' : 'ok'}>
              {statusText(batch.status)}
            </Badge>
          </p>
          <CountsLine counts={batch.counts} />
          <p className="ui-note">{batch.fileName} is recorded with who imported it and when.</p>
          <div className="ui-actions">
            <Button
              variant="secondary"
              onClick={() => {
                void caller.download(`/imports/${batch.id}/errors`, 'import-errors.csv');
              }}
            >
              Download Error Report
            </Button>
            {batch.canUndo ? (
              <Button variant="danger" onClick={() => setConfirmUndo(true)}>
                Undo This Import
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setStep('Choose');
                setBatch(null);
                setFile(null);
              }}
            >
              Import Another File
            </Button>
          </div>
          {batch.status === 'completed' &&
          !batch.canUndo &&
          batch.counts.created + batch.counts.updated > 0 ? (
            <p className="ui-note">
              Undo is closed because something has changed these records since the import.
            </p>
          ) : null}
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmUndo}
        onOpenChange={setConfirmUndo}
        title="Undo this whole import?"
        body="Contacts are archived and opening stock is reversed. Nothing is deleted. This only works if nobody has changed the records since."
        confirmLabel="Undo Import"
        busy={busy}
        onConfirm={() => void undo()}
      />
    </>
  );
}

function CountsLine({ counts }: { counts: Counts }) {
  return (
    <p>
      {counts.total.toLocaleString('en-ZA')} rows · {counts.ready.toLocaleString('en-ZA')} ready ·{' '}
      {counts.invalid.toLocaleString('en-ZA')} need a fix ·{' '}
      {counts.duplicate.toLocaleString('en-ZA')} duplicates
      {counts.created + counts.updated + counts.skipped + counts.failed > 0
        ? ` · ${counts.created} added · ${counts.updated} updated · ${counts.skipped} skipped · ${counts.failed} not saved`
        : ''}
    </p>
  );
}

function PreviewTable({ rows, total }: { rows: PreviewRow[]; total: number }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <>
      <p className="ui-note">
        Showing {rows.length} of {total.toLocaleString('en-ZA')} rows, problems first.
      </p>
      <div className="ui-table-wrap">
        <table className="ui-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Result</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber}>
                <td>{row.rowNumber}</td>
                <td>{statusText(row.status)}</td>
                <td>{row.messages.join(' ') || 'Ready to import.'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function statusText(status: string): string {
  if (status === 'preview') return 'Ready To Check';
  if (status === 'running') return 'Importing';
  if (status === 'completed') return 'Finished';
  if (status === 'undone') return 'Undone';
  if (status === 'invalid') return 'Needs A Fix';
  if (status === 'duplicate') return 'Duplicate';
  if (status === 'ready') return 'Ready';
  if (status === 'created') return 'Added';
  if (status === 'updated') return 'Updated';
  if (status === 'skipped') return 'Skipped';
  if (status === 'failed') return 'Not Saved';
  return status;
}
