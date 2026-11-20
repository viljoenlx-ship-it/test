import {
  dayLabel,
  exactTime,
  explainActivity,
  relativeTime,
  type ActivityIcon,
} from '@omnivate/shared';
import {
  Building2,
  LogIn,
  LogOut,
  Palette,
  Settings,
  ShieldCheck,
  UserRound,
  Boxes,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { DialogFrame } from './components';

export type FeedItem = {
  id: string;
  title: string;
  icon: ActivityIcon;
  actor: string;
  company: string | null;
  occurredAt: string;
  rawAction: string;
  beforeData?: unknown;
  afterData?: unknown;
};

const icons = {
  'sign-in': LogIn,
  'sign-out': LogOut,
  shield: ShieldCheck,
  company: Building2,
  person: UserRound,
  settings: Settings,
  module: Boxes,
  brand: Palette,
} satisfies Record<ActivityIcon, typeof LogIn>;

export function ActivityFeed({
  items,
  emptyTitle,
  emptyBody,
}: {
  items: FeedItem[];
  emptyTitle: string;
  emptyBody: string;
}) {
  const [open, setOpen] = useState<FeedItem | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const item of items) {
      const label = dayLabel(item.occurredAt);
      const list = map.get(label) ?? [];
      list.push(item);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="ui-empty">
        <h3>{emptyTitle}</h3>
        <p>{emptyBody}</p>
      </div>
    );
  }

  return (
    <>
      <div className="ui-feed">
        {groups.map(([label, group]) => (
          <section key={label}>
            <h3>{label}</h3>
            <ul>
              {group.map((item) => {
                const Icon = icons[item.icon];
                return (
                  <li key={item.id}>
                    <button type="button" className="ui-feed-row" onClick={() => setOpen(item)}>
                      <span className="ui-feed-icon" aria-hidden="true">
                        <Icon size={16} />
                      </span>
                      <span className="ui-feed-copy">
                        <strong>{item.title}</strong>
                        <span>
                          {item.actor}
                          {item.company ? ` · ${item.company}` : ''}
                        </span>
                      </span>
                      <time dateTime={item.occurredAt} title={exactTime(item.occurredAt)}>
                        {relativeTime(item.occurredAt)}
                      </time>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <DialogFrame
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) {
            setOpen(null);
          }
        }}
        title={open?.title ?? 'Activity'}
        description={
          open
            ? `${open.actor}${open.company ? ` · ${open.company}` : ''} · ${exactTime(open.occurredAt)}`
            : undefined
        }
      >
        {open ? <ActivityDetail item={open} /> : null}
      </DialogFrame>
    </>
  );
}

function ActivityDetail({ item }: { item: FeedItem }) {
  const notes = explainActivity(item.rawAction, item.beforeData, item.afterData);
  return (
    <div className="ui-detail">
      <p>This is the record of that change. It is kept and is not edited.</p>
      <ul>
        {notes.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
