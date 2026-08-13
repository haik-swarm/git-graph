/** Assigning each commit a lane so the graph can be drawn as columns. */

export interface Commit {
  sha: string;
  short: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: string[];
}

export interface PlacedCommit extends Commit {
  lane: number;
  row: number;
}

export interface GraphEdge {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
}

export interface Layout {
  nodes: PlacedCommit[];
  edges: GraphEdge[];
  laneCount: number;
}

/**
 * Walks commits newest-first, tracking which lane each pending sha is
 * expected in. A commit inherits the leftmost lane that was reserved for
 * it; its first parent keeps that lane so a linear history stays in one
 * column, while additional parents (a merge) branch into their own.
 *
 * This is the standard "lane reservation" approach rather than anything
 * clever: the input is already topologically ordered by `git log
 * --date-order`, so a single pass is enough.
 */
export function layoutCommits(commits: Commit[]): Layout {
  const nodes: PlacedCommit[] = [];
  const edges: GraphEdge[] = [];
  // Lane index -> sha that lane is currently waiting to draw.
  const lanes: (string | null)[] = [];
  const rowOf = new Map<string, number>();
  const laneOf = new Map<string, number>();

  const claimLane = (sha: string): number => {
    const existing = lanes.indexOf(sha);
    if (existing !== -1) return existing;
    const free = lanes.indexOf(null);
    if (free !== -1) {
      lanes[free] = sha;
      return free;
    }
    lanes.push(sha);
    return lanes.length - 1;
  };

  commits.forEach((commit, row) => {
    const lane = claimLane(commit.sha);
    rowOf.set(commit.sha, row);
    laneOf.set(commit.sha, lane);
    nodes.push({ ...commit, lane, row });

    // The lane is free again unless a parent takes it over below.
    lanes[lane] = null;

    commit.parents.forEach((parent, index) => {
      if (index === 0) {
        // First parent continues this line of development in place.
        if (lanes.indexOf(parent) === -1) lanes[lane] = parent;
      } else {
        claimLane(parent);
      }
    });
  });

  // Edges are resolved after placement because a parent always appears
  // later in the list than its child, so its row isn't known during the
  // first pass.
  nodes.forEach(node => {
    node.parents.forEach(parent => {
      const parentRow = rowOf.get(parent);
      const parentLane = laneOf.get(parent);
      if (parentRow === undefined || parentLane === undefined) return;
      edges.push({
        fromRow: node.row,
        fromLane: node.lane,
        toRow: parentRow,
        toLane: parentLane,
      });
    });
  });

  const laneCount = nodes.reduce((max, n) => Math.max(max, n.lane + 1), 1);
  return { nodes, edges, laneCount };
}

/** Eight hues cycled by lane, so adjacent branches stay distinguishable. */
export const LANE_COLORS = [
  '#007AFF',
  '#AF52DE',
  '#FF9500',
  '#34C759',
  '#FF2D55',
  '#5AC8FA',
  '#FFCC00',
  '#FF3B30',
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

/** "3 minutes ago" / "5 days ago", falling back to the date for old commits. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The exact timestamp, for the tooltip behind every relative time. */
export function absoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Commits bucketed into `buckets` equal spans between the oldest and newest
 * commit, oldest bucket first. Drives the hero sparkline — the shape of how
 * active a repo has been, which a raw commit count can't show.
 */
export function commitHistogram(dates: string[], buckets = 24): number[] {
  const times = dates
    .map(d => new Date(d).getTime())
    .filter(t => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (times.length === 0) return [];
  const first = times[0];
  const last = times[times.length - 1];
  const span = last - first;
  const out = new Array(buckets).fill(0);
  if (span <= 0) {
    out[buckets - 1] = times.length;
    return out;
  }
  for (const t of times) {
    const i = Math.min(buckets - 1, Math.floor(((t - first) / span) * buckets));
    out[i] += 1;
  }
  return out;
}
