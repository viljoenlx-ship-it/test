import {
  AGGREGATE_LABELS,
  FILTER_CONDITIONS,
  emptyReport,
  plainRoleName,
  summariseReport,
  type ReportAggregate,
  type ReportChart,
  type ReportDefinition,
  type ReportFieldType,
  type ReportVisibility,
} from '@omnivate/shared';
import {
  Button,
  Card,
  ConfirmDialog,
  DialogFrame,
  PageHeader,
  SelectField,
  TextField,
  usePhone,
  useToast,
} from '@omnivate/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { ReportChart as ChartView } from './chart';

type FieldInfo = {
  key: string;
  label: string;
  type: ReportFieldType;
  aggregations: ReportAggregate[];
  filterable: boolean;
  groupable: boolean;
};

type SourceInfo = {
  key: string;
  label: string;
  description: string;
  joins: { key: string; label: string }[];
  defaultColumns: string[];
  fields: FieldInfo[];
};

type Preview = {
  summary: string;
  columns: { key: string; label: string; type: string }[];
  rows: { text: string; chart: number | null }[][];
  footer: { key: string; text: string }[];
  totalRows: number;
  hidden: string[];
  generatedOn: string;
};

const MENUS = ['source', 'columns', 'filters', 'group', 'totals'] as const;
type Menu = (typeof MENUS)[number];
const MENU_LABEL: Record<Menu, string> = {
  source: 'Source',
  columns: 'Columns',
  filters: 'Filters',
  group: 'Group',
  totals: 'Totals',
};

const CHARTS: { key: ReportChart; label: string }[] = [
  { key: 'none', label: 'Table' },
  { key: 'bar', label: 'Bar' },
  { key: 'line', label: 'Line' },
  { key: 'pie', label: 'Pie' },
];

function sourceDraft(source: SourceInfo): ReportDefinition {
  return {
    ...emptyReport(source.key),
    columns:
      source.defaultColumns.length > 0
        ? [...source.defaultColumns]
        : source.fields.slice(0, 4).map((field) => field.key),
    sort: source.fields[0]
      ? [{ field: source.defaultColumns[0] ?? source.fields[0].key, direction: 'asc' }]
      : [],
  };
}

