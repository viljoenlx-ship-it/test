import { useEffect, useState } from 'react';
import { Button, DialogFrame } from '@omnivate/ui';
import { api } from './api';

type Item = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

/** In-app alerts for the signed-in person. */
export function NotificationBell({ icon = false }: { icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);

  async function load() {
    const { status, body } = await api('/krn/workflows/notifications');
    if (status !== 200 || !body || typeof body !== 'object') {
      return;
    }
    const payload = body as { unread?: number; items?: Item[] };
    setItems(payload.items ?? []);
    setUnread(payload.unread ?? 0);
  }

  useEffect(() => {
    void load();
  }, []);

  async function mark(id: string) {
    await api('/krn/workflows/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    await load();
  }

  return (
    <>
      <Button
        variant={icon ? 'ghost' : 'secondary'}
        className={icon ? 'ui-bell ui-bell-icon' : 'ui-bell'}
        aria-label={unread > 0 ? `Alerts, ${unread} unread` : 'Alerts'}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        {icon ? (
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        ) : (
          'Alerts'
        )}
        {unread > 0 ? <span className="ui-bell-count">{unread}</span> : null}
      </Button>
      <DialogFrame
        open={open}
        onOpenChange={setOpen}
        title="Alerts"
        description="Messages for you, inside Omnivate."
      >
        {items.length === 0 ? <p>No alerts yet.</p> : null}
        <div className="ui-stack">
          {items.map((item) => (
            <article key={item.id}>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
              {item.read ? (
                <p className="ui-hint">Read</p>
              ) : (
                <Button variant="secondary" onClick={() => void mark(item.id)}>
                  Mark as read
                </Button>
              )}
            </article>
          ))}
        </div>
      </DialogFrame>
    </>
  );
}
