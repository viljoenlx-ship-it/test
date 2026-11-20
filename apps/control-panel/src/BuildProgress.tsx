import {
  productCaption,
  PROGRESS_OPEN_PHASE,
  PROGRESS_PHASES,
  type CheckLabel,
  type ProgressBoard,
  type ProgressCard,
  type ProgressStatus,
} from '@omnivate/shared';
import { Badge, Card, Skeleton } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api } from './api';
import './progress.css';

const REFRESH_MS = 60_000;

const COLUMNS: { status: ProgressStatus; title: string }[] = [
  { status: 'done', title: 'Done' },
  { status: 'in_progress', title: 'In Progress' },
  { status: 'coming', title: 'Still Coming' },
];

function johannesburg(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const formatted = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${formatted} Johannesburg`;
}

function dayLabel(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map((part) => Number(part));
    if (!year || !month || !day) {
      return value;
    }
    return new Intl.DateTimeFormat('en-ZA', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function checkTone(label: CheckLabel): 'ok' | 'warn' | 'bad' {
  if (label === 'Checks Passing') return 'ok';
  if (label === 'Checks Failing') return 'bad';
  return 'warn';
}

function isBoard(body: unknown): body is ProgressBoard {
  return (
    typeof body === 'object' &&
    body !== null &&
    'items' in body &&
    Array.isArray(body.items) &&
    'counts' in body &&
    'percent' in body &&
    'modulesDone' in body &&
    'modulesTotal' in body
  );
}

export function BuildProgress() {
  const [board, setBoard] = useState<ProgressBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState('all');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { status, body } = await api('/control/progress');
        if (cancelled) {
          return;
        }
        if (status === 200 && isBoard(body)) {
          setBoard(body);
          setFailed(false);
          return;
        }
        if (!cancelled) {
          setFailed(true);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    }

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!board && !failed) {
    return (
      <section className="build-progress" aria-labelledby="build-progress-title">
        <Card>
          <h2 id="build-progress-title">Build Progress</h2>
          <Skeleton lines={4} />
        </Card>
      </section>
    );
  }

  if (!board) {
    return (
      <section className="build-progress" aria-labelledby="build-progress-title">
        <Card>
          <h2 id="build-progress-title">Build Progress</h2>
          <p className="progress-note">Build progress could not be loaded.</p>
        </Card>
      </section>
    );
  }

  const phases = [...PROGRESS_PHASES, PROGRESS_OPEN_PHASE].filter((name) =>
    board.items.some((item) => item.phase === name),
  );
  const visiblePhase = phase === 'all' || phases.includes(phase) ? phase : 'all';
  const caption = productCaption(board);
  const counts = `${board.counts.done} Done · ${board.counts.inProgress} In Progress · ${board.counts.coming} Coming`;

  return (
    <section className="build-progress" aria-labelledby="build-progress-title">
      <Card>
        <div className="progress-top">
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={board.percent}
            aria-label={caption}
          >
            <span style={{ width: `${board.percent}%` }} />
          </div>
          <p className="progress-caption">{caption}</p>
        </div>
        <h2 id="build-progress-title">Build Progress</h2>
        <p className="progress-counts">{counts}</p>
        <p className="progress-note">Last Updated {johannesburg(board.updatedAt)}</p>
        {board.github === 'unavailable' ? (
          <p className="progress-note">
            Live pull request status is unavailable. Showing the saved list.
          </p>
        ) : null}
        <div className="progress-filters" role="group" aria-label="Filter By Phase">
          <button
            type="button"
            aria-pressed={visiblePhase === 'all'}
            onClick={() => setPhase('all')}
          >
            All Phases
          </button>
          {phases.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={visiblePhase === name}
              onClick={() => setPhase(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </Card>
      <div className="progress-columns">
        {COLUMNS.map((column) => {
          const rows = board.items.filter(
            (item) =>
              item.status === column.status &&
              (visiblePhase === 'all' || item.phase === visiblePhase),
          );
          return (
            <section key={column.status} className="progress-column" aria-label={column.title}>
              <h3>
                {column.title}
                <span>{rows.length}</span>
              </h3>
              {rows.length === 0 ? (
                <p className="progress-empty">Nothing in this list.</p>
              ) : (
                <PhaseGroups items={rows} />
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function PhaseGroups({ items }: { items: ProgressCard[] }) {
  const order = [...PROGRESS_PHASES, PROGRESS_OPEN_PHASE];
  const phases = order.filter((name) => items.some((item) => item.phase === name));
  return (
    <>
      {phases.map((name) => (
        <div key={name}>
          <h4 className="progress-phase">{name}</h4>
          <div className="progress-cards">
            {items
              .filter((item) => item.phase === name)
              .map((item) => (
                <ProgressItem key={item.id} item={item} />
              ))}
          </div>
        </div>
      ))}
    </>
  );
}

function ProgressItem({ item }: { item: ProgressCard }) {
  return (
    <article className={`progress-card ${item.status}`}>
      <h5>{item.title}</h5>
      <p>{item.description}</p>
      {item.prs.length > 0 || item.finishedOn || item.checks ? (
        <p className="progress-meta">
          {item.prs.map((pr) => (
            <a key={pr.number} href={pr.url} target="_blank" rel="noreferrer">
              PR #{pr.number}
            </a>
          ))}
          {item.finishedOn ? <span>{dayLabel(item.finishedOn)}</span> : null}
          {item.checks ? <Badge tone={checkTone(item.checks)}>{item.checks}</Badge> : null}
        </p>
      ) : null}
    </article>
  );
}
