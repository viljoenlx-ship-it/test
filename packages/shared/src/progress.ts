/**
 * Build progress list for the control panel Overview.
 * The file docs/progress/roadmap.json is the source of truth.
 * Live pull request state can move a row between Done and In Progress.
 */

import { isModuleId, type ModuleId } from './modules';

export const PROGRESS_PHASES = [
  'Phase 1 MVP',
  'Phase 1b',
  'Tier 1 Kernel',
  'Tier 2 Commercial Core',
  'Tier 3 Operational',
  'Tier 4 Back-Office',
] as const;

export type ProgressPhase = (typeof PROGRESS_PHASES)[number];

/** Shown only for an open pull request that has no row in the file. */
export const PROGRESS_OPEN_PHASE = 'Open Pull Requests';

export const PROGRESS_STATUSES = ['done', 'in_progress', 'coming'] as const;

export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export const CHECK_LABELS = ['Checks Passing', 'Checks Running', 'Checks Failing'] as const;

export type CheckLabel = (typeof CHECK_LABELS)[number];

export const GITHUB_REPOSITORY = {
  owner: 'viljoenlx-ship-it',
  name: 'Omnivate-Systems',
} as const;

export type RoadmapItem = {
  id: string;
  title: string;
  description: string;
  phase: ProgressPhase;
  status: ProgressStatus;
  /** Blueprint module this row belongs to, when the row id is not already that module. */
  moduleId?: ModuleId;
  prs?: number[];
  finishedOn?: string;
};

export type PullSnapshot = {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt: string | null;
  /** Null when check results were not loaded. */
  checks: CheckLabel | null;
};

export type ProgressCard = {
  id: string;
  title: string;
  description: string;
  phase: string;
  status: ProgressStatus;
  moduleId?: ModuleId;
  prs: { number: number; url: string }[];
  checks: CheckLabel | null;
  finishedOn: string | null;
};

export type ProductScore = {
  /** Nearest whole percent of the full product. */
  percent: number;
  /** Modules whose rows are all done. */
  modulesDone: number;
  /** Blueprint modules named by the roadmap. */
  modulesTotal: number;
};

export type ProgressBoard = {
  updatedAt: string;
  github: 'live' | 'unavailable';
  counts: { done: number; inProgress: number; coming: number };
  percent: number;
  modulesDone: number;
  modulesTotal: number;
  items: ProgressCard[];
};

/**
 * How far the product is.
 *
 * The blueprint lists 36 modules and does not give them a size, so each module
 * counts as 1. A row belongs to a module when its id is that module, or when
 * moduleId says so. Done counts as 1, in progress as 0.5, and still coming as 0.
 * The module's score is the average of its rows. The bar is the average of those
 * scores. A module counts as done only when every one of its rows is done.
 * A row that is not one of the 36 modules does not move the bar.
 * Adding or removing a module row changes the total, because the total is the
 * modules named in the roadmap, not a fixed number copied into the page.
 */
export function productScore(
  items: readonly Pick<RoadmapItem, 'id' | 'status' | 'moduleId'>[],
): ProductScore {
  const rows = new Map<ModuleId, ProgressStatus[]>();
  for (const item of items) {
    const moduleId = item.moduleId ?? (isModuleId(item.id) ? item.id : null);
    if (!moduleId || !isModuleId(moduleId)) {
      continue;
    }
    const list = rows.get(moduleId) ?? [];
    list.push(item.status);
    rows.set(moduleId, list);
  }

  const modules = [...rows.values()];
  if (modules.length === 0) {
    return { percent: 0, modulesDone: 0, modulesTotal: 0 };
  }

  let score = 0;
  let modulesDone = 0;
  for (const statuses of modules) {
    const halves = statuses.reduce((sum, status) => {
      if (status === 'done') return sum + 2;
      if (status === 'in_progress') return sum + 1;
      return sum;
    }, 0);
    score += halves / (statuses.length * 2);
    if (halves === statuses.length * 2) {
      modulesDone += 1;
    }
  }

  return {
    percent: Math.round((score / modules.length) * 100),
    modulesDone,
    modulesTotal: modules.length,
  };
}

