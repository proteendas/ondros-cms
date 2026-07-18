#!/usr/bin/env node
/**
 * ondros-cli — zero-dependency CLI for the CMS management API.
 *
 *   ondros-cli login --host http://localhost:8000 --email you@x.com --password ...
 *   ondros-cli spaces
 *   ondros-cli types export --space <spaceId> --env master -o types.json
 *   ondros-cli types import --space <spaceId> --env master -i types.json
 *   ondros-cli generate-types --space <spaceId> --env master -o cms-types.d.ts
 *
 * Credentials live in ~/.ondrosrc.json (host + access/refresh tokens); the
 * CLI auto-refreshes expired access tokens.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RC_PATH = join(homedir(), '.ondrosrc.json');

function loadRc() {
  return existsSync(RC_PATH) ? JSON.parse(readFileSync(RC_PATH, 'utf8')) : {};
}
function saveRc(rc) {
  writeFileSync(RC_PATH, JSON.stringify(rc, null, 2), { mode: 0o600 });
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags[arg.slice(1)] = argv[++i];
    } else positional.push(arg);
  }
  return { positional, flags };
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function api(rc, path, options = {}, retryOn401 = true) {
  const res = await fetch(`${rc.host}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${rc.access_token}`,
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401 && retryOn401 && rc.refresh_token) {
    const refreshed = await fetch(`${rc.host}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rc.refresh_token }),
    });
    if (!refreshed.ok) fail('Session expired — run `ondros-cli login` again.');
    const pair = await refreshed.json();
    rc.access_token = pair.access_token;
    rc.refresh_token = pair.refresh_token;
    saveRc(rc);
    return api(rc, path, options, false);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = JSON.stringify((await res.json()).detail);
    } catch { /* ignore */ }
    fail(`${options.method ?? 'GET'} ${path} -> ${res.status}: ${detail}`);
  }
  return res.status === 204 ? null : res.json();
}

// --- commands ------------------------------------------------------------------

async function cmdLogin(flags) {
  const host = (flags.host ?? 'http://localhost:8000').replace(/\/$/, '');
  const email = flags.email ?? fail('--email is required');
  const password = flags.password ?? fail('--password is required');
  const res = await fetch(`${host}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) fail(`Login failed (${res.status}): ${await res.text()}`);
  const pair = await res.json();
  saveRc({ host, email, access_token: pair.access_token, refresh_token: pair.refresh_token });
  console.log(`✓ Logged in to ${host} as ${email} (account ${pair.account_id})`);
}

async function cmdSpaces(rc) {
  const spaces = await api(rc, '/spaces');
  for (const s of spaces) {
    const envs = (s.environments ?? []).map((e) => e.key).join(', ');
    console.log(`${s.id}  ${s.name} (${s.slug})  envs: [${envs}]  locales: [${s.locales.map((l) => l.code).join(', ')}]`);
  }
}

async function cmdTypesExport(rc, flags) {
  const { space, env = 'master' } = flags;
  if (!space) fail('--space <spaceId> is required');
  const types = await api(rc, `/spaces/${space}/environments/${env}/content-types`);
  const exported = types.map(({ name, api_id, description, display_field, fields }) => ({
    name, api_id, description, display_field, fields,
  }));
  const out = JSON.stringify(exported, null, 2);
  if (flags.o) {
    writeFileSync(flags.o, out);
    console.log(`✓ Exported ${exported.length} content types -> ${flags.o}`);
  } else console.log(out);
}

async function cmdTypesImport(rc, flags) {
  const { space, env = 'master' } = flags;
  if (!space) fail('--space <spaceId> is required');
  if (!flags.i) fail('-i <file.json> is required');
  const incoming = JSON.parse(readFileSync(flags.i, 'utf8'));
  const existing = await api(rc, `/spaces/${space}/environments/${env}/content-types`);
  const byApiId = new Map(existing.map((t) => [t.api_id, t]));

  for (const type of incoming) {
    const current = byApiId.get(type.api_id);
    if (current) {
      await api(rc, `/content-types/${current.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: type.name, description: type.description,
          display_field: type.display_field, fields: type.fields,
        }),
      });
      console.log(`~ updated ${type.api_id}`);
    } else {
      await api(rc, `/spaces/${space}/environments/${env}/content-types`, {
        method: 'POST',
        body: JSON.stringify(type),
      });
      console.log(`+ created ${type.api_id}`);
    }
  }
  console.log(`✓ Imported ${incoming.length} content types`);
}

