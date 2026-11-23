import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const tmp = (n: string) => path.join(os.tmpdir(), `ln-e2e-${n}-${Date.now()}`);
/**
 * Two app instances are started:
 *  - :8830 "connected": real Gemini/Brave adapters pointed at a local mock of their HTTP APIs (e2e/mock-upstream.mjs)
 *  - :8831 "unconfigured": no API keys at all
 * Real-provider checks are separate (npm run verify:live) because they need real credentials.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { channel: 'chrome', trace: 'off', baseURL: 'http://127.0.0.1:8830' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 950 } }, grepInvert: /@mobile/ },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome' }, grep: /@mobile/ },
  ],
  webServer: [
    { command: 'node e2e/mock-upstream.mjs', env: { MOCK_PORT: '8899' }, port: 8899, reuseExistingServer: false },
    { command: 'node dist-server/index.mjs', port: 8830, reuseExistingServer: false, env: { PORT: '8830', HOST: '127.0.0.1', DATA_DIR: tmp('a'), GEMINI_API_KEY: 'test-gemini', GEMINI_MODEL: 'gemini-test', GEMINI_API_BASE: 'http://127.0.0.1:8899', BRAVE_SEARCH_API_KEY: 'test-brave', BRAVE_API_BASE: 'http://127.0.0.1:8899' } },
    { command: 'node dist-server/index.mjs', port: 8831, reuseExistingServer: false, env: { PORT: '8831', HOST: '127.0.0.1', DATA_DIR: tmp('b') } },
  ],
});
