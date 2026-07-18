/**
 * Single change-point for product branding (spec 007).
 * Backend twin: `settings.brand_name` / `settings.brand_short` in
 * backend/app/config.py. The marketing site keeps its own copy in
 * marketing/src/lib/brand.ts (decoupled app).
 */
export const BRAND = {
  name: 'Ondros CMS',
  short: 'Ondros',
  tagline: 'Structured content, delivered.',
  // Assets live in editor/public/branding/ (served at /branding/*).
  logo: '/branding/logo.svg',
  logoIcon: '/branding/logo-icon.svg',
  favicon: '/branding/favicon.ico',
} as const;
