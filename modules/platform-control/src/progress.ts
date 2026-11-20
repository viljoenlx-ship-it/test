import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  labelForRuns,
  mergeRoadmap,
  parseRoadmap,
  type ProgressBoard,
  type PullSnapshot,
  type RoadmapItem,
} from '@omnivate/shared';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const roadmapPath = resolve(repoRoot, 'docs/progress/roadmap.json');

export const PROGRESS_CACHE_MS = 60_000;

const API = 'https://api.github.com';
const OWNER = 'viljoenlx-ship-it';
const REPO = 'Omnivate-Systems';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type RawPull = {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt: string | null;
  headSha: string;
};

function readPull(value: unknown): RawPull | null {
  if (!isRecord(value)) {
    return null;
  }
  const number = value.number;
  const title = value.title;
  const url = value.html_url;
  const state = value.state;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) {
    return null;
  }
  if (typeof title !== 'string' || typeof url !== 'string') {
    return null;
  }
  if (state !== 'open' && state !== 'closed') {
    return null;
  }
  const mergedAt = typeof value.merged_at === 'string' ? value.merged_at : null;
  const head = isRecord(value.head) && typeof value.head.sha === 'string' ? value.head.sha : '';
  return {
    number,
    title,
    url,
    state,
    merged: mergedAt !== null,
    mergedAt,
    headSha: head,
  };
}

function readPullList(body: unknown, label: string): RawPull[] {
  if (!Array.isArray(body)) {
    throw new Error(`GitHub ${label} list was not a list.`);
  }
  const pulls: RawPull[] = [];
  for (const entry of body) {
    const pull = readPull(entry);
    if (pull) {
      pulls.push(pull);
    }
  }
  return pulls;
}

type RawRun = { headSha: string; status: string; conclusion: string | null };

function readRuns(body: unknown): RawRun[] {
  if (!isRecord(body) || !Array.isArray(body.workflow_runs)) {
    throw new Error('GitHub workflow runs were not a list.');
  }
  const runs: RawRun[] = [];
  for (const entry of body.workflow_runs) {
    if (
      !isRecord(entry) ||
      typeof entry.head_sha !== 'string' ||
      typeof entry.status !== 'string'
    ) {
      continue;
    }
    runs.push({
      headSha: entry.head_sha,
      status: entry.status,
      conclusion: typeof entry.conclusion === 'string' ? entry.conclusion : null,
    });
  }
  return runs;
}

/**
 * Turn GitHub list payloads into pull snapshots.
 * Pass null for the workflow payload when that call failed. Check labels are then left blank.
 */
export function snapshotsFromGitHub(
  openBody: unknown,
  closedBody: unknown,
  actionsBody: unknown | null,
): PullSnapshot[] {
  const byNumber = new Map<number, RawPull>();
  for (const pull of readPullList(closedBody, 'closed pull request')) {
    byNumber.set(pull.number, pull);
  }
  for (const pull of readPullList(openBody, 'open pull request')) {
    byNumber.set(pull.number, pull);
  }
  const runs = actionsBody === null ? [] : readRuns(actionsBody);
  const checksKnown = actionsBody !== null;

  return [...byNumber.values()].map((pull) => {
    const matching = runs.filter((run) => run.headSha !== '' && run.headSha === pull.headSha);
    const checks =
      pull.state === 'open' && !pull.merged && checksKnown ? labelForRuns(matching) : null;
    return {
      number: pull.number,
      title: pull.title,
      url: pull.url,
      state: pull.state,
      merged: pull.merged,
      mergedAt: pull.mergedAt,
      checks,
    };
  });
}

export async function readRoadmapFile(): Promise<RoadmapItem[]> {
  const text = await readFile(roadmapPath, 'utf8');
  return parseRoadmap(JSON.parse(text) as unknown);
}

export async function fetchGitHubPulls(
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PullSnapshot[]> {
  const token = env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': 'omnivate-progress',
    'x-github-api-version': '2022-11-28',
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  async function getJson(path: string): Promise<unknown> {
    const response = await fetchImpl(`${API}${path}`, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`GitHub responded with ${response.status}.`);
    }
    return response.json() as Promise<unknown>;
  }

  async function listPulls(state: 'open' | 'closed'): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const body = await getJson(
        `/repos/${OWNER}/${REPO}/pulls?state=${state}&per_page=100&sort=updated&direction=desc&page=${page}`,
      );
      if (!Array.isArray(body)) {
        throw new Error(`GitHub ${state} pull request list was not a list.`);
      }
      rows.push(...body);
      if (body.length < 100) {
        break;
      }
    }
    return rows;
  }

  const open = await listPulls('open');
  const closed = await listPulls('closed');
  let actions: unknown | null = null;
  try {
    actions = await getJson(`/repos/${OWNER}/${REPO}/actions/runs?per_page=50`);
  } catch {
    actions = null;
  }
  return snapshotsFromGitHub(open, closed, actions);
}

export async function loadProgressBoard(deps?: {
  readItems?: () => Promise<RoadmapItem[]>;
  fetchPulls?: () => Promise<PullSnapshot[]>;
  now?: () => Date;
}): Promise<ProgressBoard> {
  const readItems = deps?.readItems ?? readRoadmapFile;
  const fetchPulls = deps?.fetchPulls ?? (() => fetchGitHubPulls());
  const now = deps?.now ?? (() => new Date());
  const items = await readItems();
  try {
    const pulls = await fetchPulls();
    return mergeRoadmap(items, pulls, { github: 'live', now: now() });
  } catch {
    return mergeRoadmap(items, [], { github: 'unavailable', now: now() });
  }
}

let cached: { expires: number; board: ProgressBoard } | null = null;

export function clearProgressCache(): void {
  cached = null;
}

export async function progressBoard(): Promise<ProgressBoard> {
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.board;
  }
  const board = await loadProgressBoard();
  cached = { expires: now + PROGRESS_CACHE_MS, board };
  return board;
}
