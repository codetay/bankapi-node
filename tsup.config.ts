import { defineConfig } from 'tsup';

export default defineConfig({
  // Task 9 appends 'src/express.ts' here, once that entry point exists.
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
});
