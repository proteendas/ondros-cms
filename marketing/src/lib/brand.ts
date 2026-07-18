/**
 * Marketing-site brand config (spec 007/009). Kept as its own copy because
 * the marketing app is deliberately decoupled from the editor; the editor's
 * twin lives in editor/src/lib/brand.ts, the backend's in settings.brand_name.
 */
export const BRAND = {
  name: 'Ondros CMS',
  short: 'Ondros',
  tagline: 'Structured content, delivered.',
  logo: '/branding/logo.svg',
  logoIcon: '/branding/logo-icon.svg',
  favicon: '/branding/favicon.ico',
} as const;

/** The authenticated product app — all Login / Get Started CTAs point here
 * (spec 009: no duplicate login form on the marketing site). */
export const APP_LOGIN_URL =
  process.env.NEXT_PUBLIC_APP_LOGIN_URL ?? 'http://localhost:3000/login';
export const APP_SIGNUP_URL =
  process.env.NEXT_PUBLIC_APP_SIGNUP_URL ?? 'http://localhost:3000/signup';
