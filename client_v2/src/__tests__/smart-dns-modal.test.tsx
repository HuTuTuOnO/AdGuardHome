import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { ConfigureRewritesModal } from 'panel/components/FilterLists/blocks/ConfigureRewritesModal/ConfigureRewritesModal';
import { openModal, closeModal } from 'panel/stores/modals';

vi.mock('panel/common/intl', async () =>
    (await import('panel/__tests__/helpers/copy')).createIntlMock(),
);

vi.mock('panel/stores/rewrites', () => ({
    rewritesState: { list: [], processingAdd: false, processingUpdate: false, processing: false },
    addRewrite: vi.fn(),
    updateRewrite: vi.fn(),
}));

describe('smart DNS rewrite form', () => {
    beforeEach(() => closeModal());

    it('submits all routing fields and preserves enabled state when editing', async () => {
        const onSubmit = vi.fn().mockResolvedValue(false);
        openModal('EDIT_REWRITE');
        render(() => (
            <ConfigureRewritesModal
                modalId="EDIT_REWRITE"
                onSubmit={onSubmit}
                rewriteToEdit={{
                    domain: 'example.org',
                    answer: '192.0.2.1',
                    enabled: true,
                    country: '中国',
                    province: '北京',
                    city: '北京',
                    district: '海淀',
                    isp: '电信',
                    priority: 10,
                    weight: 3,
                }}
            />
        ));

        fireEvent.change(screen.getByTestId('rewrite-province-input'), {
            target: { value: '广东' },
        });
        fireEvent.change(screen.getByTestId('rewrite-weight-input'), { target: { value: '8' } });
        fireEvent.submit(
            screen.getByTestId('rewrite-save-button').closest('form') as HTMLFormElement,
        );

        expect(onSubmit).toHaveBeenCalledWith({
            domain: 'example.org',
            answer: '192.0.2.1',
            enabled: true,
            country: '中国',
            province: '广东',
            city: '北京',
            district: '海淀',
            isp: '电信',
            priority: 10,
            weight: 8,
        });
    });

    it('prevents submitting zero weight', () => {
        const onSubmit = vi.fn();
        openModal('ADD_REWRITE');
        render(() => <ConfigureRewritesModal modalId="ADD_REWRITE" onSubmit={onSubmit} />);
        fireEvent.change(screen.getByTestId('rewrite-domain-input'), {
            target: { value: 'example.org' },
        });
        fireEvent.change(screen.getByTestId('rewrite-answer-input'), {
            target: { value: '192.0.2.1' },
        });
        fireEvent.change(screen.getByTestId('rewrite-weight-input'), { target: { value: '0' } });
        expect(screen.getByTestId('rewrite-save-button')).toBeDisabled();
        fireEvent.submit(
            screen.getByTestId('rewrite-save-button').closest('form') as HTMLFormElement,
        );
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
