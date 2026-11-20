import { useEffect, useState } from 'react';
import { api, errorMessage, upload, type Navigate } from '../../api';

const ACCEPT =
  'image/jpeg,image/png,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.heic,.heif,.pdf';

export function SnapButton({
  navigate,
  variant = 'primary',
}: {
  navigate: Navigate;
  variant?: 'primary' | 'secondary';
}) {
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancel = false;
    void api('/documents/access').then(({ status, body }) => {
      if (cancel) {
        return;
      }
      const canCapture =
        status === 200 &&
        !!body &&
        typeof body === 'object' &&
        'canCapture' in body &&
        (body as { canCapture: boolean }).canCapture === true;
      setAllowed(canCapture);
    });
    return () => {
      cancel = true;
    };
  }, []);

  if (!allowed) {
    return null;
  }

  return (
    <span className="doc-snap-wrap">
      <label className={variant === 'secondary' ? 'ui-btn secondary doc-snap' : 'ui-btn doc-snap'}>
        {busy ? 'Reading Document' : 'Snap A Document'}
        <input
          type="file"
          accept={ACCEPT}
          capture="environment"
          aria-label="Snap A Document"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) {
              return;
            }
            setBusy(true);
            setError('');
            void upload('/documents', file).then(({ status, body }) => {
              setBusy(false);
              if (status >= 400 || !body || typeof body !== 'object' || !('id' in body)) {
                setError(errorMessage(body, 'That document was not saved.'));
                return;
              }
              navigate(`/documents/${String((body as { id: string }).id)}`);
            });
          }}
        />
      </label>
      {error ? <span className="ui-error">{error}</span> : null}
    </span>
  );
}
