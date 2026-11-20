import { emptyReport, type ReportDefinition } from '@omnivate/shared';
import { Button, Card, SelectField, TextField, useToast } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';

type Source = {
  key: string;
  label: string;
  fields: { key: string; label: string; type: string }[];
  defaultColumns: string[];
};

type Saved = { id: string; name: string; summary: string };

export function ReportsPanel({ tenantId }: { tenantId: string }) {
  const notify = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [reports, setReports] = useState<Saved[]>([]);
  const [name, setName] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const [columns, setColumns] = useState<string[]>([]);
  const [group, setGroup] = useState('');

  async function reload() {
    const [sourceResponse, reportResponse] = await Promise.all([
      api(`/control/tenants/${tenantId}/report-sources`),
      api(`/control/tenants/${tenantId}/reports`),
    ]);
    if (
      sourceResponse.status === 200 &&
      sourceResponse.body &&
      typeof sourceResponse.body === 'object'
    ) {
      const list = (sourceResponse.body as { sources?: Source[] }).sources ?? [];
      setSources(list);
      if (!sourceKey && list[0]) {
        setSourceKey(list[0].key);
        setColumns(list[0].defaultColumns);
      }
    }
    if (
      reportResponse.status === 200 &&
      reportResponse.body &&
      typeof reportResponse.body === 'object'
    ) {
      setReports((reportResponse.body as { reports?: Saved[] }).reports ?? []);
    }
  }

  useEffect(() => {
    void reload();
  }, [tenantId]);

  const source = sources.find((item) => item.key === sourceKey);

  async function save() {
    const definition: ReportDefinition = {
      ...emptyReport(sourceKey),
      columns,
      groupBy: group ? [group] : [],
      totals: group
        ? (source?.fields
            .filter((field) => field.type === 'number' || field.type === 'money')
            .slice(0, 2)
            .map((field) => ({ field: field.key, fn: 'sum' as const })) ?? [])
        : [],
      chart: group ? 'bar' : 'none',
    };
    const { status, body } = await api(`/control/tenants/${tenantId}/reports`, {
      method: 'POST',
      body: JSON.stringify({ name, definition }),
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The report was not saved.'), tone: 'bad' });
      return;
    }
    notify({ title: 'Ready-made report saved.' });
    setName('');
    await reload();
  }

  async function archive(id: string) {
    const { status, body } = await api(`/control/tenants/${tenantId}/reports/${id}/archive`, {
      method: 'POST',
    });
    if (status >= 400) {
      notify({ title: errorMessage(body, 'The report was not archived.'), tone: 'bad' });
      return;
    }
    await reload();
  }

  return (
    <div className="ui-stack">
      <p className="ui-hint">
        Reports is a module on the Modules tab. Ready-made reports here show on the client’s Reports
        home.
      </p>
      <Card title="Ready-Made Reports">
        {reports.length === 0 ? <p className="ui-hint">None yet for this client.</p> : null}
        <ul className="report-mine">
          {reports.map((report) => (
            <li key={report.id}>
              <div>
                <strong>{report.name}</strong>
                <div className="ui-hint">{report.summary}</div>
              </div>
              <Button variant="secondary" onClick={() => void archive(report.id)}>
                Archive
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="New Ready-Made Report">
        <TextField label="Name" value={name} onChange={setName} />
        <SelectField
          label="Data Source"
          value={sourceKey}
          onChange={(value) => {
            setSourceKey(value);
            const next = sources.find((item) => item.key === value);
            setColumns(next?.defaultColumns ?? []);
            setGroup('');
          }}
        >
          {sources.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </SelectField>
        <div className="ui-stack">
          {source?.fields.map((field) => (
            <label key={field.key} className="ui-check">
              <input
                type="checkbox"
                checked={columns.includes(field.key)}
                onChange={() =>
                  setColumns((current) =>
                    current.includes(field.key)
                      ? current.filter((key) => key !== field.key)
                      : [...current, field.key],
                  )
                }
              />
              <span>
                {field.label} · {field.type}
              </span>
            </label>
          ))}
        </div>
        <SelectField label="Group By" value={group} onChange={setGroup}>
          <option value="">No Group</option>
          {source?.fields.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label}
            </option>
          ))}
        </SelectField>
        <Button onClick={() => void save()} disabled={!name.trim() || columns.length === 0}>
          Save Ready-Made Report
        </Button>
      </Card>
    </div>
  );
}
