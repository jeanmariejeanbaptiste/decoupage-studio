import type { TrackRange } from './types';

export type ParsedTc = { kind: 'sec'; sec: number } | { kind: 'all' } | null;

/** Affichage `m:ss`, ou `h:mm:ss` au-delà de 59:59 (§6.1). */
export function formatTc(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Saisie tolérante : `30` → 0:30 ; `130` → 1:30 ; `1:30` ; `90s` ; `1m30` ; `1h2m` ; `tout` → TOUT.
 */
export function parseTc(input: string): ParsedTc {
  const raw = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!raw) return null;
  if (raw === 'tout' || raw === 'all') return { kind: 'all' };
  let m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(raw);
  if (m) {
    const [a, b, c] = [Number(m[1]), Number(m[2]), m[3] !== undefined ? Number(m[3]) : undefined];
    if (c !== undefined) return b < 60 && c < 60 ? { kind: 'sec', sec: a * 3600 + b * 60 + c } : null;
    return b < 60 ? { kind: 'sec', sec: a * 60 + b } : null;
  }
  m = /^(?:(\d+)h)?(?:(\d+)(?:m|min|'))?(?:(\d+)(?:s|"|sec)?)?$/.exec(raw);
  if (m && (m[1] || m[2]) && /[hm']/.test(raw)) {
    const sec = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    return { kind: 'sec', sec };
  }
  m = /^(\d+)(?:s|sec)$/.exec(raw);
  if (m) return { kind: 'sec', sec: Number(m[1]) };
  m = /^(\d+)$/.exec(raw);
  if (m) {
    const digits = m[1];
    if (digits.length <= 2) return { kind: 'sec', sec: Number(digits) };
    const s = Number(digits.slice(-2));
    const min = Number(digits.slice(0, -2));
    return s < 60 ? { kind: 'sec', sec: min * 60 + s } : null;
  }
  return null;
}

/** Saisie d'une plage : « 0:20 - 0:36 », « tout », « 1:34 ». */
export function parseRange(input: string): TrackRange | null {
  const raw = input.trim();
  if (!raw) return {};
  const single = parseTc(raw);
  if (single?.kind === 'all') return { all: true };
  const parts = raw.split(/\s*(?:-|–|—|→|>|à)\s*/).filter(Boolean);
  if (parts.length === 2) {
    const a = parseTc(parts[0]);
    const b = parseTc(parts[1]);
    if (a?.kind === 'sec' && b?.kind === 'sec') return { in: Math.min(a.sec, b.sec), out: Math.max(a.sec, b.sec) };
    return null;
  }
  if (single?.kind === 'sec') return { in: single.sec };
  return null;
}

export function formatRange(r: TrackRange | undefined): string {
  if (!r) return '';
  if (r.all) return 'TOUT';
  if (r.in !== undefined && r.out !== undefined) return `${formatTc(r.in)} - ${formatTc(r.out)}`;
  if (r.in !== undefined) return formatTc(r.in);
  return '';
}

/** Longueur cumulée d'une union d'intervalles [in, out]. */
export function unionLength(ranges: ReadonlyArray<readonly [number, number]>): number {
  const sorted = ranges.filter(([a, b]) => b > a).map(([a, b]) => [a, b] as [number, number]).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const r of sorted) {
    if (!cur || r[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [r[0], r[1]];
    } else cur[1] = Math.max(cur[1], r[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}
