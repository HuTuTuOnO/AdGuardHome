import type { SmartDNSConfig } from './smartDNSConfig';

/**
 * DNS rewrite settings
 */
export interface RewriteSettings {
    /** indicates whether rewrites are applied */
    enabled: boolean;
    smart_dns?: SmartDNSConfig;
}
