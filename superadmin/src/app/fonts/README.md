# Brand fonts (self-hosted)

`Plus Jakarta Sans` (UI) and `JetBrains Mono` (code/ids) — the same pair the
marketing site (`ondros-cms-site`) uses, so the app and the brand site match.

These are the **latin-subset variable** woff2 files from Google Fonts, checked
in and loaded through `next/font/local` in `../layout.tsx`.

Why vendored rather than `next/font/google`: that helper downloads from
`fonts.googleapis.com` at build time, which fails in the Docker dev containers
(the host resolves the CDN over IPv6 only and the bridge network can't route
it) and in any offline/air-gapped CI. Vendoring makes the build hermetic.

Both faces are licensed under the SIL Open Font License 1.1:
- https://fonts.google.com/specimen/Plus+Jakarta+Sans
- https://fonts.google.com/specimen/JetBrains+Mono
