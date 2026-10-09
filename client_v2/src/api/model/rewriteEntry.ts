/**
 * Rewrite rule
 */
export interface RewriteEntry {
    /** Domain name */
    domain?: string;
    /** value of A, AAAA or CNAME DNS record */
    answer?: string;
    /** Optional. If omitted on add, defaults to `true`. On update, omitted preserves previous value. */
    enabled?: boolean;
    /** Client country; empty matches any value */
    country?: string;
    /** Client province; empty matches any value */
    province?: string;
    /** Client city; empty matches any value */
    city?: string;
    /** Client district; empty matches any value */
    district?: string;
    /** Client ISP; empty matches any value */
    isp?: string;
    /** Higher values win after region specificity */
    priority?: number;
    /**
     * Relative probability within equal region and priority candidates
     * @minimum 1
     * @maximum 4294967295
     */
    weight?: number;
}
