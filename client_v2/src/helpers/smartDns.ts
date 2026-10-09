import type { RewriteEntry } from 'panel/api/model/rewriteEntry';

export const REGION_FIELDS = ['country', 'province', 'city', 'district', 'isp'] as const;

export type RegionField = (typeof REGION_FIELDS)[number];

export const sameRewriteRegion = (a: RewriteEntry, b: RewriteEntry): boolean =>
    REGION_FIELDS.every((field) => (a[field] ?? '').trim() === (b[field] ?? '').trim());

export const validRewriteRouting = (priority: string, weight: string): boolean => {
    const p = Number(priority);
    const w = Number(weight);
    return (
        priority.trim() !== '' &&
        weight.trim() !== '' &&
        Number.isInteger(p) &&
        p >= -2147483648 &&
        p <= 2147483647 &&
        Number.isInteger(w) &&
        w >= 1 &&
        w <= 4294967295
    );
};

export const normalizeRewriteRouting = (rewrite: RewriteEntry): RewriteEntry => ({
    ...rewrite,
    country: (rewrite.country ?? '').trim(),
    province: (rewrite.province ?? '').trim(),
    city: (rewrite.city ?? '').trim(),
    district: (rewrite.district ?? '').trim(),
    isp: (rewrite.isp ?? '').trim(),
    priority: rewrite.priority ?? 0,
    weight: rewrite.weight ?? 1,
});
