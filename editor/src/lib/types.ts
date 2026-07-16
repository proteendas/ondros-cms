/**
 * Frontend mirrors of the backend Pydantic schemas (app/schemas/content.py).
 * Keep in sync manually, or generate from the OpenAPI spec:
 *   npx openapi-typescript http://localhost:8000/openapi.json -o src/lib/api-types.ts
 */

export type FieldType =
  | 'text'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'media'
  | 'reference'
  | 'slug'
  | 'select';

export interface FieldValidations {
  required?: boolean;
  min_length?: number | null;
  max_length?: number | null;
  pattern?: string | null;
  min?: number | null;
  max?: number | null;
  allowed_values?: string[] | null;
}

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  validations: FieldValidations;
  help_text: string;
  ai_hint: string;
}

export interface ContentType {
  id: string;
  tenant_id: string;
  space_id: string;
  name: string;
  api_id: string;
  description: string;
  fields: FieldDef[];
  created_at: string;
  updated_at: string;
}

export type EntryStatus = 'draft' | 'in_review' | 'published' | 'archived';

export interface Entry {
  id: string;
  tenant_id: string;
  space_id: string;
  content_type_id: string;
  slug: string;
  status: EntryStatus;
  fields: Record<string, unknown>;
  published_fields: Record<string, unknown> | null;
  version: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface Space {
  id: string;
  name: string;
  slug: string;
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

export interface Guideline {
  id: string;
  title: string;
  status: string;
  content_types: string[];
  chunk_count: number;
  created_at: string;
}
