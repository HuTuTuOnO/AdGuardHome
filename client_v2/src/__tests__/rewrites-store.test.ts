import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    rewriteList: vi.fn(),
    addErrorToast: vi.fn(),
    addSuccessToast: vi.fn(),
    createUndoToast: vi.fn(),
}));

vi.mock('panel/api/generated', () => ({
    rewriteList: mocks.rewriteList,
    rewriteAdd: vi.fn(),
    rewriteUpdate: vi.fn(),
    rewriteDelete: vi.fn(),
    rewriteSettingsGet: vi.fn(),
    rewriteSettingsUpdate: vi.fn(),
}));
vi.mock('panel/stores/toasts', () => ({
    addErrorToast: mocks.addErrorToast,
    addSuccessToast: mocks.addSuccessToast,
    createUndoToast: mocks.createUndoToast,
}));
vi.mock('panel/common/intl', async () =>
    (await import('panel/__tests__/helpers/copy')).createIntlMock(),
);

import { getRewritesList, rewritesState, findRewriteRuleByDomain } from 'panel/stores/rewrites';

describe('getRewritesList — initialized flag', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        rewritesState.initialized = false;
    });

    it('marks initialized after a successful request', async () => {
        mocks.rewriteList.mockResolvedValue([]);

        await getRewritesList();

        expect(rewritesState.initialized).toBe(true);
    });

    it('marks initialized after a failed request so the loader cannot get stuck', async () => {
        mocks.rewriteList.mockRejectedValue(new Error('network'));

        await getRewritesList();

        expect(rewritesState.initialized).toBe(true);
        expect(mocks.addErrorToast).toHaveBeenCalled();
    });

    it('does not choose an arbitrary regional rule for query log actions', async () => {
        mocks.rewriteList.mockResolvedValue([
            { domain: 'example.org', answer: '192.0.2.1', province: '北京' },
            { domain: 'example.org', answer: '192.0.2.2', province: '广东' },
        ]);
        await getRewritesList();
        expect(findRewriteRuleByDomain('example.org')).toBeUndefined();
    });
});
