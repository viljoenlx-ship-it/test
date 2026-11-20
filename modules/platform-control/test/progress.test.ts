import {
  combineChecks,
  labelForRuns,
  mergeRoadmap,
  MODULE_IDS,
  parseRoadmap,
  productCaption,
  productScore,
  pullUrl,
  type PullSnapshot,
  type RoadmapItem,
} from '@omnivate/shared';
import { describe, expect, it } from 'vitest';
import { loadProgressBoard, readRoadmapFile, snapshotsFromGitHub } from '../src/progress';

const now = new Date('2026-11-19T16:00:00.000Z');

function row(overrides: Partial<RoadmapItem> & Pick<RoadmapItem, 'id'>): RoadmapItem {
  return {
    title: 'Sample Widget',
    description: 'A made-up row used only in this test.',
    phase: 'Phase 1 MVP',
    status: 'coming',
    ...overrides,
  };
}

function pull(overrides: Partial<PullSnapshot> & Pick<PullSnapshot, 'number'>): PullSnapshot {
  return {
    title: 'Add the sample widget',
    url: `https://example.com/pull/${overrides.number}`,
    state: 'open',
    merged: false,
    mergedAt: null,
    checks: 'Checks Running',
    ...overrides,
  };
}

describe('roadmap merge', () => {
  it('marks a row done when its pull request has merged', () => {
    const board = mergeRoadmap(
      [row({ id: 'sample-widget', status: 'in_progress', prs: [7] })],
      [
        pull({
          number: 7,
          state: 'closed',
          merged: true,
          mergedAt: '2026-11-19T12:00:00.000Z',
          checks: null,
        }),
      ],
      { github: 'live', now },
    );
    expect(board.github).toBe('live');
    expect(board.items[0]).toMatchObject({
      status: 'done',
      finishedOn: '2026-11-19T12:00:00.000Z',
      checks: null,
    });
    expect(board.counts).toEqual({ done: 1, inProgress: 0, coming: 0 });
    expect(board.percent).toBe(0);
    expect(board.modulesTotal).toBe(0);
  });

  it('keeps an open pull request in progress and shows the worst check', () => {
    const board = mergeRoadmap(
      [row({ id: 'sample-widget', status: 'coming', prs: [8, 9] })],
      [
        pull({ number: 8, checks: 'Checks Passing' }),
        pull({ number: 9, checks: 'Checks Failing' }),
      ],
      { github: 'live', now },
    );
    expect(board.items[0]).toMatchObject({
      status: 'in_progress',
      checks: 'Checks Failing',
      finishedOn: null,
    });
  });

  it('shows an open pull request that is not on the roadmap', () => {
    const board = mergeRoadmap(
      [row({ id: 'sample-widget', status: 'done', finishedOn: '2026-11-01', prs: [4] })],
      [
        pull({
          number: 4,
          state: 'closed',
          merged: true,
          mergedAt: '2026-11-01T00:00:00.000Z',
          checks: null,
        }),
        pull({ number: 404, title: 'Add the sample packing note', checks: 'Checks Running' }),
      ],
      { github: 'live', now },
    );
    const extra = board.items.find((item) => item.id === 'pr-404');
    expect(extra).toMatchObject({
      title: 'Add the sample packing note',
      description: 'This pull request is not on the roadmap yet.',
      phase: 'Open Pull Requests',
      status: 'in_progress',
      checks: 'Checks Running',
    });
    expect(
      board.items.some((item) => item.prs.some((pr) => pr.number === 4) && item.id === 'pr-4'),
    ).toBe(false);
  });

  it('does not treat a closed unmerged pull request as done', () => {
    const board = mergeRoadmap(
      [row({ id: 'sample-widget', status: 'in_progress', prs: [5] })],
      [pull({ number: 5, state: 'closed', merged: false, checks: null })],
      { github: 'live', now },
    );
    expect(board.items[0]?.status).toBe('in_progress');
    expect(board.items[0]?.finishedOn).toBeNull();
  });

  it('lets a newer open pull request win over an older merged one on the same row', () => {
    const board = mergeRoadmap(
      [row({ id: 'sample-widget', status: 'done', finishedOn: '2026-11-01', prs: [3, 6] })],
      [
        pull({
          number: 3,
          state: 'closed',
          merged: true,
          mergedAt: '2026-11-01T00:00:00.000Z',
          checks: null,
        }),
        pull({ number: 6, checks: 'Checks Passing' }),
      ],
      { github: 'live', now },
    );
    expect(board.items[0]).toMatchObject({
      status: 'in_progress',
      checks: 'Checks Passing',
      finishedOn: null,
    });
  });

  it('leaves the file unchanged when GitHub sent no pulls', () => {
    const board = mergeRoadmap([row({ id: 'sample-widget', status: 'coming' })], [], {
      github: 'unavailable',
      now,
    });
    expect(board.github).toBe('unavailable');
    expect(board.updatedAt).toBe('2026-11-19T16:00:00.000Z');
    expect(board.items).toEqual([
      {
        id: 'sample-widget',
        title: 'Sample Widget',
        description: 'A made-up row used only in this test.',
        phase: 'Phase 1 MVP',
        status: 'coming',
        prs: [],
        checks: null,
        finishedOn: null,
      },
    ]);
    expect(board.percent).toBe(0);
  });
});

