/**
 * @ondros/sdk — typed client for the CMS delivery & preview APIs.
 *
 * Zero dependencies; works in Node 18+, browsers, Next.js (server & client
 * components), and edge runtimes — anywhere `fetch` exists.
 *
 * ```ts
 * import { createClient } from '@ondros/sdk';
 *
 * const client = createClient({
 *   spaceId: 'abc123',
 *   environmentId: 'master',
 *   accessToken: process.env.CMS_DELIVERY_TOKEN!,  // delivery or preview token
 *   host: 'http://localhost:8000',                 // delivery host
 *   previewHost: 'http://localhost:8000',          // used automatically for cms_pre_* tokens
 * });
 *
 * const entries = await client.getEntries({
 *   contentType: 'blogPost',
 *   locale: 'hi-IN',
 *   'fields.category': 'tech',
 *   limit: 20,
 * });
 *
 * const entry = await client.getEntry({ id: 'entry123', include: 2, locale: 'en-US' });
 * const asset = await client.getAsset({ id: 'asset456' });
 * ```
 *
 * Built-ins: retry with exponential backoff + jitter (429/5xx/network),
 * stale-while-revalidate response cache, server-side link resolution up to
 * `include` depth with `resolve()` / `resolveLinks()` helpers (Contentful-style).
 */

export interface CmsClientConfig {
  spaceId: string;
  /** Environment key or id; defaults to "master". (`environment` is an alias.) */
  environmentId?: string;
  environment?: string;
  /** Delivery token (published content) or preview token (drafts too). */
  accessToken: string;
  /** Delivery host, e.g. https://cdn.yourcms.com */
  host: string;
  /** Optional preview host — selected automatically when accessToken is a cms_pre_* token. */
  previewHost?: string;
  /** Custom fetch (e.g. Next.js fetch with revalidate options). */
  fetch?: typeof fetch;
  /** Retry attempts for 429/5xx/network errors (default 3, exponential backoff + jitter). */
  retries?: number;
  /** Response cache: stale-while-revalidate. `false` disables (default TTL 30s). */
  cache?: { ttlMs?: number } | false;
}

export interface CmsContentTypeInfo {
  apiId: string;
  name: string;
  displayField: string;
  fields?: CmsFieldDef[];
}

export interface CmsFieldDef {
  id: string;
  name: string;
  type: string;
  localized?: boolean;
  allowed_content_types?: string[];
  validations?: Record<string, unknown>;
}

export interface CmsEntry {
  id: string;
  slug: string;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  /** Present on preview responses only. */
  status?: string;
  contentType: CmsContentTypeInfo;
  fields: Record<string, unknown>;
}

export interface CmsAsset {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  title: string;
  altText: string;
  description: string;
}

export interface CmsIncludes {
  Entry: CmsEntry[];
  Asset: CmsAsset[];
}

export interface EntriesQuery {
  contentType?: string;
  slug?: string;
  /** Full-text search over slug + field values. */
  q?: string;
  /** Locale code (e.g. "hi-IN") or "*" for raw locale maps. Fallback chain applies server-side. */
  locale?: string;
  /** Link resolution depth 0-3 (default 1). */
  include?: number;
  order?: string;
  limit?: number;
  skip?: number;
  /** Field filters: { 'fields.category': 'tech' } — exact match; localized values match any locale. */
  [field: `fields.${string}`]: string | number | boolean | undefined;
}

export interface EntriesResponse {
  items: CmsEntry[];
  total: number;
  skip: number;
  limit: number;
  includes: CmsIncludes;
  resolve<T extends CmsEntry | CmsAsset = CmsEntry>(id: unknown): T | undefined;
}

export interface EntryResponse {
  entry: CmsEntry | null;
  includes: CmsIncludes;
  resolve<T extends CmsEntry | CmsAsset = CmsEntry>(id: unknown): T | undefined;
}

export class CmsApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.name = 'CmsApiError';
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeResolver(includes: CmsIncludes) {
  const map = new Map<string, CmsEntry | CmsAsset>();
  for (const e of includes.Entry ?? []) map.set(e.id, e);
  for (const a of includes.Asset ?? []) map.set(a.id, a);
  return function resolve<T extends CmsEntry | CmsAsset = CmsEntry>(id: unknown): T | undefined {
    return typeof id === 'string' ? (map.get(id) as T | undefined) : undefined;
  };
}

/**
 * Deep link resolution (Contentful-style): returns a copy of `entry` whose
 * reference/media field values are replaced by the linked objects from
 * `includes` (unresolvable ids stay as strings). Cycle-safe.
 */