export function productCaption(score: ProductScore): string {
  return `${score.percent}% Of The Full Product · ${score.modulesDone} Of ${score.modulesTotal} Modules Done`;
}

const FAILING_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
]);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export function pullUrl(number: number): string {
  return `https://github.com/${GITHUB_REPOSITORY.owner}/${GITHUB_REPOSITORY.name}/pull/${number}`;
}

export function labelForRuns(
  runs: readonly { status: string; conclusion: string | null }[],
): CheckLabel {
  if (runs.length === 0) {
    return 'Checks Running';
  }
  const failing = runs.some(
    (run) =>
      run.status === 'completed' &&
      run.conclusion !== null &&
      FAILING_CONCLUSIONS.has(run.conclusion),
  );
  if (failing) {
    return 'Checks Failing';
  }
  const unsettled = runs.some((run) => run.status !== 'completed' || !run.conclusion);
  if (unsettled) {
    return 'Checks Running';
  }
  return 'Checks Passing';
}

export function combineChecks(labels: readonly (CheckLabel | null)[]): CheckLabel | null {
  const present = labels.filter((label): label is CheckLabel => label !== null);
  if (present.length === 0) {
    return null;
  }
  if (present.some((label) => label === 'Checks Failing')) {
    return 'Checks Failing';
  }
  if (present.some((label) => label === 'Checks Running')) {
    return 'Checks Running';
  }
  return 'Checks Passing';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPhase(value: string): value is ProgressPhase {
  return (PROGRESS_PHASES as readonly string[]).includes(value);
}

function isStatus(value: string): value is ProgressStatus {
  return (PROGRESS_STATUSES as readonly string[]).includes(value);
}

function readDay(value: string, id: string): string {
  if (!DAY.test(value)) {
    throw new Error(`${id} has a finished date that is not YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    throw new Error(`${id} has a finished date that is not YYYY-MM-DD.`);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${id} has a finished date that is not a real day.`);
  }
  return value;
}

export function parseRoadmap(raw: unknown): RoadmapItem[] {
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new Error('The roadmap file must be an object with an items list.');
  }
  const seenIds = new Set<string>();
  const seenPrs = new Set<number>();
  const items: RoadmapItem[] = [];

  for (const entry of raw.items) {
    if (!isRecord(entry)) {
      throw new Error('A roadmap row is not an object.');
    }
    const id = entry.id;
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new Error('A roadmap row has a missing or odd id.');
    }
    if (seenIds.has(id)) {
      throw new Error(`${id} is listed more than once.`);
    }
    seenIds.add(id);

    const title = entry.title;
    const description = entry.description;
    const phase = entry.phase;
    const status = entry.status;
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 120) {
      throw new Error(`${id} needs a title.`);
    }
    if (
      typeof description !== 'string' ||
      description.trim().length === 0 ||
      description.length > 400
    ) {
      throw new Error(`${id} needs a one-line description.`);
    }
    if (typeof phase !== 'string' || !isPhase(phase)) {
      throw new Error(`${id} has a phase that is not on the list.`);
    }
    if (typeof status !== 'string' || !isStatus(status)) {
      throw new Error(`${id} has a status that is not done, in_progress, or coming.`);
    }

    let moduleId: ModuleId | undefined;
    if (entry.moduleId !== undefined) {
      if (typeof entry.moduleId !== 'string' || !isModuleId(entry.moduleId)) {
        throw new Error(`${id} names a module that is not in the blueprint.`);
      }
      if (isModuleId(id) && entry.moduleId !== id) {
        throw new Error(`${id} cannot also point at ${entry.moduleId}.`);
      }
      moduleId = entry.moduleId;
    }

    let prs: number[] | undefined;
    if (entry.prs !== undefined) {
      if (!Array.isArray(entry.prs)) {
        throw new Error(`${id} has a prs value that is not a list.`);
      }
      prs = [];
      for (const value of entry.prs) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
          throw new Error(`${id} has a pull request number that is not a positive integer.`);
        }
        if (seenPrs.has(value)) {
          throw new Error(`Pull request #${value} is linked to more than one row.`);
        }
        seenPrs.add(value);
        prs.push(value);
      }
    }

    let finishedOn: string | undefined;
    if (entry.finishedOn !== undefined) {
      if (typeof entry.finishedOn !== 'string') {
        throw new Error(`${id} has a finished date that is not YYYY-MM-DD.`);
      }
      finishedOn = readDay(entry.finishedOn, id);
    }
    if (status === 'done' && !finishedOn) {
      throw new Error(`${id} is done and needs a finished date.`);
    }

    const item: RoadmapItem = {
      id,
      title: title.trim(),
      description: description.trim(),
      phase,
      status,
    };
    if (moduleId && !isModuleId(id)) {
      item.moduleId = moduleId;
    }
    if (prs && prs.length > 0) {
      item.prs = prs;
    }
    if (finishedOn) {
      item.finishedOn = finishedOn;
    }
    items.push(item);
  }

  return items;
}

