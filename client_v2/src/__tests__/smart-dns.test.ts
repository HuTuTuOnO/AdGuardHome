import { describe, it, expect } from 'vitest';
import { normalizeRewriteRouting, validRewriteRouting } from 'panel/helpers/smartDns';
import { validateRewriteNotExists } from 'panel/helpers/validators';
import { copy } from 'panel/__tests__/helpers/copy';

describe('smart DNS routing fields', () => {
    it('defaults old rules to priority zero and weight one', () => {
        expect(normalizeRewriteRouting({ domain: 'example.org' })).toEqual({
            domain: 'example.org',
            country: '',
            province: '',
            city: '',
            district: '',
            isp: '',
            priority: 0,
            weight: 1,
        });
    });

    it('trims regional conditions without changing routing numbers', () => {
        expect(
            normalizeRewriteRouting({ country: ' 中国 ', weight: 3, priority: -2 }),
        ).toMatchObject({
            country: '中国',
            weight: 3,
            priority: -2,
        });
    });

    it.each(['', '0', '-1', '1.5', 'NaN', '4294967296'])('rejects invalid weight %s', (weight) =>
        expect(validRewriteRouting('0', weight)).toBe(false),
    );

    it.each(['', '2147483648', '-2147483649', '1.1'])('rejects invalid priority %s', (priority) =>
        expect(validRewriteRouting(priority, '1')).toBe(false),
    );

    it('accepts signed priority boundaries and positive uint32 weights', () => {
        expect(validRewriteRouting('-2147483648', '1')).toBe(true);
        expect(validRewriteRouting('2147483647', '4294967295')).toBe(true);
    });

    it('allows identical domain and answer with different regions', () => {
        const existing = { domain: 'example.org', answer: '192.0.2.1', province: '北京' };
        expect(
            validateRewriteNotExists(existing.domain, existing.answer, [existing], undefined, {
                province: '广东',
            }),
        ).toBeUndefined();
        expect(
            validateRewriteNotExists(existing.domain, existing.answer, [existing], undefined, {
                province: '北京',
            }),
        ).toBe(copy('dns_rewrite_exists'));
    });

    it('excludes only the original region while editing', () => {
        const original = { domain: 'example.org', answer: '192.0.2.1', province: '北京' };
        const other = { ...original, province: '广东' };
        expect(
            validateRewriteNotExists(
                original.domain,
                original.answer,
                [original, other],
                original,
                { province: '广东' },
            ),
        ).toBe(copy('dns_rewrite_exists'));
    });
});
