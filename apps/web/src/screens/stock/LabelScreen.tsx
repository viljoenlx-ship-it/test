import { truncateLabelText } from '@omnivate/shared';
import { Button, PageHeader } from '@omnivate/ui';
import { useEffect, useState, type CSSProperties } from 'react';
import { api, errorMessage, type Navigate } from '../../api';

export type LabelFaceModel = {
  name: string;
  code: string;
  barcode: string;
  svg: string;
  meta?: string;
};

type Label = LabelFaceModel & {
  widthMm: string;
  heightMm: string;
  printer: string;
};

const COPY_LIMIT = 50;

export function CopiesStepper({
  value,
  onChange,
  min = 1,
  max = COPY_LIMIT,
  label = 'Copies',
  id = 'label-copies',
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
  id?: string;
}) {
  return (
    <div className="label-copies no-print">
      <span id={id}>{label}</span>
      <div className="label-stepper" role="group" aria-labelledby={id}>
        <button
          type="button"
          aria-label={`Fewer ${label}`}
          disabled={value <= min}
          onClick={() => onChange(clampCopies(value - 1, min, max))}
        >
          −
        </button>
        <input
          aria-label={label}
          inputMode="numeric"
          min={min}
          max={max}
          value={String(value)}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            onChange(clampCopies(next, min, max));
          }}
        />
        <button
          type="button"
          aria-label={`More ${label}`}
          disabled={value >= max}
          onClick={() => onChange(clampCopies(value + 1, min, max))}
        >
          +
        </button>
      </div>
    </div>
  );
}

function clampCopies(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function LabelFace({ label }: { label: LabelFaceModel }) {
  return (
    <div className="label-sheet">
      <div className="label-copy">
        <strong>{truncateLabelText(label.name)}</strong>
        {label.meta ? <small className="label-meta">{label.meta}</small> : null}
      </div>
      <div className="label-row">
        <div dangerouslySetInnerHTML={{ __html: label.svg }} />
        <div className="label-copy">
          <span>{label.code}</span>
        </div>
      </div>
    </div>
  );
}

export function LabelScreen({ navigate, itemId }: { navigate: Navigate; itemId: string }) {
  const [label, setLabel] = useState<Label | null>(null);
  const [copies, setCopies] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/scm/items/${itemId}/label`).then(({ status, body }) => {
      if (status === 401) {
        navigate('/login');
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setError(errorMessage(body, 'The label did not load.'));
        return;
      }
      setLabel(body as Label);
    });
  }, [itemId, navigate]);

  const width = Number(label?.widthMm ?? '50');
  const height = Number(label?.heightMm ?? '15');
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 50;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 15;
  const frameStyle = {
    '--label-w': `${safeWidth}mm`,
    '--label-h': `${safeHeight}mm`,
    '--label-rw': String(safeWidth),
    '--label-rh': String(safeHeight),
  } as CSSProperties;

  return (
    <div className="label-print" style={frameStyle}>
      <style>{`
        @media print {
          @page { size: ${safeWidth}mm ${safeHeight}mm; margin: 0; }
        }
      `}</style>
      <PageHeader
        title="Print Label"
        onNavigate={navigate}
        breadcrumbs={[
          { label: 'Stock', href: '/stock' },
          ...(label ? [{ label: label.name, href: `/stock/items/${itemId}` }] : []),
          { label: 'Print Label' },
        ]}
        actions={
          label ? (
            <>
              <CopiesStepper value={copies} onChange={setCopies} max={COPY_LIMIT} />
              <Button onClick={() => window.print()}>Print</Button>
            </>
          ) : null
        }
      />
      {error ? <p className="ui-error">{error}</p> : null}
      {!label && !error ? <p>Preparing the label…</p> : null}
      {label ? (
        <>
          <div className="label-frame no-print">
            <LabelFace label={label} />
          </div>
          <div className="label-run">
            {Array.from({ length: copies }, (_, index) => (
              <LabelFace key={index} label={label} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