describe('full product percentage', () => {
  it('counts each module as one and gives half credit while work is in progress', () => {
    const score = productScore([
      row({ id: 'KRN-01', status: 'done', finishedOn: '2026-11-19' }),
      row({ id: 'KRN-02', status: 'in_progress' }),
      row({ id: 'KRN-03', status: 'coming' }),
    ]);
    expect(score).toEqual({ percent: 50, modulesDone: 1, modulesTotal: 3 });
    expect(productCaption(score)).toBe('50% Of The Full Product · 1 Of 3 Modules Done');
  });

  it('averages a module with its extra rows instead of treating the extra rows as modules', () => {
    const score = productScore([
      row({ id: 'SCM-01', status: 'done', finishedOn: '2026-11-19' }),
      row({ id: 'labels', status: 'done', finishedOn: '2026-11-19', moduleId: 'SCM-01' }),
      row({ id: 'snap', status: 'in_progress', moduleId: 'SCM-01' }),
    ]);
    expect(score).toEqual({ percent: 83, modulesDone: 0, modulesTotal: 1 });
  });

  it('does not count a row that is not one of the 36 modules', () => {
    const score = productScore([
      row({ id: 'foundation', status: 'done', finishedOn: '2026-11-19' }),
      row({ id: 'KRN-01', status: 'coming' }),
    ]);
    expect(score).toEqual({ percent: 0, modulesDone: 0, modulesTotal: 1 });
  });

  it('moves when a module is added', () => {
    const done = row({ id: 'KRN-01', status: 'done', finishedOn: '2026-11-19' });
    expect(productScore([done])).toEqual({ percent: 100, modulesDone: 1, modulesTotal: 1 });
    expect(productScore([done, row({ id: 'KRN-02', status: 'coming' })])).toEqual({
      percent: 50,
      modulesDone: 1,
      modulesTotal: 2,
    });
  });

  it('does not call a module done while one of its rows is still coming', () => {
    const score = productScore([
      row({ id: 'KRN-06', status: 'done', finishedOn: '2026-11-19' }),
      row({ id: 'cleanup', status: 'coming', moduleId: 'KRN-06' }),
    ]);
    expect(score).toEqual({ percent: 50, modulesDone: 0, modulesTotal: 1 });
  });
});

