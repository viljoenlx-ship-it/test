import type { CustomFieldDefinition, CustomFieldValue } from '@omnivate/shared';
import {
  Badge,
  Button,
  Card,
  CustomFieldsForm,
  DialogFrame,
  Form,
  PageHeader,
  Skeleton,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { MoreMenu } from './MoreMenu';
import type { ItemDetail } from './types';

export function ItemDetailScreen({ navigate, itemId }: { navigate: Navigate; itemId: string }) {
  const notify = useToast();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState('');
  const [correctId, setCorrectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    return api(`/scm/items/${itemId}`).then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'That item did not load.'));
        return;
      }
      setDetail(body as ItemDetail);
      setError('');
    });
  }

  useEffect(() => {
    let cancel = false;
    void load().catch(() => {
      if (!cancel) {
        setError('That item did not load.');
      }
    });
    return () => {
      cancel = true;
    };
  }, [itemId]);

  async function archive(status: 'archived' | 'active') {
    const { status: code, body } = await api(`/scm/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (code !== 200) {
      notify({ title: errorMessage(body, 'That change was not saved.'), tone: 'bad' });
      return;
    }
    notify({ title: status === 'archived' ? 'Item archived' : 'Item restored' });
    await load();
  }

  async function correct() {
    if (!correctId) {
      return;
    }
    setBusy(true);
    const { status, body } = await api(`/scm/movements/${correctId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (status !== 201) {
      notify({ title: errorMessage(body, 'That correction was not saved.'), tone: 'bad' });
      return;
    }
    setCorrectId(null);
    setReason('');
    notify({ title: 'Correction posted' });
    await load();
  }

  if (!detail) {
    return error ? <p className="ui-error">{error}</p> : <Skeleton lines={8} />;
  }

  const item = detail.item;
  const stock = item.kind === 'stock' && !item.archived;
  const query = `?item=${item.id}`;
  const more = [
    ...(stock && detail.access.canOperate
      ? [
          {
            label: 'Adjust',
            onSelect: () => navigate(`/stock/adjust${query}`),
          },
          {
            label: 'Transfer',
            onSelect: () => navigate(`/stock/transfer${query}`),
          },
        ]
      : []),
    {
      label: 'Print Label',
      onSelect: () => navigate(`/stock/labels/${item.id}`),
    },
    ...(detail.access.canEdit
      ? [
          {
            label: 'Edit',
            onSelect: () => navigate(`/stock/items/${item.id}/edit`),
          },
          {
            label: item.archived ? 'Restore Item' : 'Archive Item',
            tone: item.archived ? ('default' as const) : ('danger' as const),
            onSelect: () => void archive(item.archived ? 'active' : 'archived'),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={item.name}
        description={item.description || item.kindLabel}
        breadcrumbs={[{ label: 'Stock', href: '/stock' }, { label: item.name }]}
        onNavigate={navigate}
        actions={
          <>
            {stock && detail.access.canOperate ? (
              <Button onClick={() => navigate(`/stock/receive${query}`)}>Receive Stock</Button>
            ) : null}
            {more.length > 0 ? <MoreMenu label="Actions" items={more} /> : null}
          </>
        }
      />
      {error ? <p className="ui-error">{error}</p> : null}
      <p>
        <Badge>{item.kindLabel}</Badge> {item.low ? <Badge tone="warn">Low</Badge> : null}{' '}
        {item.archived ? <Badge tone="neutral">Archived</Badge> : null}
      </p>
      <Card title="Catalog">
        <dl className="ui-facts">
          <dt>Code</dt>
          <dd>{item.code}</dd>
          <dt>Barcode</dt>
          <dd>{item.barcode || 'None'}</dd>
          <dt>Category</dt>
          <dd>{item.category || 'None'}</dd>
          <dt>Unit</dt>
          <dd>
            {item.unit}
            {item.unitPlural !== item.unit ? ` / ${item.unitPlural}` : ''}
          </dd>
          {item.packs.length > 0 ? (
            <>
              <dt>Also Counted As</dt>
              <dd>{item.packs.map((pack) => pack.label).join(', ')}</dd>
            </>
          ) : null}
          <dt>Selling Price</dt>
          <dd>
            {item.priceLabel}, excluding VAT ({item.vatLabel})
          </dd>
          {item.costLabel ? (
            <>
              <dt>Average Cost</dt>
              <dd>
                {item.costLabel} per {item.unit}
              </dd>
            </>
          ) : null}
          {detail.access.canSeeQuantities && item.kind === 'stock' ? (
            <>
              <dt>On Hand</dt>
              <dd>{item.onHandLabel}</dd>
              <dt>Reorder At</dt>
              <dd>{item.reorder}</dd>
            </>
          ) : null}
        </dl>
      </Card>
      {detail.access.canSeeQuantities && item.kind === 'stock' ? (
        <Card title="On Hand By Branch">
          {detail.balances.length === 0 ? (
            <p>Nothing is on hand yet.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>On Hand</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.balances.map((row) => (
                    <tr key={row.branchId}>
                      <td data-label="Branch">{row.branch}</td>
                      <td data-label="On Hand">{row.onHandLabel}</td>
                    </tr>
                  ))}
                  <tr>
                    <td data-label="Branch">
                      <strong>Total</strong>
                    </td>
                    <td data-label="On Hand">
                      <strong>{detail.totalOnHandLabel}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
      {detail.batches.length > 0 ? (
        <Card title="Batches">
          <ul>
            {detail.batches.map((batch) => (
              <li key={batch.code}>
                {batch.code}
                {batch.expiresOn ? `, expires ${batch.expiresOn}` : ''}
                {batch.places.length > 0
                  ? ` — ${batch.places.map((place) => `${place.onHandLabel} at ${place.branch}`).join('; ')}`
                  : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {detail.serials.length > 0 ? (
        <Card title="Serial Numbers">
          <ul>
            {detail.serials.map((row) => (
              <li key={row.serial}>
                {row.serial} · {row.statusLabel}
                {row.branch ? ` · ${row.branch}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {detail.pending.length > 0 ? (
        <Card title="Waiting For Approval">
          <ul>
            {detail.pending.map((row) => (
              <li key={row.id}>
                {row.summary}. {row.reason}
                {row.valueLabel ? ` (${row.valueLabel})` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <MoreDetailsCard itemId={item.id} />
      {detail.access.canSeeQuantities ? (
        <Card title="Movement History">
          {detail.movements.length === 0 ? (
            <p>No movements yet.</p>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>What</th>
                    <th>Branch</th>
                    <th>Quantity</th>
                    {detail.access.canSeeCosts ? <th>Value</th> : null}
                    <th>Reason</th>
                    <th>By</th>
                    {detail.access.canOperate ? <th></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {detail.movements.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Date">{row.whenLabel}</td>
                      <td data-label="What">{row.what}</td>
                      <td data-label="Branch">{row.branch}</td>
                      <td data-label="Quantity">
                        <span className={row.direction === 'in' ? 'ui-qty-in' : 'ui-qty-out'}>
                          {row.quantityLabel}
                        </span>
                      </td>
                      {detail.access.canSeeCosts ? (
                        <td data-label="Value">{row.valueLabel ?? '—'}</td>
                      ) : null}
                      <td data-label="Reason">{row.reason || '—'}</td>
                      <td data-label="By">{row.actorName}</td>
                      {detail.access.canOperate ? (
                        <td>
                          {row.reversible ? (
                            <MoreMenu
                              label="…"
                              items={[
                                {
                                  label: 'Correct This Movement',
                                  onSelect: () => {
                                    setReason('');
                                    setCorrectId(row.id);
                                  },
                                },
                              ]}
                            />
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
      <DialogFrame
        open={correctId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCorrectId(null);
          }
        }}
        title="Correct This Movement"
        description="This posts the opposite movement. The original line stays in the history."
      >
        <TextField label="Reason" value={reason} onChange={setReason} hint="Say what was wrong." />
        <div className="ui-actions">
          <Button variant="secondary" onClick={() => setCorrectId(null)}>
            Cancel
          </Button>
          <Button disabled={busy || reason.trim().length < 3} onClick={() => void correct()}>
            {busy ? 'Saving…' : 'Post Correction'}
          </Button>
        </div>
      </DialogFrame>
    </>
  );
}

function MoreDetailsCard({ itemId }: { itemId: string }) {
  const notify = useToast();
  const [fields, setFields] = useState<CustomFieldDefinition[] | null>(null);
  const [draft, setDraft] = useState<Record<string, CustomFieldValue | null | undefined>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void api(
      `/krn/workflows/values?entityType=${encodeURIComponent('scm.item')}&entityId=${itemId}`,
    )
      .then(({ status, body }) => {
        if (cancel || status !== 200 || !body || typeof body !== 'object') {
          return;
        }
        const payload = body as {
          fields?: CustomFieldDefinition[];
          values?: Record<string, CustomFieldValue>;
          canEdit?: boolean;
        };
        const active = (payload.fields ?? []).filter((field) => !field.archived);
        setFields(active);
        setDraft(payload.values ?? {});
        setCanEdit(payload.canEdit === true);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [itemId]);

  if (!fields || fields.length === 0) {
    return null;
  }

  const editable = canEdit && fields.some((field) => field.fieldType !== 'calculated');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!fields) {
      return;
    }
    setBusy(true);
    const values: Record<string, CustomFieldValue | null> = {};
    for (const field of fields) {
      if (field.fieldType === 'calculated') {
        continue;
      }
      values[field.fieldKey] = draft[field.fieldKey] ?? null;
    }
    const { status, body } = await api('/krn/workflows/values', {
      method: 'POST',
      body: JSON.stringify({ entityType: 'scm.item', entityId: itemId, values }),
    });
    setBusy(false);
    if (status !== 200 || !body || typeof body !== 'object' || !('values' in body)) {
      notify({ title: errorMessage(body, 'Those details were not saved.'), tone: 'bad' });
      return;
    }
    const saved = (body as { values: Record<string, CustomFieldValue> }).values;
    setDraft(saved);
    notify({ title: 'Details saved' });
  }

  const controls = (
    <>
      <CustomFieldsForm
        fields={fields}
        values={draft}
        disabled={!canEdit}
        onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
      />
      {editable ? (
        <div className="ui-actions">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save Details'}
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <Card title="More Details">
      {editable ? <Form onSubmit={(event) => void save(event)}>{controls}</Form> : controls}
    </Card>
  );
}
