import {
  Button,
  Form,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '@omnivate/ui';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, errorMessage, type Navigate } from '../../api';
import { createScanBuffer, playScanTone } from './scan-feedback';
import type { ItemDetail } from './types';

const empty = {
  kind: 'stock',
  name: '',
  code: '',
  barcode: '',
  description: '',
  category: '',
  unit: 'each',
  unitPlural: 'each',
  cost: '0.00',
  sellingPrice: '0.00',
  reorderLevel: '0',
  packName: '',
  packPlural: '',
  packFactor: '',
  trackBatches: 'no',
  trackSerials: 'no',
};

export function ItemFormScreen({
  navigate,
  itemId,
  initialBarcode = '',
}: {
  navigate: Navigate;
  itemId: string | null;
  initialBarcode?: string;
}) {
  const notify = useToast();
  const scans = useRef(createScanBuffer());
  const [form, setForm] = useState({ ...empty, barcode: initialBarcode });
  const [barcodeFlash, setBarcodeFlash] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [vat, setVat] = useState('15%');

  useEffect(() => {
    if (!itemId) {
      return;
    }
    let cancel = false;
    api(`/scm/items/${itemId}`).then(({ status, body }) => {
      if (cancel) {
        return;
      }
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'That item did not load.'));
        return;
      }
      const detail = body as ItemDetail;
      const pack = detail.item.packs[0];
      setVat(detail.item.vatLabel);
      setForm({
        kind: detail.item.kind,
        name: detail.item.name,
        code: detail.item.code,
        barcode: detail.item.barcode,
        description: detail.item.description,
        category: detail.item.category,
        unit: detail.item.unit,
        unitPlural: detail.item.unitPlural,
        cost: detail.item.cost ?? '0.00',
        sellingPrice: detail.item.price,
        reorderLevel: detail.item.reorder,
        packName: pack?.name ?? '',
        packPlural: pack?.plural ?? '',
        packFactor: pack?.factor ?? '',
        trackBatches: detail.item.trackBatches ? 'yes' : 'no',
        trackSerials: detail.item.trackSerials ? 'yes' : 'no',
      });
    });
    return () => {
      cancel = true;
    };
  }, [itemId, navigate]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      kind: form.kind,
      name: form.name,
      code: form.code,
      barcode: form.barcode,
      description: form.description,
      category: form.category,
      unit: form.unit,
      unitPlural: form.unitPlural,
      cost: form.cost,
      sellingPrice: form.sellingPrice,
      reorderLevel: form.reorderLevel,
      trackBatches: form.trackBatches === 'yes',
      trackSerials: form.trackSerials === 'yes',
      units:
        form.packName.trim() && form.packFactor.trim()
          ? [{ name: form.packName, plural: form.packPlural, factor: form.packFactor }]
          : [],
    };
    const path = itemId ? `/scm/items/${itemId}` : '/scm/items';
    const { status, body } = await api(path, {
      method: itemId ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (status === 200 || status === 201) {
      const id =
        body && typeof body === 'object' && 'id' in body && typeof body.id === 'string'
          ? body.id
          : itemId;
      notify({ title: itemId ? 'Item saved' : 'Item added' });
      navigate(id ? `/stock/items/${id}` : '/stock');
      return;
    }
    setError(errorMessage(body, 'That item was not saved.'));
  }

  const stock = form.kind === 'stock';

  return (
    <>
      <PageHeader
        title={itemId ? 'Edit Item' : 'New Item'}
        description={`Prices exclude VAT (${vat}).`}
        breadcrumbs={[{ label: 'Stock', href: '/stock' }, { label: itemId ? 'Edit' : 'New' }]}
        onNavigate={navigate}
      />
      <Form onSubmit={(event) => void onSubmit(event)}>
        <SelectField
          label="Kind Of Item"
          value={form.kind}
          onChange={(value) => set('kind', value)}
        >
          <option value="stock">Stock Item</option>
          <option value="service">Service</option>
          <option value="non_stock">Non-Stock</option>
        </SelectField>
        <TextField
          label="Name"
          value={form.name}
          onChange={(value) => set('name', value)}
          required
        />
        <TextField
          label="Item Code"
          value={form.code}
          onChange={(value) => set('code', value)}
          required
          autoComplete="off"
        />
        <div className={barcodeFlash ? 'scan-ready is-ok' : 'scan-ready'}>
          <TextField
            label="Barcode"
            hint="Leave this blank and a barcode is added when you save."
            value={form.barcode}
            onChange={(value) => set('barcode', value)}
            autoComplete="off"
            autoFocus={initialBarcode.length > 0}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              const result = scans.current.push(event.key);
              if (event.key !== 'Enter') {
                return;
              }
              event.preventDefault();
              if (result.burst) {
                setBarcodeFlash(true);
                playScanTone(true);
                window.setTimeout(() => setBarcodeFlash(false), 400);
              }
            }}
          />
        </div>
        <TextAreaField
          label="Description"
          value={form.description}
          rows={3}
          onChange={(value) => set('description', value)}
        />
        <TextField
          label="Category"
          value={form.category}
          onChange={(value) => set('category', value)}
        />
        <TextField
          label="Unit"
          hint="The smallest unit you count, such as each, bag, or metre."
          value={form.unit}
          onChange={(value) => set('unit', value)}
          required
        />
        <TextField
          label="Plural"
          hint="Used when the quantity is not 1. For example, bags or metres."
          value={form.unitPlural}
          onChange={(value) => set('unitPlural', value)}
          required
        />
        <TextField
          label="Also Counted As"
          hint="Optional. For example, box."
          value={form.packName}
          onChange={(value) => set('packName', value)}
        />
        <TextField
          label="Plural Of That Unit"
          hint="For a box, use boxes."
          value={form.packPlural}
          onChange={(value) => set('packPlural', value)}
        />
        <TextField
          label={
            form.packName
              ? `How Many ${form.unit || 'units'} In One ${form.packName}`
              : 'How Many Base Units'
          }
          hint="For a box of 10, enter 10."
          value={form.packFactor}
          onChange={(value) => set('packFactor', value)}
          inputMode="decimal"
        />
        <TextField
          label={`Cost Per ${form.unit || 'unit'}`}
          hint="Excluding VAT. Stock you already hold keeps its average cost."
          value={form.cost}
          onChange={(value) => set('cost', value)}
          inputMode="decimal"
        />
        <TextField
          label={`Selling Price Per ${form.unit || 'unit'}`}
          hint="Excluding VAT."
          value={form.sellingPrice}
          onChange={(value) => set('sellingPrice', value)}
          inputMode="decimal"
        />
        {stock ? (
          <TextField
            label="Reorder Level"
            hint="You will see a low-stock badge at or under this quantity."
            value={form.reorderLevel}
            onChange={(value) => set('reorderLevel', value)}
            inputMode="decimal"
          />
        ) : null}
        {stock ? (
          <SelectField
            label="Track Batches And Expiry"
            value={form.trackBatches}
            onChange={(value) => set('trackBatches', value)}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </SelectField>
        ) : null}
        {stock ? (
          <SelectField
            label="Track Serial Numbers"
            value={form.trackSerials}
            onChange={(value) => set('trackSerials', value)}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </SelectField>
        ) : null}
        {error ? <p className="ui-error">{error}</p> : null}
        <div className="ui-actions ui-form-submit">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save Item'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate(itemId ? `/stock/items/${itemId}` : '/stock')}
          >
            Cancel
          </Button>
        </div>
      </Form>
    </>
  );
}