describe('check labels', () => {
  it('says running when nothing has reported yet', () => {
    expect(labelForRuns([])).toBe('Checks Running');
  });

  it('says failing when any completed run failed', () => {
    expect(
      labelForRuns([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'failure' },
      ]),
    ).toBe('Checks Failing');
  });

  it('says running while a run is still going', () => {
    expect(labelForRuns([{ status: 'in_progress', conclusion: null }])).toBe('Checks Running');
  });

  it('says passing when every run succeeded or was skipped', () => {
    expect(
      labelForRuns([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'skipped' },
      ]),
    ).toBe('Checks Passing');
  });

  it('lets a failure beat a run that is still going', () => {
    expect(
      combineChecks([
        labelForRuns([{ status: 'completed', conclusion: 'cancelled' }]),
        labelForRuns([{ status: 'queued', conclusion: null }]),
      ]),
    ).toBe('Checks Failing');
  });
});

describe('GitHub payloads', () => {
  it('reads a made-up pull list and leaves checks blank when runs were not loaded', () => {
    const open = [
      {
        number: 404,
        title: 'Add the sample widget',
        html_url: 'https://example.com/pull/404',
        state: 'open',
        merged_at: null,
        head: { sha: 'abc123' },
      },
    ];
    const closed = [
      {
        number: 7,
        title: 'Add the sample packing note',
        html_url: 'https://example.com/pull/7',
        state: 'closed',
        merged_at: '2026-11-19T12:00:00Z',
        head: { sha: 'def456' },
      },
    ];
    const snaps = snapshotsFromGitHub(open, closed, null);
    expect(snaps).toEqual([
      {
        number: 7,
        title: 'Add the sample packing note',
        url: 'https://example.com/pull/7',
        state: 'closed',
        merged: true,
        mergedAt: '2026-11-19T12:00:00Z',
        checks: null,
      },
      {
        number: 404,
        title: 'Add the sample widget',
        url: 'https://example.com/pull/404',
        state: 'open',
        merged: false,
        mergedAt: null,
        checks: null,
      },
    ]);
  });

  it('labels an open pull request from the workflow runs on its commit', () => {
    const open = [
      {
        number: 404,
        title: 'Add the sample widget',
        html_url: 'https://example.com/pull/404',
        state: 'open',
        merged_at: null,
        head: { sha: 'abc123' },
      },
    ];
    const actions = {
      workflow_runs: [
        { head_sha: 'abc123', status: 'completed', conclusion: 'success' },
        { head_sha: 'other', status: 'completed', conclusion: 'failure' },
      ],
    };
    const snaps = snapshotsFromGitHub(open, [], actions);
    expect(snaps[0]?.checks).toBe('Checks Passing');
  });
});

