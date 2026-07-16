/**
 * Server-side data access for the CMS delivery API.
 * Draft fetches go through /preview/content (secret-gated, returns Entry.fields);
 * published fetches use the public /content endpoints (published_fields only).
 */

// Inside docker-compose the server reaches the backend via the service name;
// override with CMS_API_URL. NEXT_PUBLIC_API_URL is what the *browser* uses (WS).
const API_URL = process.env.CMS_API_URL ?? 'http://localhost:8000';
const PREVIEW_SECRET = process.env.PREVIEW_SECRET ?? 'dev-preview-secret';

export interface FieldDef {
  id: string;
  name: string;
  type: string;
  validations?: Record<string, unknown>;
}

export interface DeliveredEntry {
  id: string;
  slug: string;
  status: string;
  version: number;
  updatedAt: string | null;
  fields: Record<string, unknown>;
  contentType: { apiId: string; name: string; fields: FieldDef[] };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CMS request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function getPublishedEntry(type: string, slug: string): Promise<DeliveredEntry | null> {
  return fetchJson<DeliveredEntry>(
    `${API_URL}/content/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`,
  );
}

export function getDraftEntry(type: string, slug: string): Promise<DeliveredEntry | null> {
  return fetchJson<DeliveredEntry>(
    `${API_URL}/preview/content/${encodeURIComponent(type)}/${encodeURIComponent(
      slug,
    )}?token=${encodeURIComponent(PREVIEW_SECRET)}`,
  );
}

export async function listPublished(type: string): Promise<DeliveredEntry[]> {
  const data = await fetchJson<{ items: DeliveredEntry[] }>(
    `${API_URL}/content/${encodeURIComponent(type)}`,
  );
  return data?.items ?? [];
}
