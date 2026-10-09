import { test, expect } from '@playwright/test';
import type { RewriteEntry } from '../../src/api/model/rewriteEntry';

const domain = 'smart-dns-e2e.example.org';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    test('regional rewrites at ' + viewport.width, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'smartdns', 'Requires the isolated smart DNS test backend');
        await page.setViewportSize(viewport);
        const list = async (): Promise<RewriteEntry[]> => {
            const response = await page.request.get('/control/rewrite/list');
            expect(response.ok()).toBeTruthy();
            return response.json();
        };
        const clean = async () => {
            for (const rewrite of (await list()).filter((entry) => entry.domain === domain)) {
                const response = await page.request.post('/control/rewrite/delete', { data: rewrite });
                expect(response.ok()).toBeTruthy();
            }
        };
        await clean();
        try {
            const sibling: RewriteEntry = {
                domain, answer: '192.0.2.10', enabled: true,
                country: '中国', province: '广东', priority: 10, weight: 3,
            };
            const response = await page.request.post('/control/rewrite/add', { data: sibling });
            expect(response.ok()).toBeTruthy();
            await page.goto('/#dns_rewrites');
            await expect(page.getByTestId('add-rewrite')).toBeVisible();
            const smartToggle = page.locator('input#rewrite_smart_dns_enabled');
            await expect(smartToggle).toBeChecked();
            await page.locator('label[for="rewrite_smart_dns_enabled"]').click();
            await expect(smartToggle).not.toBeChecked();
            await page.locator('label[for="rewrite_smart_dns_enabled"]').click();
            await expect(smartToggle).toBeChecked();
            await page.getByTestId('add-rewrite').click();
            await page.getByTestId('rewrite-domain-input').fill(domain);
            await page.getByTestId('rewrite-answer-input').fill('192.0.2.10');
            await page.getByTestId('rewrite-country-input').fill('中国');
            await page.getByTestId('rewrite-province-input').fill('北京');
            await page.getByTestId('rewrite-city-input').fill('北京');
            await page.getByTestId('rewrite-district-input').fill('海淀');
            await page.getByTestId('rewrite-isp-input').fill('电信');
            await page.getByTestId('rewrite-priority-input').fill('-10');
            await page.getByTestId('rewrite-weight-input').fill('0');
            await page.getByTestId('rewrite-weight-input').blur();
            await expect(page.getByTestId('rewrite-save-button')).toBeDisabled();
            await page.getByTestId('rewrite-weight-input').fill('8');
            await page.getByTestId('rewrite-weight-input').blur();
            await expect(page.getByTestId('rewrite-save-button')).toBeEnabled();
            await page.screenshot({ path: testInfo.outputPath('routing-form.png'), fullPage: true });
            await page.getByTestId('rewrite-save-button').click();
            await expect.poll(async () => (await list()).filter((entry) => entry.domain === domain).length).toBe(2);
            const regional = (await list()).find((entry) => entry.domain === domain && entry.province === '北京');
            expect(regional).toMatchObject({
                country: '中国', province: '北京', city: '北京', district: '海淀', isp: '电信',
                priority: -10, weight: 8, enabled: true,
            });
            await page.getByTestId('edit-rewrite-' + domain).last().click();
            await page.getByTestId('rewrite-weight-input').fill('12');
            await page.getByTestId('rewrite-weight-input').blur();
            await page.getByTestId('rewrite-save-button').click();
            await expect.poll(async () => (await list()).find((entry) => entry.province === '北京')?.weight).toBe(12);
            const switchLabel = page.getByText(domain, { exact: true }).last().locator('..').locator('label');
            await switchLabel.click();
            await expect.poll(async () => (await list()).find((entry) => entry.province === '北京')?.enabled).toBe(false);
            expect((await list()).find((entry) => entry.province === '广东')).toEqual(sibling);
            await page.screenshot({ path: testInfo.outputPath('routing-table.png'), fullPage: true });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
            await page.getByTestId('delete-rewrite-' + domain).last().click();
            await page.getByTestId('rewrite-delete-confirm').click();
            await expect.poll(async () => (await list()).filter((entry) => entry.domain === domain)).toEqual([sibling]);
        } finally {
            await clean();
        }
    });
}
