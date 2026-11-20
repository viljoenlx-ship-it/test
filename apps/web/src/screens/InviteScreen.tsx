import { plainRoleName } from '@omnivate/shared';
import { AuthScreen, Button, Form, Skeleton, TextField } from '@omnivate/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, type Navigate } from '../api';

type Preview = {
  email: string;
  tenantName: string;
  roleName: string;
  expired: boolean;
};

export function InviteScreen({ token, navigate }: { token: string; navigate: Navigate }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api(`/auth/invites/preview?token=${encodeURIComponent(token)}`)
      .then(({ status, body }) => {
        if (cancelled) {
          return;
        }
        if (status === 200 && body && typeof body === 'object' && 'email' in body) {
          setPreview(body as Preview);
          return;
        }
        setProblem(errorMessage(body, 'This invite link is not valid.'));
      })
      .catch(() => {
        if (!cancelled) {
          setProblem('We could not open this invite. Try again in a moment.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextName = displayName.trim().length < 1 ? 'Enter your name.' : '';
    const nextPassword = password.length < 10 ? 'Choose a password of at least 10 characters.' : '';
    setNameError(nextName);
    setPasswordError(nextPassword);
    if (nextName || nextPassword) {
      return;
    }
    setBusy(true);
    setError('');
    const { status, body } = await api('/auth/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token, displayName, password }),
    });
    setBusy(false);
    if (status === 200 && body && typeof body === 'object' && 'step' in body) {
      const step = (body as { step: string }).step;
      navigate(step === 'session' ? '/users' : '/mfa');
      return;
    }
    setError(errorMessage(body, 'The invite could not be accepted.'));
  }

  return (
    <AuthScreen
      title="Join Your Company"
      lede={
        preview
          ? `${preview.email} is invited to ${preview.tenantName} as ${plainRoleName({ name: preview.roleName })}.`
          : 'Use the link you were given.'
      }
    >
      {!preview && !problem ? <Skeleton lines={3} /> : null}
      {problem ? (
        <p className="ui-error" role="alert">
          {problem}
        </p>
      ) : null}
      {preview?.expired ? (
        <p className="ui-error" role="alert">
          This invite has expired. Ask for a new link.
        </p>
      ) : null}
      {preview && !preview.expired ? (
        <Form onSubmit={onSubmit}>
          <TextField
            label="Your Name"
            value={displayName}
            onChange={setDisplayName}
            autoComplete="name"
            error={nameError}
            required
          />
          <TextField
            label="Choose A Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            hint="At least 10 characters."
            error={passwordError}
            required
          />
          {error ? (
            <p className="ui-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Joining…' : 'Accept invite'}
          </Button>
        </Form>
      ) : null}
    </AuthScreen>
  );
}