const TS_TYPES = {
  text: 'string', longtext: 'string', richtext: 'string', slug: 'string',
  number: 'number', boolean: 'boolean', datetime: 'string', date: 'string',
  media: 'string', media_many: 'string[]', reference: 'string',
  reference_many: 'string[]', json: 'unknown',
};

function pascal(id) {
  return id.replace(/(^|_)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
}

async function cmdGenerateTypes(rc, flags) {
  const { space, env = 'master' } = flags;
  if (!space) fail('--space <spaceId> is required');
  const types = await api(rc, `/spaces/${space}/environments/${env}/content-types`);

  let out = `/* Generated by ondros-cli from space ${space} (${env}) — do not edit.\n`;
  out += ` * Field values are the LOCALE-RESOLVED shapes the delivery API returns\n`;
  out += ` * (pass ?locale=...; localized maps only appear with locale="*").\n */\n\n`;
  out += `export interface CmsSys {\n  id: string;\n  slug: string;\n  version: number;\n  createdAt: string | null;\n  updatedAt: string | null;\n  publishedAt: string | null;\n}\n\n`;

  const names = [];
  for (const t of types) {
    const name = `${pascal(t.api_id)}Fields`;
    names.push([t.api_id, name]);
    out += `/** ${t.name}${t.description ? ` — ${t.description}` : ''} */\n`;
    out += `export interface ${name} {\n`;
    for (const f of t.fields) {
      let tsType = TS_TYPES[f.type] ?? 'unknown';
      if (f.type === 'select' && f.validations?.allowed_values?.length) {
        tsType = f.validations.allowed_values.map((v) => JSON.stringify(v)).join(' | ');
      } else if (f.type === 'select') tsType = 'string';
      const optional = f.validations?.required ? '' : '?';
      if (f.help_text) out += `  /** ${f.help_text} */\n`;
      out += `  ${f.id}${optional}: ${tsType};\n`;
    }
    out += `}\n\n`;
  }
  out += `export interface CmsTypeMap {\n`;
  for (const [apiId, name] of names) out += `  ${JSON.stringify(apiId)}: ${name};\n`;
  out += `}\n`;

  const dest = flags.o ?? 'cms-types.d.ts';
  writeFileSync(dest, out);
  console.log(`✓ Generated ${names.length} interfaces -> ${dest}`);
}

// --- entry point ------------------------------------------------------------------

const [, , ...argv] = process.argv;
const { positional, flags } = parseArgs(argv);
const command = positional.join(' ');

const rc = loadRc();
const needsAuth = command && command !== 'login';
if (needsAuth && !rc.access_token) fail('Not logged in — run: ondros-cli login --host <url> --email <email> --password <pw>');

switch (command) {
  case 'login': await cmdLogin(flags); break;
  case 'spaces': await cmdSpaces(rc); break;
  case 'types export': await cmdTypesExport(rc, flags); break;
  case 'types import': await cmdTypesImport(rc, flags); break;
  case 'generate-types': await cmdGenerateTypes(rc, flags); break;
  default:
    console.log(`ondros-cli — commands:
  login --host <url> --email <email> --password <pw>
  spaces
  types export --space <id> [--env master] [-o types.json]
  types import --space <id> [--env master] -i types.json
  generate-types --space <id> [--env master] [-o cms-types.d.ts]`);
    if (command) process.exit(1);
}
