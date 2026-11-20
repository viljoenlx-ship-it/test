import type { ReactNode } from 'react';
import { omnivateIconUrl } from './brand';

export function AuthScreen({
  title,
  lede,
  logoUrl,
  lockup = 'Omnivate',
  lockupSub = 'Systems',
  children,
  footer,
}: {
  title: string;
  lede?: string;
  logoUrl?: string | null;
  lockup?: string;
  lockupSub?: string | null;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="ui-auth">
      <div className="ui-auth-panel">
        <div className="ui-auth-brand">
          <img className="ui-mark-image ui-mark-lg" src={logoUrl || omnivateIconUrl} alt="" />
          <div className="ui-lockup">
            <span className="ui-wordmark">{lockup}</span>
            {lockupSub ? <span className="ui-wordmark-sub">{lockupSub}</span> : null}
          </div>
          <h1>{title}</h1>
          {lede ? <p>{lede}</p> : null}
        </div>
        <section className="ui-card ui-auth-card">{children}</section>
        {footer}
      </div>
    </div>
  );
}

export function DemoHint({ children }: { children: ReactNode }) {
  return (
    <details className="ui-demo">
      <summary>Demo Accounts</summary>
      <div className="ui-demo-body">{children}</div>
    </details>
  );
}
