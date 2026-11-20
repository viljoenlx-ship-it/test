import { AuthScreen, Button, Form, QrCode, Skeleton, TextField } from '@omnivate/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Navigate } from '../api';

type Pending =
  | { kind: 'loading' }
  | { kind: 'enroll'; secret: string; otpauthUrl: string }
  | { kind: 'verify' }
  | { kind: 'missing' };

export function MfaScreen({ navigate }: { navigate: Navigate }) {
  const [pending, setPending] = useState<Pending>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api('/auth/mfa/pending')
      .then(({ status, body }) => {
        if (cancelled) {
          return;
        }
        if (
          status === 200 &&
          body &&
          typeof body === 'object' &&
          'step' in body &&
          (body as { step: string }).step === 'mfa_enroll' &&
          'secret' in body &&
          'otpauthUrl' in body
        ) {
          const payload = body as { secret: string; otpauthUrl: string };
          setPending({ kind: 'enroll', secret: payload.secret, otpauthUrl: payload.otpauthUrl });
          return;
        }
        if (status === 200) {
          setPending({ kind: 'verify' });
          return;
        }
        setPending({ kind: 'missing' });
      })
      .catch(() => {
        if (!cancelled) {
          setPending({ kind: 'missing' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      setError('Enter the 6-digit code from your authenticator.');
      return;
    }
    setBusy(true);
    setError('');
    const { status, body } = await api('/auth/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (status === 200) {
      navigate('/users');
      return;
    }
    setError(errorMessage(body, 'That code was not accepted.'));
  }

  const title = pending.kind === 'enroll' ? 'Set Up Your Authenticator' : 'Enter Your Code';

  return (
    <AuthScreen
      title={pending.kind === 'loading' ? 'One moment' : title}
      lede={
        pending.kind === 'enroll'
          ? 'Add Omnivate to your authenticator app, then enter the code.'
          : pending.kind === 'verify'
            ? 'Enter the code from your authenticator app.'
            : undefined
      }
    >
      {pending.kind === 'loading' ? <Skeleton lines={3} /> : null}
      {pending.kind === 'missing' ? (
        <>
          <p>This step has expired. Sign in again.</p>
          <Button onClick={() => navigate('/login')}>Back To Sign In</Button>
        </>
      ) : null}
      {pending.kind === 'enroll' ? (
        <>
          <QrCode value={pending.otpauthUrl} label="Authenticator Setup Code" />
          <p className="ui-hint">Scan this code, or type the key below.</p>
          <p className="ui-secret">{pending.secret}</p>
        </>
      ) : null}
      {pending.kind === 'enroll' || pending.kind === 'verify' ? (
        <Form onSubmit={onSubmit}>
          <TextField
            label="6-Digit Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={setCode}
            error={error}
            required
          />
          <Button type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Confirm'}
          </Button>
        </Form>
      ) : null}
    </AuthScreen>
  );
}
