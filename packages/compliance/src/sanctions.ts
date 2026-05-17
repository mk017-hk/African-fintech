/**
 * Sanctions + PEP screening adapter.
 *
 * Production wiring would call a provider (ComplyAdvantage, Refinitiv,
 * Sayari, etc.) here. This module exposes an interface so the provider can
 * be swapped without touching KYC code. A built-in stub uses a tiny static
 * list so the system is usable in development.
 */

export interface ScreeningSubject {
  fullName: string;
  dateOfBirth?: string; // YYYY-MM-DD
  countryCode?: string;
}

export interface ScreeningHit {
  listName: string;
  matchedName: string;
  score: number;       // 0-100
  role?: string;       // for PEP
}

export interface ScreeningResult {
  sanctionsHits: ScreeningHit[];
  pepHits:       ScreeningHit[];
}

export interface SanctionsProvider {
  screen(subject: ScreeningSubject): Promise<ScreeningResult>;
}

// ---- Stub provider for dev / tests -----------------------------------------
// Replace by wiring the real provider in apps/api/src/container.ts.

const STUB_SDN = [
  { listName: 'OFAC_SDN_STUB', name: 'John Doe Sanctioned' },
];
const STUB_PEP = [
  { listName: 'PEP_STUB', name: 'Jane Politician', role: 'Minister of Finance (DEMO)' },
];

function fuzzyScore(a: string, b: string): number {
  const A = a.toLowerCase(), B = b.toLowerCase();
  if (A === B) return 100;
  if (A.includes(B) || B.includes(A)) return 80;
  // Token overlap.
  const ta = new Set(A.split(/\s+/));
  const tb = new Set(B.split(/\s+/));
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const denom = Math.max(ta.size, tb.size);
  return denom ? Math.round((overlap / denom) * 100) : 0;
}

export class StubSanctionsProvider implements SanctionsProvider {
  async screen(subject: ScreeningSubject): Promise<ScreeningResult> {
    const sanctionsHits: ScreeningHit[] = [];
    for (const row of STUB_SDN) {
      const s = fuzzyScore(subject.fullName, row.name);
      if (s >= 75) sanctionsHits.push({ listName: row.listName, matchedName: row.name, score: s });
    }
    const pepHits: ScreeningHit[] = [];
    for (const row of STUB_PEP) {
      const s = fuzzyScore(subject.fullName, row.name);
      if (s >= 75) pepHits.push({ listName: row.listName, matchedName: row.name, score: s, role: row.role });
    }
    return { sanctionsHits, pepHits };
  }
}
