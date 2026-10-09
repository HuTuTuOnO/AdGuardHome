export interface SmartDNSConfig {
    enabled?: boolean;
    /** IPv4 XDB path, relative to data directory or absolute; defaults to ip2region_v4.xdb */
    ipv4_db?: string;
    /** IPv6 XDB path, relative to data directory or absolute; defaults to ip2region_v6.xdb */
    ipv6_db?: string;
}
