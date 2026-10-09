# Smart DNS rewrites

Smart DNS selects a rewrite answer using the requesting client's IP address,
looked up in local ip2region IPv4 and IPv6 XDB databases. Enable it in the DNS
rewrites page. The page also supports country, province, city, district, ISP,
priority, and weight on each rewrite.

## Database configuration

By default, both databases are read from the AdGuard Home data directory:

- `data/ip2region_v4.xdb`
- `data/ip2region_v6.xdb`

For an installation with working directory `/opt/AdGuardHome`, these resolve
to `/opt/AdGuardHome/data/ip2region_v4.xdb` and
`/opt/AdGuardHome/data/ip2region_v6.xdb`. Custom paths may be absolute or
relative to the data directory. Both files must be present when enabling smart
DNS. Invalid database settings are rejected without replacing the running
settings. Replace the database files while the service is stopped and restart
it to load new data.

The reader caches vector indexes and uses a pool of file readers. It does not
load the complete databases into memory. It supports the standard five-field
format `country|area|province|city|isp` and the supplied extended format
`continent|country|province|city|district|isp|...`.

## Rule selection

1. Ignore disabled rules and rules whose filled regional conditions do not
   all match the client. Blank fields match any value. Conditions use the
   database's names, such as `中国`, `北京`, and `电信`.
2. Keep exact domain matches ahead of wildcard matches. For wildcards, prefer
   the most specific domain pattern, preserving existing domain precedence.
3. Prefer the largest number of filled, matched regional fields.
4. If the counts tie, compare field presence in this order:
   `country > province > city > district > isp`. At the first difference,
   the rule with a filled field wins.
5. Prefer the largest `priority`. The default is 0; signed 32-bit values
   are accepted.
6. Within the tied region and priority set, choose one answer randomly with
   probability `weight / sum(weights)`. Weights must be positive integers
   up to 4294967295; omitted weights default to 1.

For a Beijing Telecom client, `中国+北京+电信` wins over
`中国+北京`, which wins over `中国+电信`, even if the less specific
rule has a higher priority. Rules with weights 1 and 3 in the winning set have
respective selection probabilities of 25% and 75%.

Only the requested record type participates: IPv4 answers are returned for A
queries and IPv6 answers for AAAA queries. Existing CNAME and A/AAAA exception
answers remain supported. Every link in a CNAME chain uses the same client
region and ranking.

Unknown, reserved, and private client IPs use rules with no regional
conditions. If no rule matches, normal DNS resolution continues. When smart
DNS is disabled, regional rules are ignored and ordinary rewrites retain their
existing behavior, including multiple answers.

The client address is the peer address already identified by AdGuard Home;
incoming EDNS Client Subnet values do not override it. A query forwarded by
another resolver is therefore classified by that resolver's address. Selection
runs before upstream-cache access on each request. Client-side DNS caches may
reuse a selected answer until its TTL expires.

## YAML example

Merge the following into the existing `filtering` section of
`AdGuardHome.yaml` while the service is stopped:

```yaml
filtering:
  rewrites_enabled: true
  smart_dns:
    enabled: true
    ipv4_db: /opt/AdGuardHome/data/ip2region_v4.xdb
    ipv6_db: /opt/AdGuardHome/data/ip2region_v6.xdb
  rewrites:
    - domain: example.org
      answer: 192.0.2.10
      enabled: true
      country: 中国
      province: 北京
      isp: 电信
      priority: 10
      weight: 1
    - domain: example.org
      answer: 192.0.2.11
      enabled: true
      country: 中国
      province: 北京
      isp: 电信
      priority: 10
      weight: 3
    - domain: example.org
      answer: 192.0.2.20
      enabled: true
      priority: 0
      weight: 1
```

## HTTP API

The existing `/control/rewrite/list`, `add`, `update`, and
`delete` endpoints include the new fields. When updating or deleting a
regional rule, pass its original `domain`, `answer`, and regional
fields to identify it. Priority, weight, and enabled state are not part of its
identity. The UI preserves these fields in all operations.

`GET /control/rewrite/settings` returns `enabled` and a
`smart_dns` object. `PUT /control/rewrite/settings/update` accepts the
same shape. Omitting `smart_dns` preserves the active smart DNS settings.

## Verification

Run unit and race tests with:

```sh
go test -race ./internal/filtering ./internal/dnsforward
```

With the supplied extended databases in the repository's `data` directory,
run the opt-in real database tests with:

```sh
go test -race -tags integration ./internal/filtering ./internal/dnsforward -run SmartDNS
```

From the `client_v2` directory, run `npm run check` for lint, type checking,
and all frontend unit tests, and `npm run build-prod` for the production UI.
For desktop and mobile browser checks, start an isolated Go backend with the
rebuilt UI, both XDB paths configured, smart DNS enabled, and authentication
disabled on a loopback-only test listener. Run:

```sh
ADGUARD_SMART_DNS_TEST_URL=http://127.0.0.1:3301 npm run test:e2e -- --config playwright.smartdns.config.ts
```

The browser checks use installed Google Chrome with a temporary profile and
create then remove only the `smart-dns-e2e.example.org` test rules. Use a
disposable backend configuration; do not point them at a production instance.
