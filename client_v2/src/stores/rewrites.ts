import { createStore } from 'solid-js/store';
import { untrack } from 'solid-js';
import {
    rewriteList,
    rewriteAdd,
    rewriteUpdate,
    rewriteDelete,
    rewriteSettingsGet,
    rewriteSettingsUpdate,
} from 'panel/api/generated';
import { addErrorToast, addSuccessToast, createUndoToast } from './toasts';
import intl from 'panel/common/intl';
import type { RewriteEntry } from 'panel/api/model/rewriteEntry';
import type { RewriteSettings } from 'panel/api/model/rewriteSettings';

type RewritesState = {
    processing: boolean;
    initialized: boolean;
    processingAdd: boolean;
    processingDelete: boolean;
    processingUpdate: boolean;
    processingSettings: boolean;
    isModalOpen: boolean;
    modalType: string;
    currentRewrite: RewriteEntry;
    list: (RewriteEntry & { enabled?: boolean })[];
    enabled: boolean;
    smart_dns: RewriteSettings['smart_dns'];
};

const initialState: RewritesState = {
    processing: true,
    initialized: false,
    processingAdd: false,
    processingDelete: false,
    processingUpdate: false,
    processingSettings: false,
    isModalOpen: false,
    modalType: '',
    currentRewrite: {},
    list: [],
    enabled: true,
    smart_dns: { enabled: false },
};

const [state, setState] = createStore<RewritesState>(initialState);

export const toggleRewritesModal = (modalType?: string, currentRewrite?: RewriteEntry) => {
    if (modalType !== undefined) {
        setState({
            isModalOpen: !state.isModalOpen,
            modalType: modalType || '',
            currentRewrite: currentRewrite || {},
        });
    } else {
        setState('isModalOpen', (prev) => !prev);
        // modalType and currentRewrite left unchanged
    }
};

export const getRewritesList = async () => {
    setState('processing', true);
    try {
        const data = await rewriteList();
        setState({ list: data || [], processing: false, initialized: true });
    } catch (error) {
        addErrorToast({ error });
        setState({ processing: false, initialized: true });
    }
};

export const addRewrite = async (config: RewriteEntry) => {
    setState('processingAdd', true);
    try {
        await rewriteAdd(config);
        setState('processingAdd', false);
        toggleRewritesModal();
        addSuccessToast(intl.getMessage('changes_saved_success'));
        await getRewritesList();
    } catch (error) {
        addErrorToast({ error });
        setState('processingAdd', false);
    }
};

export const updateRewrite = async (
    config: { target: RewriteEntry; update: RewriteEntry },
    options: { showToast?: boolean; closeModal?: boolean } = {},
): Promise<boolean> => {
    setState('processingUpdate', true);
    try {
        await rewriteUpdate(config);
        setState('processingUpdate', false);
        if (options.closeModal !== false) {
            toggleRewritesModal();
        }
        addSuccessToast(intl.getMessage('changes_saved_success'));
        await getRewritesList();
        return true;
    } catch (error) {
        addErrorToast({ error });
        setState('processingUpdate', false);
        return false;
    }
};

export const deleteRewrite = async (
    config: RewriteEntry,
    { withUndo = false }: { withUndo?: boolean } = {},
): Promise<boolean> => {
    setState('processingDelete', true);
    try {
        await rewriteDelete(config);
        setState('processingDelete', false);
        const message = intl.getMessage('user_rules_dns_rewrite_removed');
        if (withUndo) {
            addSuccessToast(
                createUndoToast(message, intl.getMessage('notify_undo'), async () => {
                    await rewriteAdd(config);
                    await getRewritesList();
                }),
            );
        } else {
            addSuccessToast(message);
        }
        await getRewritesList();
        return true;
    } catch (error) {
        addErrorToast({ error });
        setState('processingDelete', false);
        return false;
    }
};

export const getRewriteSettings = async () => {
    setState('processingSettings', true);
    try {
        const data = await rewriteSettingsGet();
        setState({
            enabled: data.enabled ?? true,
            smart_dns: data.smart_dns ?? { enabled: false },
            processingSettings: false,
        });
    } catch (error) {
        addErrorToast({ error });
        setState('processingSettings', false);
    }
};

/** Finds the rewrite rule that produced the given query log entry. */
export const findRewriteRuleByDomain = (domain: string): RewriteEntry | undefined => {
    const exact = state.list.filter((r) => r.domain === domain);
    if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined;
    const wildcards = state.list.filter(
        (r) => r.domain?.startsWith('*.') && domain.endsWith(r.domain.slice(1)),
    );
    // A query log has no selected rule identity: avoid editing a different node.
    return wildcards.length === 1 ? wildcards[0] : undefined;
};

export const updateRewriteSettings = async (values: RewriteSettings) => {
    setState('processingSettings', true);
    try {
        await rewriteSettingsUpdate(values);
        setState({ ...values, processingSettings: false });
    } catch (error) {
        addErrorToast({ error });
        setState('processingSettings', false);
    }
};

export const rewritesState = untrack(() => state);
