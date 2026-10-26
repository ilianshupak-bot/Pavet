const esbuild = require('esbuild');
const { copyFileSync } = require('fs');

async function main() {
  await esbuild.build({
    entryPoints: ['src/app.js'],
    bundle: true,
    format: 'iife',
    minify: true,
    outfile: 'transport.js'
  });
  copyFileSync(
    'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
    'maplibre-gl-worker.mjs'
  );
}

main().catch(error => { console.error(error); process.exitCode = 1; });
