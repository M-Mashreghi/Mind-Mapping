// Bundle the Electron main and preload scripts to CommonJS in dist-electron/.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // ws can use these optional native add-ons when present; it works without them.
  external: ['electron', 'bufferutil', 'utf-8-validate'],
  sourcemap: true,
  // The Google OAuth client secret comes from the environment (a GitHub Actions secret in CI),
  // so it never has to be committed.
  define: { __GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.GOOGLE_CLIENT_SECRET ?? '') },
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' });
