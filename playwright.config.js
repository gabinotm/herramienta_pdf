import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 120_000,
    expect: { timeout: 30_000 },
    fullyParallel: true,
    workers: 3,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:5174',
        acceptDownloads: true,
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'escritorio', use: { ...devices['Desktop Chrome'] } },
        { name: 'movil', use: { ...devices['Pixel 7'] }, grep: /@movil/ },
    ],
    webServer: {
        command: 'node tools/serve.mjs 5174',
        url: 'http://localhost:5174',
        reuseExistingServer: true,
    },
});