async function download(
  format: 'csv' | 'xlsx' | 'pdf',
  name: string,
  definition: ReportDefinition,
  reportId: string | null,
) {
  const response = await fetch('/api/reports/export', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format, name, definition, reportId }),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || type.includes('json')) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || 'The file was not created.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  link.href = url;
  link.download = match?.[1] ?? `report.${format === 'xlsx' ? 'xlsx' : format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportBuilder({
  navigate,
  reportId,
}: {
  navigate: Navigate;
  reportId: string | null;
}) {
  const notify = useToast();
  const phone = usePhone();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [roles, setRoles] = useState<{ key: string; name: string }[]>([]);
  const [draft, setDraft] = useState<ReportDefinition>(emptyReport());
  const [name, setName] = useState('New Report');
  const [visibility, setVisibility] = useState<ReportVisibility>('private');
  const [sharedRoles, setSharedRoles] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [chartMeasure, setChartMeasure] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [readyMade, setReadyMade] = useState(false);

  useEffect(() => {
    api('/reports/catalog').then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'The report list did not load.'));
        return;
      }
      const payload = body as { sources?: SourceInfo[]; roles?: { key: string; name: string }[] };
      setSources(payload.sources ?? []);
      setRoles(payload.roles ?? []);
      setLoaded(true);
    });
  }, [navigate]);

  useEffect(() => {
    if (!reportId) {
      setReadyMade(false);
      return;
    }
    api(`/reports/${reportId}`).then(({ status, body }) => {
      if (status !== 200 || !body || typeof body !== 'object' || !('report' in body)) {
        setError(errorMessage(body, 'That report is not available.'));
        return;
      }
      const report = (
        body as {
          report: {
            name: string;
            definition: ReportDefinition;
            visibility: ReportVisibility;
            sharedRoles: string[];
          };
        }
      ).report;
      setName(report.name);
      setDraft(report.definition);
      setReadyMade(report.visibility === 'ready_made');
      setVisibility(
        report.visibility === 'ready_made'
          ? 'ready_made'
          : report.visibility === 'roles'
            ? 'roles'
            : 'private',
      );
      setSharedRoles(report.sharedRoles ?? []);
    });
  }, [reportId]);

  useEffect(() => {
    if (!loaded || reportId || sources.length === 0 || draft.source) {
      return;
    }
    const first = sources[0];
    if (!first) {
      return;
    }
    setDraft(sourceDraft(first));
  }, [loaded, reportId, sources, draft.source]);

  const source = sources.find((item) => item.key === draft.source) ?? null;
  const fields = source?.fields ?? [];
  const fieldBy = (key: string) => fields.find((field) => field.key === key);

  const summary = useMemo(() => {
    if (!source) {
      return 'Choose a data source.';
    }
    return summariseReport({
      sourceLabel: source.label,
      filters: draft.filters.map((filter) => ({
        label: fieldBy(filter.field)?.label ?? filter.field,
        op: filter.op,
        value: filter.value,
        valueTo: filter.valueTo,
      })),
      groupBy: draft.groupBy.map((key) => fieldBy(key)?.label ?? key),
      totals: draft.totals.map((total) => ({
        label: fieldBy(total.field)?.label ?? total.field,
        fn: total.fn,
      })),
    });
  }, [source, draft, fields]);

  useEffect(() => {
    if (!draft.source || (draft.columns.length === 0 && draft.groupBy.length === 0)) {
      return;
    }
    const handle = window.setTimeout(() => {
      api('/reports/preview', {
        method: 'POST',
        body: JSON.stringify({ definition: draft, offset }),
      }).then(({ status, body }) => {
        if (status === 401) {
          navigate('/login');
          return;
        }
        if (status !== 200 || !body || typeof body !== 'object') {
          setError(errorMessage(body, 'The preview did not load.'));
          return;
        }
        setError('');
        setPreview(body as Preview);
      });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draft, offset, navigate]);

  function chooseSource(key: string) {
    const next = sources.find((item) => item.key === key);
    if (!next) {
      return;
    }
    setDraft(sourceDraft(next));
    setOffset(0);
    setPreview(null);
  }

  function moveColumn(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.columns.length) {
        return current;
      }
      const columns = [...current.columns];
      const [item] = columns.splice(index, 1);
      if (!item) {
        return current;
      }
      columns.splice(target, 0, item);
      return { ...current, columns };
    });
  }

  function removeColumn(key: string) {
    setDraft((current) => {
      if (current.columns.length === 1 && current.groupBy.length === 0) {
        notify({ title: 'Keep at least one column.', tone: 'bad' });
        return current;
      }
      return { ...current, columns: current.columns.filter((item) => item !== key) };
    });
  }

  function addColumn(key: string) {
    if (!key) {
      return;
    }
    setDraft((current) =>
      current.columns.includes(key) ? current : { ...current, columns: [...current.columns, key] },
    );
  }

  function sortBy(key: string) {
    setDraft((current) => {
      const active = current.sort[0];
      const direction = active?.field === key && active.direction === 'asc' ? 'desc' : 'asc';
      return { ...current, sort: [{ field: key, direction }] };
    });
    setOffset(0);
  }

  const measures = useMemo(() => {
    if (!preview) {
      return [];
    }
    return preview.columns
      .map((column, index) => ({ ...column, index }))
      .filter((column) => column.type === 'number' || column.type === 'money');
  }, [preview]);

  const series = useMemo(() => {
    if (!preview || measures.length === 0) {
      return null;
    }
    const preferred =
      measures.find((column) => column.key === chartMeasure) ??
      measures.find((column) => column.type === 'money') ??
      measures[0];
    if (!preferred) {
      return null;
    }
    const labelIndex = preview.columns.findIndex(
      (column) => column.type === 'text' || column.type === 'date',
    );
    if (labelIndex < 0) {
      return null;
    }
    return {
      key: preferred.key,
      name: preferred.label,
      date: preview.columns[labelIndex]?.type === 'date',
      labels: preview.rows.map((row) => row[labelIndex]?.text || 'Blank'),
      values: preview.rows.map((row) => row[preferred.index]?.chart ?? 0),
      texts: preview.rows.map((row) => row[preferred.index]?.text ?? ''),
    };
  }, [preview, measures, chartMeasure]);

  const chart: ReportChart =
    draft.chart === 'pie' && series && series.values.length > 8
      ? 'bar'
      : draft.chart === 'line' && series && !series.date
        ? 'bar'
        : draft.chart;

  function openSave() {
    if (readyMade) {
      setName((current) =>
        current.startsWith('Copy of ') ? current : `Copy of ${current}`.slice(0, 120),
      );
      setVisibility('private');
      setSharedRoles([]);
    }
    setSaveOpen(true);
  }

  async function save() {
    const copying = readyMade || !reportId;
    setBusy(true);
    const { status, body } = await api(copying ? '/reports' : `/reports/${reportId}`, {
      method: copying ? 'POST' : 'PATCH',
      body: JSON.stringify({
        name,
        definition: draft,
        visibility: visibility === 'roles' ? 'roles' : 'private',
        sharedRoles,
      }),
    });
    setBusy(false);
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The report was not saved.'), tone: 'bad' });
      return;
    }
    setSaveOpen(false);
    const saved = (body as { report?: { id: string } }).report;
    notify({ title: 'Report saved.' });
    if (saved?.id && saved.id !== reportId) {
      navigate(`/reports/${saved.id}`);
    }
  }

  async function archive() {
    if (!reportId) {
      return;
    }
    const { status, body } = await api(`/reports/${reportId}/archive`, { method: 'POST' });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The report was not archived.'), tone: 'bad' });
      return;
    }
    navigate('/reports');
  }

  async function exportFile(format: 'csv' | 'xlsx' | 'pdf') {
    try {
      await download(format, name, draft, reportId);
      notify({
        title:
          format === 'pdf'
            ? 'PDF downloaded.'
            : format === 'xlsx'
              ? 'Excel downloaded.'
              : 'CSV downloaded.',
      });
    } catch (reason) {
      notify({
        title: reason instanceof Error ? reason.message : 'The file was not created.',
        tone: 'bad',
      });
    }
  }

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  function addTotal() {
    const used = new Set(draft.totals.map((total) => `${total.fn}:${total.field}`));
    const field = fields.find(
      (item) => (item.type === 'number' || item.type === 'money') && !used.has(`sum:${item.key}`),
    );
    if (!field) {
      return;
    }
    setDraft((current) => ({
      ...current,
      totals: [...current.totals, { field: field.key, fn: 'sum' }],
    }));
  }

  function filterChip(filter: (typeof draft.filters)[number]): string {
    const field = fieldBy(filter.field);
    const condition = field
      ? FILTER_CONDITIONS[field.type].find((item) => item.op === filter.op)
      : undefined;
    const label = field?.label ?? filter.field;
    if (!condition || condition.value === 'none') {
      return `${label}: ${condition?.label ?? filter.op}`;
    }
    if (condition.value === 'two') {
      return `${label}: ${filter.value ?? ''} to ${filter.valueTo ?? ''}`;
    }
    return `${label}: ${condition.label} ${filter.value ?? ''}`.trim();
  }

  function totalPhrase(total: (typeof draft.totals)[number]): string {
    return `${AGGREGATE_LABELS[total.fn]} Of ${fieldBy(total.field)?.label ?? total.field}`;
  }

  const pageCount = preview ? Math.max(1, Math.ceil(preview.totalRows / 50)) : 1;
  const page = Math.floor(offset / 50) + 1;
  const spareColumns = fields.filter((field) => !draft.columns.includes(field.key));

  function columnsEditor() {
    return (
      <div className="report-pop-body">
        <ul className="report-cols">
          {draft.columns.map((key, index) => {
            const field = fieldBy(key);
            if (!field) {
              return null;
            }
            return (
              <li key={key}>
                <span>{field.label}</span>
                <span>
                  <button
                    type="button"
                    aria-label={`Move ${field.label} up`}
                    onClick={() => moveColumn(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${field.label} down`}
                    onClick={() => moveColumn(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${field.label}`}
                    onClick={() => removeColumn(key)}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {spareColumns.length > 0 ? (
          <select
            aria-label="Add Column"
            value=""
            onChange={(event) => addColumn(event.target.value)}
          >
            <option value="">Add Column</option>
            {spareColumns.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    );
  }

  function filtersEditor() {
    return (
      <div className="report-pop-body">
        {draft.filters.length === 0 ? <p className="ui-hint">No filters yet.</p> : null}
        <Button
          variant="secondary"
          onClick={() => {
            const field = fields.find((item) => item.filterable);
            if (!field) {
              return;
            }
            setDraft((current) => ({
              ...current,
              filters: [
                ...current.filters,
                { field: field.key, op: FILTER_CONDITIONS[field.type][0]?.op ?? 'is', value: '' },
              ],
            }));
          }}
        >
          Add Filter
        </Button>
        {draft.filters.map((filter, index) => {
          const field = fieldBy(filter.field);
          const conditions = field ? FILTER_CONDITIONS[field.type] : [];
          const condition = conditions.find((item) => item.op === filter.op) ?? conditions[0];
          return (
            <div key={`${filter.field}-${index}`} className="report-filter">
              <SelectField
                label="Field"
                value={filter.field}
                onChange={(value) => {
                  const nextField = fieldBy(value);
                  const op = nextField ? (FILTER_CONDITIONS[nextField.type][0]?.op ?? 'is') : 'is';
                  setDraft((current) => ({
                    ...current,
                    filters: current.filters.map((item, itemIndex) =>
                      itemIndex === index ? { field: value, op, value: '' } : item,
                    ),
                  }));
                }}
              >
                {fields
                  .filter((item) => item.filterable)
                  .map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
              </SelectField>
              <SelectField
                label="Condition"
                value={filter.op}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    filters: current.filters.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, op: value } : item,
                    ),
                  }))
                }
              >
                {conditions.map((item) => (
                  <option key={item.op} value={item.op}>
                    {item.label}
                  </option>
                ))}
              </SelectField>
              {condition?.value !== 'none' ? (
                <TextField
                  label={field?.type === 'money' ? 'Amount' : 'Value'}
                  value={filter.value ?? ''}
                  type={field?.type === 'date' ? 'date' : 'text'}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      filters: current.filters.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, value } : item,
                      ),
                    }))
                  }
                />
              ) : null}
              {condition?.value === 'two' ? (
                <TextField
                  label="To"
                  type="date"
                  value={filter.valueTo ?? ''}
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      filters: current.filters.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, valueTo: value } : item,
                      ),
                    }))
                  }
                />
              ) : null}
              <button
                type="button"
                className="report-link"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    filters: current.filters.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  function groupEditor() {
    return (
      <SelectField
        label="Group By"
        value={draft.groupBy[0] ?? ''}
        onChange={(value) => setDraft((current) => ({ ...current, groupBy: value ? [value] : [] }))}
      >
        <option value="">None</option>
        {fields
          .filter((field) => field.groupable)
          .map((field) => (
            <option key={field.key} value={field.key}>
              {field.label}
            </option>
          ))}
      </SelectField>
    );
  }

  function totalsEditor() {
    const choices = fields.filter((field) => field.aggregations.length > 0);
    return (
      <div className="report-pop-body">
        <ul className="report-totals">
          {draft.totals.map((total, index) => (
            <li key={`${total.fn}-${total.field}-${index}`}>
              <select
                aria-label="Total"
                value={`${total.fn}:${total.field}`}
                onChange={(event) => {
                  const [fn, field] = event.target.value.split(':');
                  if (!fn || !field) {
                    return;
                  }
                  setDraft((current) => ({
                    ...current,
                    totals: current.totals.map((item, itemIndex) =>
                      itemIndex === index ? { field, fn: fn as ReportAggregate } : item,
                    ),
                  }));
                }}
              >
                {choices.flatMap((field) =>
                  field.aggregations.map((fn) => (
                    <option key={`${fn}:${field.key}`} value={`${fn}:${field.key}`}>
                      {AGGREGATE_LABELS[fn]} Of {field.label}
                    </option>
                  )),
                )}
              </select>
              <button
                type="button"
                aria-label={`Remove ${totalPhrase(total)}`}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    totals: current.totals.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="report-link" onClick={addTotal}>
          Add Total
        </button>
      </div>
    );
  }

  function sourceEditor() {
    return (
      <SelectField label="Data Source" value={draft.source} onChange={chooseSource}>
        {sources.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </SelectField>
    );
  }

  function editor(which: Menu) {
    if (which === 'source') {
      return sourceEditor();
    }
    if (which === 'columns') {
      return columnsEditor();
    }
    if (which === 'filters') {
      return filtersEditor();
    }
    if (which === 'group') {
      return groupEditor();
    }
    return totalsEditor();
  }

  return (
    <div className="report-print-root">
      <PageHeader
        title={reportId ? name : 'New Report'}
        description="The sentence under the title is this report. Change it from the row below."
        breadcrumbs={[
          { label: 'Reports', href: '/reports' },
          { label: reportId ? name : 'New Report' },
        ]}
        onNavigate={navigate}
        actions={
          <div className="ui-actions no-print">
            <Button variant="secondary" onClick={() => navigate('/reports')}>
              All Reports
            </Button>
            <Button onClick={openSave} disabled={busy}>
              {readyMade ? 'Save A Copy' : 'Save'}
            </Button>
          </div>
        }
      />
      <p className="report-summary">{preview?.summary || summary}</p>
      {preview && preview.hidden.length > 0 ? (
        <p className="ui-hint">{preview.hidden.join(' and ')} hidden for your role.</p>
      ) : null}
      {error ? <p className="ui-error">{error}</p> : null}

      <div className="report-toolbar no-print" ref={toolbarRef}>
        <div className="report-toolbar-build">
          {MENUS.map((item) => (
            <div className="report-tool" key={item}>
              <button
                type="button"
                className={menu === item ? 'is-on' : undefined}
                aria-expanded={menu === item}
                onClick={() => setMenu((current) => (current === item ? null : item))}
              >
                {MENU_LABEL[item]}
                {item === 'filters' && draft.filters.length > 0 ? ` ${draft.filters.length}` : ''}
                {item === 'totals' && draft.totals.length > 0 ? ` ${draft.totals.length}` : ''}
              </button>
              {menu === item ? <div className="report-popover">{editor(item)}</div> : null}
            </div>
          ))}
        </div>
        <Button className="report-edit-phone" variant="secondary" onClick={() => setEditOpen(true)}>
          Edit Report
        </Button>
        <Button
          className="report-export-phone"
          variant="secondary"
          onClick={() => setExportOpen(true)}
        >
          Export
        </Button>
        <div className="report-toolbar-out">
          {measures.length > 1 && series ? (
            <label className="report-chart-pick">
              <span>Chart</span>
              <select
                aria-label="Chart"
                value={`${series.key}|${series.name}`}
                onChange={(event) => setChartMeasure(event.target.value.split('|')[0] ?? '')}
              >
                {measures.map((column) => (
                  <option
                    key={`${column.key}|${column.label}`}
                    value={`${column.key}|${column.label}`}
                  >
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {CHARTS.map((item) => (
            <Button
              key={item.key}
              variant={chart === item.key ? 'primary' : 'secondary'}
              onClick={() => setDraft((current) => ({ ...current, chart: item.key }))}
            >
              {item.label}
            </Button>
          ))}
          <Button variant="secondary" onClick={() => void exportFile('csv')}>
            CSV
          </Button>
          <Button variant="secondary" onClick={() => void exportFile('xlsx')}>
            Excel
          </Button>
          <Button variant="secondary" onClick={() => void exportFile('pdf')}>
            PDF
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      {draft.filters.length > 0 ? (
        <div className="report-chips no-print">
          {draft.filters.map((filter, index) => (
            <button
              key={`${filter.field}-${index}`}
              type="button"
              className="report-chip"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  filters: current.filters.filter((_, itemIndex) => itemIndex !== index),
                }))
              }
            >
              {filterChip(filter)} ×
            </button>
          ))}
        </div>
      ) : null}

      <Card>
        <div className="report-sheet">
          {chart !== 'none' && series ? (
            <>
              <p className="report-chart-name">{series.name}</p>
              <ChartView
                kind={chart === 'pie' || chart === 'line' ? chart : 'bar'}
                labels={series.labels}
                values={series.values}
                valueTexts={series.texts}
              />
            </>
          ) : null}
          {chart === 'pie' && series && series.values.length > 8 ? (
            <p className="ui-hint">Pie works for up to 8 groups, so this is a bar chart.</p>
          ) : null}
          {phone && preview ? (
            <ul className="ui-record-list">
              {preview.rows.length === 0 ? (
                <li className="ui-record">
                  <div className="ui-record-hit">Nothing matches these filters.</div>
                </li>
              ) : null}
              {preview.rows.map((row, index) => (
                <li key={index} className="ui-record">
                  <div className="ui-record-hit">
                    <span className="ui-record-title">{row[0]?.text || '—'}</span>
                    <span className="ui-record-meta">
                      {row.slice(1, 3).map((cell, cellIndex) => (
                        <span key={cellIndex}>
                          {preview.columns[cellIndex + 1]?.label}: {cell.text}
                        </span>
                      ))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    {preview?.columns.map((column) => {
                      const active = draft.sort[0]?.field === column.key;
                      const mark = active
                        ? draft.sort[0]?.direction === 'desc'
                          ? ' ↓'
                          : ' ↑'
                        : '';
                      return (
                        <th key={column.key + column.label}>
                          <button
                            type="button"
                            className="ui-sort"
                            onClick={() => sortBy(column.key)}
                          >
                            {column.label}
                            {mark}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {preview && preview.rows.length === 0 ? (
                    <tr>
                      <td colSpan={Math.max(preview.columns.length, 1)}>
                        Nothing matches these filters.
                      </td>
                    </tr>
                  ) : null}
                  {preview?.rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={
                            preview.columns[cellIndex]?.type === 'money' ||
                            preview.columns[cellIndex]?.type === 'number'
                              ? 'num'
                              : undefined
                          }
                        >
                          {cell.text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {preview && preview.footer.length > 0 ? (
                  <tfoot>
                    <tr>
                      {preview.columns.map((column, index) => {
                        const total = preview.footer.find((item) => item.key === column.key);
                        return (
                          <td key={column.key}>
                            {index === 0 && !total ? 'Total' : (total?.text ?? '')}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}
          {preview ? (
            <div className="report-pager no-print">
              <span>
                {preview.totalRows} {preview.totalRows === 1 ? 'row' : 'rows'} · Page {page} of{' '}
                {pageCount}
              </span>
              <div className="ui-actions">
                <Button
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset((current) => Math.max(0, current - 50))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={offset + 50 >= preview.totalRows}
                  onClick={() => setOffset((current) => current + 50)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : (
            <p className="ui-hint">The table updates as you change the report.</p>
          )}
        </div>
      </Card>

      <DialogFrame
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export"
        description="Take a copy of this report."
      >
        <div className="ui-sheet-stack">
          <Button
            variant="secondary"
            onClick={() => {
              setExportOpen(false);
              void exportFile('csv');
            }}
          >
            CSV
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setExportOpen(false);
              void exportFile('xlsx');
            }}
          >
            Excel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setExportOpen(false);
              void exportFile('pdf');
            }}
          >
            PDF
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setExportOpen(false);
              window.print();
            }}
          >
            Print
          </Button>
        </div>
      </DialogFrame>

      <DialogFrame
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit Report"
        description="Source, columns, filters, group, and totals."
      >
        <div className="report-edit-sheet">
          {MENUS.map((item) => (
            <section key={item}>
              <h2>{MENU_LABEL[item]}</h2>
              {editor(item)}
            </section>
          ))}
          <Button onClick={() => setEditOpen(false)}>Done</Button>
        </div>
      </DialogFrame>

      <DialogFrame
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title={readyMade ? 'Save A Copy' : 'Save Report'}
        description="Name it, and choose who can open it."
      >
        <TextField label="Report Name" value={name} onChange={setName} />
        <SelectField
          label="Who Can Open It"
          value={visibility === 'roles' ? 'roles' : 'private'}
          onChange={(value) => setVisibility(value === 'roles' ? 'roles' : 'private')}
        >
          <option value="private">Private</option>
          <option value="roles">Share With Roles</option>
        </SelectField>
        {visibility === 'roles'
          ? roles.map((role) => (
              <label key={role.key} className="ui-check">
                <input
                  type="checkbox"
                  checked={sharedRoles.includes(role.key)}
                  onChange={() =>
                    setSharedRoles((current) =>
                      current.includes(role.key)
                        ? current.filter((key) => key !== role.key)
                        : [...current, role.key],
                    )
                  }
                />
                <span>{plainRoleName(role)}</span>
              </label>
            ))
          : null}
        <div className="ui-actions">
          <Button variant="secondary" onClick={() => setSaveOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || name.trim().length === 0}>
            Save
          </Button>
          {reportId && !readyMade ? (
            <Button variant="danger" onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          ) : null}
        </div>
      </DialogFrame>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive this report?"
        body="It leaves your list. The copy in the audit stays."
        confirmLabel="Archive"
        onConfirm={() => void archive()}
      />
    </div>
  );
}
