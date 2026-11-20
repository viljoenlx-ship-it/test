import { DEMO_PASSWORD, demoAccounts, demoTenants } from '@omnivate/shared';
import {
  AuthScreen,
  Button,
  DemoHint,
  DialogFrame,
  Form,
  SelectField,
  TextField,
  usePhone,
} from '@omnivate/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, type Navigate } from '../api';
import type { Brand } from '../App';
import { showDemoHints } from '../preview';

type CompanyChoice = { slug: string; name: string };

const SLUG = /^[a-z0-9-]{2,63}$/;

export function LoginScreen({
  navigate,
  onBrand,
}: {
  navigate: Navigate;
  onBrand: (brand: Brand | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [companies, setCompanies] = useState<CompanyChoice[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [remember, setRemember] = useState(false);
  const phone = usePhone();
  const [brand, setBrand] = useState<Brand | null>(null);
  const onBrandRef = useRef(onBrand);
  onBrandRef.current = onBrand;

  const brandSlug = companies ? chosen : companyCode.trim().toLowerCase();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('omnivate.remember-email');
      if (saved) {
        setEmail(saved);
        setRemember(true);
      }
    } catch {
      // Storage can be blocked. Sign-in still works.
    }
  }, []);

  useEffect(() => {
    if (!SLUG.test(brandSlug)) {
      setBrand(null);
      onBrandRef.current(null);
      return;
    }
    let cancelled = false;
    api(`/branding/${brandSlug}`)
      .then(({ status, body }) => {
        if (cancelled || status !== 200 || !body || typeof body !== 'object') {
          if (!cancelled) {
            setBrand(null);
            onBrandRef.current(null);
          }
          return;
        }
        const next = body as {
          displayName: string;
          brandPrimary: string;
          brandAccent: string;
          hasLogo: boolean;
          slug: string;
        };
        const painted: Brand = {
          displayName: next.displayName,
          primary: next.brandPrimary,
          accent: next.brandAccent,
          logoUrl: next.hasLogo ? `/api/branding/${next.slug}/logo` : null,
        };
        setBrand(painted);
        onBrandRef.current(painted);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [brandSlug]);

  function resetChoice() {
    setCompanies(null);
    setChosen('');
    setError('');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next: { email?: string; password?: string } = {};
    if (!email.includes('@')) {
      next.email = 'Enter your email address.';
    }
    if (password.length < 10) {
      next.password = 'Enter your password. It is at least 10 characters.';
    }
    setFieldErrors(next);
    if (next.email || next.password) {
      return;
    }
    const code = companies ? chosen : companyCode.trim().toLowerCase();
    if (code && !SLUG.test(code)) {
      setError('Company code uses letters, numbers, and hyphens.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (remember) {
        window.localStorage.setItem('omnivate.remember-email', email);
      } else {
        window.localStorage.removeItem('omnivate.remember-email');
      }
    } catch {
      // The sign-in does not depend on remembering the email.
    }
    const payload: { email: string; password: string; tenantSlug?: string } = { email, password };
    if (code) {
      payload.tenantSlug = code;
    }
    const { status, body } = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (status === 200 && body && typeof body === 'object' && 'step' in body) {
      const step = (body as { step: string }).step;
      if (step === 'choose_company' && 'companies' in body && Array.isArray(body.companies)) {
        const list = body.companies.filter(
          (item): item is CompanyChoice =>
            Boolean(item) &&
            typeof item === 'object' &&
            'slug' in item &&
            'name' in item &&
            typeof item.slug === 'string' &&
            typeof item.name === 'string',
        );
        if (list.length > 1) {
          setCompanies(list);
          setChosen(list[0]?.slug ?? '');
          return;
        }
      }
      if (step === 'session') {
        navigate('/users');
        return;
      }
      if (step === 'mfa_enroll' || step === 'mfa_verify') {
        navigate('/mfa');
        return;
      }
    }
    setError(errorMessage(body, 'That email or password was not recognised.'));
  }

  return (
    <AuthScreen
      title="Sign In"
      lede={
        companies
          ? 'This email belongs to more than one company. Choose one.'
          : brand
            ? `Welcome to ${brand.displayName}.`
            : 'Welcome back.'
      }
      logoUrl={brand?.logoUrl}
      lockup={brand?.displayName ?? 'Omnivate'}
      lockupSub={brand ? null : 'Systems'}
      footer={
        showDemoHints() && !companies ? (
          <DemoHint>
            <p>
              Sample password <code>{DEMO_PASSWORD}</code>
            </p>
            <ul className="ui-demo-list">
              {demoAccounts.map((account) => {
                const company = demoTenants.find((tenant) => tenant.id === account.tenantId);
                return (
                  <li key={account.email}>
                    <button
                      type="button"
                      className="ui-demo-person"
                      onClick={() => {
                        setEmail(account.email);
                        setCompanyCode('');
                        resetChoice();
                      }}
                    >
                      <strong>{account.displayName}</strong>
                      <span className="ui-hint">
                        {account.email}
                        {company ? ` · ${company.displayName}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </DemoHint>
        ) : null
      }
    >
      <Form onSubmit={onSubmit}>
        {companies ? (
          <SelectField label="Company" value={chosen} onChange={setChosen}>
            {companies.map((company) => (
              <option key={company.slug} value={company.slug}>
                {company.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <>
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
              error={fieldErrors.email}
              required
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              error={fieldErrors.password}
              required
            />
            <TextField
              label="Company code"
              autoComplete="organization"
              value={companyCode}
              onChange={setCompanyCode}
              hint="Optional. Leave this blank unless you were given a company code."
            />
          </>
        )}
        {companies ? (
          <button type="button" className="ui-text-link" onClick={resetChoice}>
            Use a different email
          </button>
        ) : phone ? (
          <div className="ui-auth-row">
            <label className="ui-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Remember Me
            </label>
            <button type="button" className="ui-text-link" onClick={() => setForgot(true)}>
              Forgot Password?
            </button>
          </div>
        ) : (
          <button type="button" className="ui-text-link" onClick={() => setForgot(true)}>
            Forgot password?
          </button>
        )}
        {error ? (
          <p className="ui-error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </Button>
      </Form>
      <DialogFrame
        open={forgot}
        onOpenChange={setForgot}
        title="Forgot password?"
        description="Password reset is not available yet. Ask the person who invited you for a new link."
      >
        <Button onClick={() => setForgot(false)}>Close</Button>
      </DialogFrame>
    </AuthScreen>
  );
}
