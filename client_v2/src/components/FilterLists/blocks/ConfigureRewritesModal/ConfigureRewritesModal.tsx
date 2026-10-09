import { createSignal, createEffect, createUniqueId, untrack } from 'solid-js';
import cn from 'clsx';
import type { RewriteEntry } from 'panel/api/model/rewriteEntry';
import { normalizeRewriteRouting, validRewriteRouting } from 'panel/helpers/smartDns';

import intl from 'panel/common/intl';
import { Dialog } from 'panel/common/ui/Dialog/Dialog';
import { MODAL_TYPE } from 'panel/helpers/constants';

import { ModalWrapper } from 'panel/common/ui/ModalWrapper';
import { closeModal } from 'panel/stores/modals';
import theme from 'panel/lib/theme';
import { Button } from 'panel/common/ui/Button';
import { addRewrite, updateRewrite, rewritesState } from 'panel/stores/rewrites';
import { Input } from 'panel/common/controls/Input';
import {
    validateAnswer,
    validateDomain,
    validateRequiredValue,
    validateRewriteNotExists,
    validateRewriteNotSame,
} from 'panel/helpers/validators';
import { DomainFaqTooltip } from './DomainFaqTooltip';
import { AnswerFaqTooltip } from './AnswerFaqTooltip';
import s from './ConfigureRewritesModal.module.pcss';

export type FormValues = RewriteEntry & {
    answer: string;
    domain: string;
    enabled: boolean;
};

type ConfigureRewritesModalIdType = 'ADD_REWRITE' | 'EDIT_REWRITE';

type Props = {
    modalId: ConfigureRewritesModalIdType;
    rewriteToEdit?: Partial<FormValues>;
    onSubmit?: (values: FormValues) => boolean | void | Promise<boolean | void>;
    onClose?: () => void;
};

const getTitle = (modalId: ConfigureRewritesModalIdType) => {
    if (modalId === MODAL_TYPE.EDIT_REWRITE) {
        return intl.getMessage('rewrite_edit');
    }

    return intl.getMessage('rewrite_add');
};

const getButtonText = (modalId: ConfigureRewritesModalIdType) => {
    if (modalId === MODAL_TYPE.EDIT_REWRITE) {
        return intl.getMessage('save');
    }

    return intl.getMessage('add');
};

