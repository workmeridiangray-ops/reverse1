import { defineWorkspace } from 'vitest/config';
import path from 'node:path';
const alias = { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts') };
export default defineWorkspace([
  { resolve: { alias }, test: { name: 'unit', include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'] } },
  { resolve: { alias }, test: { name: 'db', include: ['tests/db/**/*.test.ts'], testTimeout: 30000, pool: 'forks', poolOptions: { forks: { singleFork: true } } } },
  { resolve: { alias }, test: { name: 'e2e', include: ['tests/e2e/**/*.test.ts'], testTimeout: 90000, pool: 'forks', poolOptions: { forks: { singleFork: true } } } },
]);
