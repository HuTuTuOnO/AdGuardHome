import { defineConfig } from '@playwright/test';

// Run against an isolated Go backend with both local XDB databases configured.
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: 'smart-dns.spec.ts',
    workers: 1,
    timeout: 30000,
    reporter: 'list',
    projects: [{ name: 'smartdns' }],
    use: {
        channel: 'chrome',
        baseURL: process.env.ADGUARD_SMART_DNS_TEST_URL ?? 'http://127.0.0.1:3301',
        screenshot: 'only-on-failure',
    },
});
