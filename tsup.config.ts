import { defineConfig } from 'tsup';

export default defineConfig({
  // Task 9 appends 'src/express.ts' here, once that entry point exists.
  entry: ['src/index.ts', 'src/express.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  splitting: false,
  outDir: 'dist',
  outExtension: ({ format }) => ({
    js: format === 'esm' ? '.js' : '.cjs',
    dts: format === 'esm' ? '.d.ts' : '.d.cts',
  }),
});
