/** Stub the Code Sync API so the preview renders locally without a real
 *  GitHub connection. Nothing in the CMS database is touched. */
export async function stubCodeSync(page, previewUrl = 'http://localhost:3000') {
  await page.route('**/code-sync/preview-target*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'page', url: `${previewUrl}/login`,
        path: '/login', content_type: 'article',
        component_id: 'article', focus_entry_id: '', host_entry_id: '',
        host_title: '', message: '',
      }),
    }),
  );
  await page.route(/\/spaces\/[^/]+\/code-sync$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        connected: true, configured: true, mode: 'token',
        install_url: '', app_slug: '',
        connection: {
          id: 'x', space_id: 'x', provider: 'github', installation_id: '',
          account_login: 'demo', repo_full_name: 'proteendas/ondros-demo-site',
          branch: 'main', preview_base_url: previewUrl,
          manifest: { previewUrl, routes: {}, components: [] },
          manifest_source: 'ondros', manifest_path: 'ondros/component-definition.json',
          status: 'connected', last_error: '', last_synced_at: null,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        },
      }),
    }),
  );
}