export const ConfigureRewritesModal = (props: Props) => {
    const [domain, setDomain] = createSignal(untrack(() => props.rewriteToEdit?.domain) ?? '');
    const [answer, setAnswer] = createSignal(untrack(() => props.rewriteToEdit?.answer) ?? '');
    const prefix = createUniqueId();
    const [country, setCountry] = createSignal('');
    const [province, setProvince] = createSignal('');
    const [city, setCity] = createSignal('');
    const [district, setDistrict] = createSignal('');
    const [isp, setIsp] = createSignal('');
    const [priority, setPriority] = createSignal('0');
    const [weight, setWeight] = createSignal('1');
    const routing = (): RewriteEntry =>
        normalizeRewriteRouting({
            country: country(),
            province: province(),
            city: city(),
            district: district(),
            isp: isp(),
            priority: Number(priority()),
            weight: Number(weight()),
        });
    const resetRouting = (rewrite?: RewriteEntry) => {
        setCountry(rewrite?.country ?? '');
        setProvince(rewrite?.province ?? '');
        setCity(rewrite?.city ?? '');
        setDistrict(rewrite?.district ?? '');
        setIsp(rewrite?.isp ?? '');
        setPriority(String(rewrite?.priority ?? 0));
        setWeight(String(rewrite?.weight ?? 1));
    };
    const [domainError, setDomainError] = createSignal<string | undefined>();
    const [answerError, setAnswerError] = createSignal<string | undefined>();

    createEffect(() => {
        setDomain(props.rewriteToEdit?.domain ?? '');
        setAnswer(props.rewriteToEdit?.answer ?? '');
        resetRouting(props.rewriteToEdit);
    });

    const closeDialog = () => {
        setDomain('');
        setAnswer('');
        resetRouting();
        setDomainError(undefined);
        setAnswerError(undefined);
        props.onClose?.();
        closeModal();
    };

    const handleCancel = () => {
        resetRouting(props.rewriteToEdit);
        setDomain(props.rewriteToEdit?.domain ?? '');
        setAnswer(props.rewriteToEdit?.answer ?? '');
        setDomainError(undefined);
        setAnswerError(undefined);
        props.onClose?.();
        closeModal();
    };

    const validateDomainField = () => {
        const err = validateRequiredValue(domain()) || validateDomain(domain());
        setDomainError(err || undefined);
        return !err;
    };

    const validateAnswerField = () => {
        const err =
            validateRequiredValue(answer()) ||
            validateAnswer(answer()) ||
            validateRewriteNotSame(domain(), answer()) ||
            validateRewriteNotExists(
                domain(),
                answer(),
                rewritesState.list,
                props.rewriteToEdit,
                routing(),
            );
        setAnswerError(err || undefined);
        return !err;
    };

    const hasErrors = () =>
        !!domainError() || !!answerError() || !validRewriteRouting(priority(), weight());

    const handleFormSubmit = async (e: Event) => {
        e.preventDefault();

        const domainValid = validateDomainField();
        const answerValid = validateAnswerField();
        if (!domainValid || !answerValid || !validRewriteRouting(priority(), weight())) {
            return;
        }

        const values: FormValues = {
            ...routing(),
            domain: domain(),
            answer: answer(),
            enabled: props.rewriteToEdit?.enabled ?? false,
        };

        if (props.onSubmit) {
            const shouldClose = await props.onSubmit(values);

            if (shouldClose !== false) {
                closeDialog();
            }

            return;
        }

        switch (props.modalId) {
            case MODAL_TYPE.ADD_REWRITE: {
                addRewrite({ ...values, enabled: true });
                closeDialog();
                break;
            }
            case MODAL_TYPE.EDIT_REWRITE: {
                updateRewrite({
                    target: props.rewriteToEdit,
                    update: values,
                });
                closeDialog();
                break;
            }
            default: {
                break;
            }
        }
    };

    return (
        <ModalWrapper id={props.modalId}>
            <Dialog visible onClose={handleCancel} title={getTitle(props.modalId)}>
                <form onSubmit={handleFormSubmit}>
                    <div>
                        <div class={theme.form.group}>
                            <div class={theme.form.input}>
                                <Input
                                    type="text"
                                    id={prefix + '-domain'}
                                    data-testid="rewrite-domain-input"
                                    label={
                                        <>
                                            {intl.getMessage('rewrite_domain')}
                                            <DomainFaqTooltip />
                                        </>
                                    }
                                    placeholder={intl.getMessage(
                                        'rewrite_domain_input_placeholder',
                                    )}
                                    value={domain()}
                                    onChange={(e) => {
                                        setDomain((e.target as HTMLInputElement).value);
                                        setDomainError(undefined);
                                        // The duplicate check depends on both fields.
                                        setAnswerError(undefined);
                                    }}
                                    onBlur={validateDomainField}
                                    errorMessage={domainError()}
                                    size="large"
                                    onCard
                                />
                            </div>

                            <div class={theme.form.input}>
                                <Input
                                    type="text"
                                    id={prefix + '-answer'}
                                    data-testid="rewrite-answer-input"
                                    label={
                                        <>
                                            {intl.getMessage('result')}
                                            <AnswerFaqTooltip />
                                        </>
                                    }
                                    placeholder={intl.getMessage(
                                        'rewrites_answer_input_placeholder',
                                    )}
                                    value={answer()}
                                    onChange={(e) => {
                                        setAnswer((e.target as HTMLInputElement).value);
                                        setAnswerError(undefined);
                                    }}
                                    onBlur={validateAnswerField}
                                    errorMessage={answerError()}
                                    size="large"
                                    onCard
                                />
                            </div>
                        </div>
                    </div>

                    <div class={cn(theme.form.group, s.routingFields)}>
                        <p class={theme.text.t3}>{intl.getMessage('smart_dns_routing_help')}</p>
                        <Input
                            id={prefix + '-country'}
                            data-testid="rewrite-country-input"
                            label={intl.getMessage('smart_dns_country')}
                            value={country()}
                            onChange={(e) => {
                                setCountry(e.target.value);
                                setAnswerError(undefined);
                            }}
                            onCard
                        />
                        <Input
                            id={prefix + '-province'}
                            data-testid="rewrite-province-input"
                            label={intl.getMessage('smart_dns_province')}
                            value={province()}
                            onChange={(e) => {
                                setProvince(e.target.value);
                                setAnswerError(undefined);
                            }}
                            onCard
                        />
                        <Input
                            id={prefix + '-city'}
                            data-testid="rewrite-city-input"
                            label={intl.getMessage('smart_dns_city')}
                            value={city()}
                            onChange={(e) => {
                                setCity(e.target.value);
                                setAnswerError(undefined);
                            }}
                            onCard
                        />
                        <Input
                            id={prefix + '-district'}
                            data-testid="rewrite-district-input"
                            label={intl.getMessage('smart_dns_district')}
                            value={district()}
                            onChange={(e) => {
                                setDistrict(e.target.value);
                                setAnswerError(undefined);
                            }}
                            onCard
                        />
                        <Input
                            id={prefix + '-isp'}
                            data-testid="rewrite-isp-input"
                            label={intl.getMessage('smart_dns_isp')}
                            value={isp()}
                            onChange={(e) => {
                                setIsp(e.target.value);
                                setAnswerError(undefined);
                            }}
                            onCard
                        />
                        <Input
                            id={prefix + '-priority'}
                            type="text"
                            inputMode="numeric"
                            data-testid="rewrite-priority-input"
                            label={intl.getMessage('smart_dns_priority')}
                            value={priority()}
                            onChange={(e) => setPriority(e.target.value)}
                            onCard
                        />
                        <Input
                            id={prefix + '-weight'}
                            type="number"
                            min={1}
                            max={4294967295}
                            step={1}
                            data-testid="rewrite-weight-input"
                            label={intl.getMessage('smart_dns_weight')}
                            value={weight()}
                            onChange={(e) => setWeight(e.target.value)}
                            onCard
                        />
                    </div>

                    <div class={theme.dialog.footer}>
                        <Button
                            type="submit"
                            id="save"
                            data-testid="rewrite-save-button"
                            variant="primary"
                            size="small"
                            disabled={
                                rewritesState.processingAdd ||
                                rewritesState.processingUpdate ||
                                rewritesState.processing ||
                                hasErrors()
                            }
                            class={theme.dialog.button}
                        >
                            {getButtonText(props.modalId)}
                        </Button>

                        <Button
                            type="button"
                            id="cancel"
                            data-testid="rewrite-cancel-button"
                            variant="secondary"
                            size="small"
                            onClick={handleCancel}
                            class={theme.dialog.button}
                            onCard
                        >
                            {intl.getMessage('cancel')}
                        </Button>
                    </div>
                </form>
            </Dialog>
        </ModalWrapper>
    );
};
