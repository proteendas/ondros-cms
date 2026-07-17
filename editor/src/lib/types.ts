/**
 * Frontend mirrors of the backend Pydantic schemas (app/schemas/*.py).
 * Keep in sync manually, or generate from the OpenAPI spec:
 *   npx openapi-typescript http://localhost:8000/openapi.json -o src/lib/api-types.ts
 */

export type FieldType =
  | 'text'
  | 'longtext'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'date' // legacy alias of datetime
  | 'select'
  | 'media'
  | 'media_many'
  | 'reference'
  | 'reference_many'
  | 'json'
  | 'slug';

export const FIELD_TYPE_INFO: Record<FieldType, { label: string; icon: string; hint: string }> = {
  text: { label: 'Short text', icon: 'Aa', hint: 'Titles, names, labels' },
  longtext: { label: 'Long text', icon: '¶', hint: 'Multi-line plain text' },
  richtext: { label: 'Rich text', icon: '≣', hint: 'Formatted HTML content' },
  number: { label: 'Number', icon: '#', hint: 'Integer or decimal' },
  boolean: { label: 'Boolean', icon: '◐', hint: 'True / false toggle' },
  datetime: { label: 'Date & time', icon: '📅', hint: 'ISO date/time' },
  date: { label: 'Date (legacy)', icon: '📅', hint: 'Use Date & time instead' },
  select: { label: 'Enum (select)', icon: '☰', hint: 'One of a fixed list' },
  media: { label: 'Media', icon: '🖼', hint: 'One asset from the library' },
  media_many: { label: 'Media (many)', icon: '🖼+', hint: 'Ordered list of assets' },
  reference: { label: 'Reference', icon: '🔗', hint: 'Link to one entry' },
  reference_many: { label: 'References (many)', icon: '🔗+', hint: 'Ordered links — assemblies' },
  json: { label: 'JSON', icon: '{}', hint: 'Arbitrary JSON object' },
  slug: { label: 'Slug', icon: '/', hint: 'URL-safe identifier' },
};

export interface FieldValidations {
  required?: boolean;
  min_length?: number | null;
  max_length?: number | null;
  pattern?: string | null;
  min?: number | null;
  max?: number | null;
  allowed_values?: string[] | null;
  min_items?: number | null;
  max_items?: number | null;
}

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  localized?: boolean;
  validations: FieldValidations;
  allowed_content_types?: string[];
  help_text?: string;
  ai_hint?: string;
}

export interface ContentType {
  id: string;
  tenant_id: string;
  space_id: string;
  environment_id: string;
  name: string;
  api_id: string;
  description: string;
  display_field: string;
  fields: FieldDef[];
  created_at: string;
  updated_at: string;
  entry_count?: number | null;
}

export type EntryStatus = 'draft' | 'in_review' | 'published' | 'archived';

export interface Entry {
  id: string;
  tenant_id: string;
  space_id: string;
  environment_id: string;
  content_type_id: string;
  slug: string;
  status: EntryStatus;
  fields: Record<string, unknown>;
  published_fields: Record<string, unknown> | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface EntryList {
  items: Entry[];
  total: number;
  skip: number;
  limit: number;
}

export interface LocaleDef {
  code: string;
  name: string;
}

export interface Environment {
  id: string;
  space_id: string;
  key: string;
  name: string;
  type: 'master' | 'staging' | 'dev' | string;
  is_default: boolean;
  created_at: string;
}

export interface Space {
  id: string;
  name: string;
  slug: string;
  locales: LocaleDef[];
  default_locale: string;
  environments: Environment[];
}

export interface AccountInfo {
  id: string;
  name: string;
  slug: string;
  is_owner: boolean;
  is_active: boolean;
}

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  tenant_id: string; // active account id
  roles: { role_name: string; space_id: string | null }[];
  capabilities: string[];
  accounts: AccountInfo[];
}

export interface LocaleRow {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  position: number;
  fallback_code: string | null;
  created_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  status: string;
  role_name: string | null;
  space_id: string | null;
  expires_at: string;
  created_at: string;
  dev_token?: string | null;
}

export interface SSOConfigInfo {
  id: string;
  provider_type: 'oidc' | 'saml' | string;
  name: string;
  discovery_url: string;
  client_id: string;
  has_client_secret: boolean;
  email_domain: string;
  default_role_name: string;
  enforced: boolean;
  enabled: boolean;
  created_at: string;
}

export interface PlanInfo {
  key: string;
  name: string;
  price_month_usd: number;
  limits: Record<string, number>;
}

export interface SubscriptionInfo {
  plan: PlanInfo;
  status: string;
  current_period_end: string | null;
  usage: Record<string, number>;
  dev_mode: boolean;
}

export interface AuditLogRow {
  id: string;
  space_id: string | null;
  actor_id: string | null;
  actor_label: string;
  action: string;
  resource_type: string;
  resource_id: string;
  diff: Record<string, unknown>;
  created_at: string;
}

export interface EntryVersionMeta {
  version: number;
  slug: string;
  status: string;
  created_by: string | null;
  created_at: string;
}

export interface EntryVersionFull extends EntryVersionMeta {
  fields: Record<string, unknown>;
}

export interface ApiKey {
  id: string;
  space_id: string;
  name: string;
  description: string;
  type: 'delivery' | 'preview' | 'management';
  token_prefix: string;
  environment_ids: string[];
  read_only: boolean;
  enabled: boolean;
  last_used_at: string | null;
  created_at: string;
  access_token?: string; // present only in the create/regenerate response
}

export interface WebhookFilters {
  content_types: string[];
  environments: string[];
}

export interface Webhook {
  id: string;
  space_id: string;
  name: string;
  url: string;
  enabled: boolean;
  events: string[];
  filters: WebhookFilters;
  headers: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  response_status: number | null;
  response_body: string;
  success: boolean;
  duration_ms: number;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  is_system: boolean;
}

export interface RoleAssignment {
  id: string;
  user_id: string;
  role_id: string;
  space_id: string | null;
  role: Role;
}

export interface UserSummary {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  assignments: RoleAssignment[];
}

export interface MediaAsset {
  id: string;
  space_id: string | null;
  environment_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  width: number | null;
  height: number | null;
  title: string;
  description: string;
  alt_text: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface MediaList {
  items: MediaAsset[];
  total: number;
  skip: number;
  limit: number;
}

export interface ComplianceIssue {
  field_id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  guideline_excerpt: string;
  suggestion: string;
}

export interface ComplianceResult {
  passed: boolean;
  issues: ComplianceIssue[];
  guidelines_used: string[];
}

export interface AiStatus {
  configured: boolean;
  provider: string;
  chat_model: string;
  embeddings_enabled: boolean;
  retrieval_mode: 'vector' | 'keyword' | 'disabled' | string;
}

export interface Guideline {
  id: string;
  title: string;
  status: string;
  content_types: string[];
  chunk_count: number;
  created_at: string;
}

/** Value helpers for localized fields ({localeCode: value} maps). */
export function localizedValue(
  field: FieldDef,
  raw: unknown,
  locale: string,
): unknown {
  if (!field.localized) return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return (raw as Record<string, unknown>)[locale];
  }
  return undefined;
}

export function withLocalizedValue(
  field: FieldDef,
  raw: unknown,
  locale: string,
  value: unknown,
): unknown {
  if (!field.localized) return value;
  const map =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  map[locale] = value;
  return map;
}