function latestInstant(values: readonly string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  return [...values].sort().at(-1) ?? null;
}

function cardFromItem(
  item: RoadmapItem,
  byNumber: ReadonlyMap<number, PullSnapshot>,
  githubLive: boolean,
): ProgressCard {
  const numbers = item.prs ?? [];
  const linked = numbers
    .map((number) => byNumber.get(number))
    .filter((pull): pull is PullSnapshot => pull !== undefined);
  const open = linked.filter((pull) => pull.state === 'open' && !pull.merged);
  const merged = linked.filter((pull) => pull.merged);

  let status = item.status;
  let finishedOn: string | null = item.status === 'done' ? (item.finishedOn ?? null) : null;
  let checks: CheckLabel | null = null;

  if (githubLive && open.length > 0) {
    status = 'in_progress';
    finishedOn = null;
    checks = combineChecks(open.map((pull) => pull.checks));
  } else if (githubLive && merged.length > 0) {
    status = 'done';
    checks = null;
    finishedOn =
      latestInstant(
        merged.map((pull) => pull.mergedAt).filter((value): value is string => value !== null),
      ) ??
      item.finishedOn ??
      null;
  }

  const card: ProgressCard = {
    id: item.id,
    title: item.title,
    description: item.description,
    phase: item.phase,
    status,
    prs: numbers.map((number) => ({
      number,
      url: byNumber.get(number)?.url ?? pullUrl(number),
    })),
    checks,
    finishedOn,
  };
  if (item.moduleId) {
    card.moduleId = item.moduleId;
  }
  return card;
}

export function mergeRoadmap(
  items: readonly RoadmapItem[],
  pulls: readonly PullSnapshot[],
  options: { github: 'live' | 'unavailable'; now: Date },
): ProgressBoard {
  const githubLive = options.github === 'live';
  const byNumber = new Map<number, PullSnapshot>();
  for (const pull of pulls) {
    byNumber.set(pull.number, pull);
  }

  const cards = items.map((item) => cardFromItem(item, byNumber, githubLive));
  const linked = new Set(items.flatMap((item) => item.prs ?? []));
  const takenIds = new Set(cards.map((card) => card.id));

  if (githubLive) {
    const extras = pulls
      .filter((pull) => pull.state === 'open' && !pull.merged && !linked.has(pull.number))
      .sort((left, right) => left.number - right.number);
    for (const pull of extras) {
      let id = `pr-${pull.number}`;
      if (takenIds.has(id)) {
        id = `github-pr-${pull.number}`;
      }
      takenIds.add(id);
      const title = pull.title.trim() || `Pull Request #${pull.number}`;
      cards.push({
        id,
        title,
        description: 'This pull request is not on the roadmap yet.',
        phase: PROGRESS_OPEN_PHASE,
        status: 'in_progress',
        prs: [{ number: pull.number, url: pull.url }],
        checks: pull.checks,
        finishedOn: null,
      });
    }
  }

  const counts = {
    done: cards.filter((card) => card.status === 'done').length,
    inProgress: cards.filter((card) => card.status === 'in_progress').length,
    coming: cards.filter((card) => card.status === 'coming').length,
  };
  const product = productScore(cards);

  return {
    updatedAt: options.now.toISOString(),
    github: options.github,
    counts,
    percent: product.percent,
    modulesDone: product.modulesDone,
    modulesTotal: product.modulesTotal,
    items: cards,
  };
}
