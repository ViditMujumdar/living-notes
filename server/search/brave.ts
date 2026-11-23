/**
 * Brave Search API adapter.
 * Docs: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 *  GET {base}/res/v1/web/search?q=...  header X-Subscription-Token
 *  response: web.results[] { title, url, description, ... }
 *
 * Queries are built ONLY from a fixed table of physics concepts, never from
 * uploaded image contents or personal data.
 */
import type { SourceResult } from '../../shared/schema';

export class SearchError extends Error {
  constructor(public kind: 'not_configured' | 'auth' | 'quota' | 'unavailable' | 'timeout' | 'bad_output', message: string) { super(message); }
}

export const CONCEPTS: Record<'circuit' | 'lens' | 'projectile', Record<string, string>> = {
  circuit: {
    default: "ohm's law series and parallel resistors equivalent resistance",
    series: 'series circuit resistors current same voltage divides',
    parallel: 'parallel resistors equivalent resistance reciprocal current divides',
    mixed: 'combination series parallel resistors equivalent resistance circuit analysis',
    power: 'electrical power dissipated in a resistor P = VI',
  },
  lens: {
    default: 'convex lens ray diagram image formation thin lens equation',
    virtual: 'convex lens virtual image object inside focal length magnifying glass',
    magnification: 'thin lens magnification formula real inverted image',
  },
  projectile: {
    default: 'projectile motion range maximum height time of flight equations',
    angle: 'projectile launch angle 45 degrees maximum range derivation',
    components: 'projectile motion horizontal and vertical velocity components',
  },
};

/** Domains and suffixes we treat as established educational / scientific sources. */
const TRUSTED_SUFFIXES = ['.edu', '.ac.uk', '.ac.in', '.edu.au', '.ac.nz', '.gov', '.gov.uk', '.gov.in', '.nic.in', '.ac.jp', '.edu.in', '.edu.sg'];
const TRUSTED_DOMAINS = ['openstax.org', 'libretexts.org', 'physicsclassroom.com', 'khanacademy.org', 'phet.colorado.edu', 'britannica.com', 'iop.org', 'aps.org', 'physics.info', 'bbc.co.uk', 'ncert.nic.in', 'nasa.gov', 'nist.gov', 'ocw.mit.edu', 'hyperphysics.phy-astr.gsu.edu', 'isaacphysics.org', 'ck12.org', 'sciencedirect.com', 'feynmanlectures.caltech.edu'];
const BLOCKED_DOMAINS = ['pinterest.', 'facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'quora.com', 'reddit.com'];

export function isTrusted(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return TRUSTED_SUFFIXES.some((s) => h.endsWith(s)) || TRUSTED_DOMAINS.some((d) => h === d || h.endsWith('.' + d));
}

const decode = (s: string) => s
  .replace(/<[^>]*>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

export class BraveSearch {
  constructor(private o: { apiKey: string; baseUrl: string; timeoutMs: number }) {}
  get configured() { return Boolean(this.o.apiKey); }

  private async raw(q: string, count: number): Promise<any> {
    if (!this.configured) throw new SearchError('not_configured', 'Search API key is not set.');
    const url = `${this.o.baseUrl}/res/v1/web/search?${new URLSearchParams({ q, count: String(count), safesearch: 'strict', search_lang: 'en' })}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': this.o.apiKey }, signal: AbortSignal.timeout(this.o.timeoutMs) });
    } catch (e) {
      const n = (e as Error)?.name;
      throw new SearchError(n === 'TimeoutError' || n === 'AbortError' ? 'timeout' : 'unavailable', 'Could not reach the search service.');
    }
    if (res.status === 401 || res.status === 403) throw new SearchError('auth', 'The search service rejected the API key.');
    if (res.status === 429) throw new SearchError('quota', 'The search rate limit or quota was reached.');
    if (!res.ok) throw new SearchError('unavailable', `The search service returned an error (${res.status}).`);
    try { return await res.json(); } catch { throw new SearchError('bad_output', 'The search service returned an unreadable response.'); }
  }

  async search(type: 'circuit' | 'lens' | 'projectile', concept?: string): Promise<{ query: string; results: SourceResult[] }> {
    const table = CONCEPTS[type];
    const query = `${table[concept && table[concept] ? concept : 'default']} physics`;
    const data = await this.raw(query, 20);
    const retrievedAt = new Date().toISOString();
    const rows: SourceResult[] = [];
    for (const r of data?.web?.results ?? []) {
      if (typeof r?.url !== 'string' || typeof r?.title !== 'string') continue;
      let u: URL;
      try { u = new URL(r.url); } catch { continue; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      const host = u.hostname.toLowerCase();
      if (BLOCKED_DOMAINS.some((b) => host.includes(b))) continue;
      rows.push({
        title: decode(r.title).slice(0, 200),
        url: u.toString(),
        domain: host.replace(/^www\./, ''),
        excerpt: decode(typeof r.description === 'string' ? r.description : '').slice(0, 400),
        trusted: isTrusted(host),
        retrievedAt,
      });
    }
    // Prefer trusted educational sources, keep search order otherwise; at most 2 per domain.
    const perDomain = new Map<string, number>();
    const ranked = [...rows.filter((r) => r.trusted), ...rows.filter((r) => !r.trusted)].filter((r) => {
      const n = perDomain.get(r.domain) ?? 0; perDomain.set(r.domain, n + 1); return n < 2;
    });
    return { query, results: ranked.slice(0, 6) };
  }

  async probe(): Promise<void> {
    await this.raw("ohm's law physics", 1);
  }
}
