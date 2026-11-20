// Fabrique l'extension Claude Desktop (dist/decoupage-studio.mcpb) : serveur MCP en un seul fichier
// (esbuild, sans node_modules) et manifest.json, dans une archive zip.
import { build } from 'esbuild';
import JSZip from 'jszip';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const out = await build({
  entryPoints: ['mcp/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  write: false,
  minify: true,
  logLevel: 'warning',
});
const manifest = {
  manifest_version: '0.3',
  name: 'decoupage-studio',
  display_name: 'Découpage Studio',
  version: pkg.version,
  description: 'Laisse Claude lire et modifier le projet ouvert dans Découpage Studio (dans la limite de l’accès choisi dans l’outil).',
  author: { name: 'Découpage Studio' },
  server: { type: 'node', entry_point: 'server/index.js', mcp_config: { command: 'node', args: ['${__dirname}/server/index.js'], env: {} } },
  compatibility: { runtimes: { node: '>=18.0.0' } },
};
const zip = new JSZip();
zip.file('manifest.json', JSON.stringify(manifest, null, 2));
zip.file('server/index.js', out.outputFiles[0].contents);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/decoupage-studio.mcpb', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('dist/decoupage-studio.mcpb');
