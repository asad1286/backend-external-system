// Copies the endpoint list from the API docs (myCRMSIM-Api-Docs/src/data/endpoints.ts)
// into src/data/endpoints.json, for the API Explorer. Run again after the docs change:
//   npm run sync-endpoints            (docs next to this folder in ~/Workspace)
//   DOCS_DIR=/path/to/myCRMSIM-Api-Docs npm run sync-endpoints
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(process.env.DOCS_DIR || join(here, '..', '..', '..', 'myCRMSIM-Api-Docs'));
const out = join(mkdtempSync(join(tmpdir(), 'endpoints-')), 'endpoints.mjs');

await build({ entryPoints: [join(docsDir, 'src/data/endpoints.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { categories, allScopes } = await import(pathToFileURL(out).href);

const brand = (value) => JSON.parse(JSON.stringify(value).replaceAll('{{brand}}', 'myCRMSIM'));
const data = brand({
  synced_at: new Date().toISOString(),
  scopes: allScopes,
  categories: categories.map((c) => ({
    slug: c.slug,
    label: c.label,
    group: c.groupLabel,
    description: c.description || '',
    endpoints: c.endpoints.map((e) => ({
      slug: e.slug,
      title: e.title,
      method: e.method,
      path: e.path,
      summary: e.summary,
      description: e.description || '',
      scope: e.scope || null,
      authMode: e.authMode,
      params: e.params,
      requestBody: e.requestBody ?? null,
      example: e.responses.find((r) => r.status < 300) || null,
    })),
  })),
});

const target = join(here, '..', 'src', 'data', 'endpoints.json');
writeFileSync(target, JSON.stringify(data, null, 1));
const count = data.categories.reduce((n, c) => n + c.endpoints.length, 0);
console.log(`${count} endpoints in ${data.categories.length} categories → ${target}`);
