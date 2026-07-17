/**
 * Server-side data access for the CMS delivery/preview API.
 *
 * Published fetches use the DELIVERY token; draft-mode fetches use the
 * PREVIEW token. The space id is resolved dynamically from the token via
 * /token-info (so no UUIDs live in env files); environment + locale come
 * from the preview cookie (set by /api/preview) or defaults.
 */

// Inside docker-compose the server reaches the backend via the service name;
// override with CMS_API_URL. NEXT_PUBLIC_API_URL is what the *browser* uses (WS + media).
const API_URL = process.env.CMS_API_URL ?? 'http://localhost:8000';
const PREVIEW_TOKEN = process.env.CMS_PREVIEW_TOKEN ?? 'cms_pre_dev-preview-token-0000';
const DELIVERY_TOKEN = process.env.CMS_DELIVERY_TOKEN ?? 'cms_del_dev-delivery-token-0000';

export interface FieldDef {
  id: string;
  name: string;
  type: string;
  localized?: boolean;
  validations?: Record<string, unknown>;
}

export interface DeliveredEntry {
  id: string;
  slug: string;
  status?: string;
  version: number;
  updatedAt: string | null;
  fields: Record<string, unknown>;
  contentType: { apiId: string; name: string; displayField?: string; fields?: FieldDef[] };
}

export interface DeliveredAsset {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  title: string;
  altText: string;
}

export interface Includes {
  Entry: DeliveredEntry[];
  Asset: DeliveredAsset[];
}

export interface EntryResult {
  entry: DeliveredEntry;
  includes: Includes;
}

interface TokenInfo {
  spaceId: string;
  defaultEnvironment: string | null;
  defaultLocale: string;
}

const tokenInfoCache = new Map<string, TokenInfo>();

async function resolveToken(token: string): Promise<TokenInfo> {
  const cached = tokenInfoCache.get(token);
  if (cached) return cached;
  const res = await fetch(`${API_URL}/token-info?access_token=${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`CMS token resolution failed: ${res.status} ${await res.text()}`);
  const info = (await res.json()) as TokenInfo;
  tokenInfoCache.set(token, info);
  return info;
}

async function fetchJson<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CMS request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export interface FetchOptions {
  draft?: boolean;
  environment?: string | null;
  locale?: string | null;
}

async function deliveryRoot(opts: FetchOptions): Promise<{ base: string; token: string }> {
  const token = opts.draft ? PREVIEW_TOKEN : DELIVERY_TOKEN;
  const info = await resolveToken(token);
  const env = opts.environment || info.defaultEnvironment || 'master';
  return {
    base: `${API_URL}/spaces/${info.spaceId}/environments/${encodeURIComponent(env)}/delivery`,
    token,
  };
}

export async function getEntry(
  type: string,
  slug: string,
  opts: FetchOptions = {},
): Promise<EntryResult | null> {
  const { base, token } = await deliveryRoot(opts);
  const qs = new URLSearchParams({ content_type: type, slug, include: '2', limit: '1' });
  if (opts.locale) qs.set('locale', opts.locale);
  const data = await fetchJson<{ items: DeliveredEntry[]; includes: Includes }>(
    `${base}/entries?${qs}`,
    token,
  );
  if (!data || data.items.length === 0) return null;
  return { entry: data.items[0], includes: data.includes ?? { Entry: [], Asset: [] } };
}

export async function listEntries(
  type: string,
  opts: FetchOptions = {},
): Promise<DeliveredEntry[]> {
  const { base, token } = await deliveryRoot(opts);
  const qs = new URLSearchParams({ content_type: type, include: '0', limit: '50' });
  if (opts.locale) qs.set('locale', opts.locale);
  const data = await fetchJson<{ items: DeliveredEntry[] }>(`${base}/entries?${qs}`, token);
  return data?.items ?? [];
}

/** Map linked entry/asset ids -> serialized objects (from `includes`). */
export function buildIncludeMaps(includes: Includes): {
  entries: Map<string, DeliveredEntry>;
  assets: Map<string, DeliveredAsset>;
} {
  return {
    entries: new Map((includes.Entry ?? []).map((e) => [e.id, e])),
    assets: new Map((includes.Asset ?? []).map((a) => [a.id, a])),
  };
}