export function resolveLinks(entry: CmsEntry, includes: CmsIncludes, maxDepth = 3): CmsEntry {
  const resolve = makeResolver(includes);

  function inline(value: unknown, depth: number, seen: Set<string>): unknown {
    if (depth > maxDepth) return value;
    if (typeof value === 'string') {
      const hit = resolve(value);
      if (!hit) return value;
      if ('fields' in hit) {
        if (seen.has(hit.id)) return value;
        return inlineEntry(hit as CmsEntry, depth + 1, new Set([...seen, hit.id]));
      }
      return hit;
    }
    if (Array.isArray(value)) return value.map((v) => inline(v, depth, seen));
    return value;
  }

  function inlineEntry(e: CmsEntry, depth: number, seen: Set<string>): CmsEntry {
    const linkFieldIds = new Set(
      (e.contentType.fields ?? [])
        .filter((f) => ['reference', 'reference_many', 'media', 'media_many'].includes(f.type))
        .map((f) => f.id),
    );
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(e.fields ?? {})) {
      fields[key] = linkFieldIds.has(key) ? inline(value, depth, seen) : value;
    }
    return { ...e, fields };
  }

  return inlineEntry(entry, 0, new Set([entry.id]));
}

interface CacheRecord {
  time: number;
  data: unknown;
  refreshing?: boolean;
}

export function createClient(config: CmsClientConfig) {
  const environment = config.environmentId ?? config.environment ?? 'master';
  const doFetch = config.fetch ?? fetch;
  const retries = config.retries ?? 3;
  const cacheTtl = config.cache === false ? 0 : (config.cache?.ttlMs ?? 30_000);
  const cacheStore = new Map<string, CacheRecord>();

  const isPreviewToken = config.accessToken.startsWith('cms_pre_');
  const host = (isPreviewToken && config.previewHost ? config.previewHost : config.host).replace(/\/$/, '');
  const root = `${host}/spaces/${config.spaceId}/environments/${environment}/delivery`;

  async function rawRequest<T>(url: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(url, {
          headers: { Authorization: `Bearer ${config.accessToken}` },
        });
        if (res.ok) return (await res.json()) as T;
        let detail: unknown = res.statusText;
        try {
          detail = ((await res.json()) as { detail?: unknown }).detail ?? detail;
        } catch {
          /* non-JSON body */
        }
        const error = new CmsApiError(res.status, detail);
        if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) throw error;
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        lastError = error;
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 30_000) : 2 ** attempt * 250 + Math.random() * 250);
      } catch (err) {
        if (err instanceof CmsApiError) throw err;
        // Network failure — retry with backoff.
        lastError = err;
        if (attempt === retries) throw err;
        await sleep(2 ** attempt * 250 + Math.random() * 250);
      }
    }
    throw lastError as Error;
  }

  /** Stale-while-revalidate: fresh -> return; stale -> return + refresh in background. */
  async function request<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = new URL(`${root}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const cacheKey = url.toString();
    if (cacheTtl > 0) {
      const hit = cacheStore.get(cacheKey);
      if (hit) {
        const age = Date.now() - hit.time;
        if (age < cacheTtl) return hit.data as T;
        if (age < cacheTtl * 4 && !hit.refreshing) {
          hit.refreshing = true; // serve stale, refresh in background
          void rawRequest<T>(cacheKey)
            .then((data) => cacheStore.set(cacheKey, { time: Date.now(), data }))
            .catch(() => cacheStore.delete(cacheKey));
          return hit.data as T;
        }
      }
    }
    const data = await rawRequest<T>(cacheKey);
    if (cacheTtl > 0) cacheStore.set(cacheKey, { time: Date.now(), data });
    return data;
  }

  return {
    /** List entries with filters (`fields.*`), search, locale + link resolution. */
    async getEntries(query: EntriesQuery = {}): Promise<EntriesResponse> {
      const { contentType, ...rest } = query;
      const data = await request<Omit<EntriesResponse, 'resolve'>>('/entries', {
        content_type: contentType,
        ...rest,
      });
      return { ...data, resolve: makeResolver(data.includes) };
    },

    /** Fetch one entry by id. `entry` is null (not a throw) on 404. */
    async getEntry(params: { id: string; locale?: string; include?: number }): Promise<EntryResponse> {
      try {
        const data = await request<CmsEntry & { includes: CmsIncludes }>(
          `/entries/${params.id}`,
          { locale: params.locale, include: params.include },
        );
        const { includes, ...entry } = data;
        return { entry, includes, resolve: makeResolver(includes) };
      } catch (err) {
        if (err instanceof CmsApiError && err.status === 404) {
          const includes = { Entry: [], Asset: [] };
          return { entry: null, includes, resolve: makeResolver(includes) };
        }
        throw err;
      }
    },

    /** Convenience: first entry matching contentType + slug. */
    async getEntryBySlug(params: {
      contentType: string;
      slug: string;
      locale?: string;
      include?: number;
    }): Promise<EntryResponse> {
      const list = await this.getEntries({
        contentType: params.contentType,
        slug: params.slug,
        locale: params.locale,
        include: params.include,
        limit: 1,
      });
      return { entry: list.items[0] ?? null, includes: list.includes, resolve: list.resolve };
    },

    async getAssets(query: { q?: string; limit?: number; skip?: number } = {}) {
      return request<{ items: CmsAsset[]; total: number; skip: number; limit: number }>(
        '/assets',
        query as Record<string, unknown>,
      );
    },

    async getAsset(params: { id: string }): Promise<CmsAsset> {
      return request<CmsAsset>(`/assets/${params.id}`);
    },

    resolveLinks,
  };
}

export type CmsClient = ReturnType<typeof createClient>;