describe('roadmap file and GitHub fallback', () => {
  it('rejects a row with no title', () => {
    expect(() => parseRoadmap({ items: [{ id: 'sample-widget' }] })).toThrow(/title/);
  });

  it('reads the checked-in roadmap', async () => {
    const items = await readRoadmapFile();
    const ids = new Set(items.map((item) => item.id));
    expect(ids.size).toBe(items.length);
    for (const id of MODULE_IDS) {
      expect(ids.has(id)).toBe(true);
    }
    expect(items.find((item) => item.id === 'foundation')?.prs).toEqual([1]);
    expect(items.find((item) => item.id === 'KRN-01')?.status).toBe('done');
    expect(items.find((item) => item.id === 'SCM-01')?.prs).toEqual([8]);
    expect(items.find((item) => item.id === 'label-print')?.prs).toEqual([11]);
    expect(items.find((item) => item.id === 'KRN-06')?.prs).toEqual([9]);
    expect(items.find((item) => item.id === 'mfa-switch')?.prs).toEqual([10]);
    expect(items.find((item) => item.id === 'calm-ui')?.prs).toEqual([12]);
    expect(items.find((item) => item.id === 'calculated-fields')).toMatchObject({
      status: 'done',
      prs: [13],
    });
    expect(items.find((item) => item.id === 'snap-document')).toMatchObject({
      status: 'done',
      prs: [14],
    });
    expect(items.find((item) => item.id === 'grv-labels')).toMatchObject({
      status: 'done',
      moduleId: 'SCM-01',
      prs: [16],
    });
    expect(items.find((item) => item.id === 'build-progress')).toMatchObject({
      status: 'done',
      prs: [15, 17],
    });
    expect(items.find((item) => item.id === 'standard-reader')).toBeUndefined();
    expect(items.find((item) => item.id === 'standard-document-reader')).toMatchObject({
      title: 'Standard Document Reader',
      phase: 'Phase 1 MVP',
      status: 'done',
      moduleId: 'SCM-01',
      prs: [18],
      finishedOn: '2026-11-19',
    });
    expect(items.find((item) => item.id === 'report-builder')).toMatchObject({
      title: 'Dynamic Report Builder',
      phase: 'Phase 1 MVP',
      status: 'done',
      moduleId: 'ANA-03',
      prs: [19],
      finishedOn: '2026-11-19',
    });
    expect(items.find((item) => item.id === 'demo-polish')).toMatchObject({
      status: 'done',
      prs: [20],
      finishedOn: '2026-11-19',
    });
    expect(items.find((item) => item.id === 'sales-quotes-invoices')).toMatchObject({
      title: 'Sales: Quotes, Invoices And Payments',
      phase: 'Phase 1b',
      status: 'in_progress',
    });
    expect(items.filter((item) => item.title === 'Standard Document Reader')).toHaveLength(1);
    expect(items.find((item) => item.id === 'krn06-cleanup')?.status).toBe('coming');
    expect(items.find((item) => item.id === 'paid-hosting')?.status).toBe('coming');
    expect(items.find((item) => item.id === 'SAL-01')?.phase).toBe('Phase 1b');
    expect(items.find((item) => item.id === 'FIN-01')?.phase).toBe('Phase 1b');
    expect(items.find((item) => item.id === 'FIN-02')?.phase).toBe('Phase 1b');
    const score = productScore(items);
    expect(score).toEqual({ percent: 18, modulesDone: 5, modulesTotal: 36 });
    expect(productCaption(score)).toBe('18% Of The Full Product · 5 Of 36 Modules Done');
  });

  it('falls back to the file when GitHub cannot be reached', async () => {
    const board = await loadProgressBoard({
      fetchPulls: async () => {
        throw new Error('network down');
      },
      now: () => now,
    });
    expect(board.github).toBe('unavailable');
    expect(board.updatedAt).toBe(now.toISOString());
    expect(board.items.find((item) => item.id === 'SCM-01')).toMatchObject({
      status: 'done',
      prs: [{ number: 8, url: pullUrl(8) }],
    });
    expect(board.items.find((item) => item.id === 'calculated-fields')?.status).toBe('done');
    expect(board.items.some((item) => item.phase === 'Open Pull Requests')).toBe(false);
    expect(board.counts.done).toBeGreaterThan(0);
    expect(board.counts.inProgress).toBeGreaterThan(0);
    expect(board.counts.coming).toBeGreaterThan(0);
  });

  it('falls back when GitHub refuses the request', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ message: 'rate limit' }), { status: 403 });
    const board = await loadProgressBoard({
      fetchPulls: async () => {
        const { fetchGitHubPulls } = await import('../src/progress');
        return fetchGitHubPulls(fetchImpl, {});
      },
      now: () => now,
    });
    expect(board.github).toBe('unavailable');
    expect(board.items.find((item) => item.id === 'KRN-02')?.status).toBe('done');
  });

  it('merges a live list when the fetch succeeds', async () => {
    const board = await loadProgressBoard({
      fetchPulls: async () => [
        pull({
          number: 13,
          title: 'Add calculated fields and operator automations',
          url: pullUrl(13),
          checks: 'Checks Passing',
        }),
        pull({
          number: 404,
          title: 'Add the sample widget',
          url: 'https://example.com/pull/404',
          checks: 'Checks Running',
        }),
      ],
      now: () => now,
    });
    expect(board.github).toBe('live');
    expect(board.items.find((item) => item.id === 'calculated-fields')).toMatchObject({
      status: 'in_progress',
      checks: 'Checks Passing',
    });
    expect(board.items.find((item) => item.id === 'pr-404')?.title).toBe('Add the sample widget');
    expect(board.items.find((item) => item.id === 'foundation')?.status).toBe('done');
  });
});
