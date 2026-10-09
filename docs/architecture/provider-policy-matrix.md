# Provider policy and capability matrix

Status: rollout gate. **pending-verification** is the initial status for every unreviewed operation. A provider may be used in production only after a source-backed row is reviewed and its tested capability state is recorded.

## Decision rules

- Separate official API, official embed, authorized website/browser surface, local file, public transparency library and unsupported reverse-engineered access.
- Search permission does not imply playback/download permission. Playback does not imply permission to download, extract streams, store media or mirror engagement.
- State coverage by source, country/region, date and ad category. Never claim global completeness from partial provider APIs.
- User authentication is per connected account; viewer-only use should stay anonymous where permitted.
- Record official docs/terms URL, date reviewed, reviewer, allowed operations, prohibited operations, quota, fields/retention, test evidence and open risks.
- If terms are uncertain or source behavior is not source-backed, keep the operation unavailable/unknown instead of shipping a guess.

## Matrix

| Source | Candidate operations | Default decision before review | Evidence required for release |
|---|---|---|---|
| Local files/folders | Index, metadata, local playback, collections, resume | Allow local-only prototype with explicit directory selection | Path safety, permissions, metadata parser tests, corrupt/missing-file behavior |
| User-provided torrent/magnet | Discover metadata, download, verify, local stream | Allow only user-initiated, rights-aware, visible and cancellable flows | Engine license/audit, destination/loopback security, no auto-execution, legal scope and GUI tests |
| YouTube | Search/metadata, official embed, supported user-authorized account actions, permitted local content | Supported APIs/embeds first; other access pending review | Current developer policies, auth scopes, quota, region coverage, actual desktop tests, no shared operator identity |
| Instagram | Public discovery, official website/embed, eligible account actions | Unknown until operation-specific review | Current official API/embedding terms, eligible account types, limitations and tests |
| TikTok | Supported public discovery, official embed, eligible account actions | Unknown until operation-specific review | Current developer/platform terms, regional availability and authorization gates |
| Snapchat | Supported public content/official external experience | Unknown until operation-specific review | Current official developer capabilities, public access and embed restrictions |
| X | Supported public discovery/official embed/account capabilities | Unknown until operation-specific review | Current developer API access, pricing/rate limits, display and retention requirements |
| Netflix | Official player/site/deep link | Official external/isolated surface unless a supported API is proven | Current terms, DRM boundary, OS/browser support; never promise raw-stream playback |
| Amazon Prime Video | Official player/site/deep link | Official external/isolated surface unless a supported API is proven | Current terms, DRM boundary, region/account requirement |
| Paramount+ | Official player/site/deep link | Official external/isolated surface unless a supported API is proven | Current terms, DRM boundary, region/account requirement |
| Google Ads Transparency Center | Public ad creative and advertiser disclosure search within supported coverage | Connector only after access method/terms confirmed; no global-completeness claim | Official coverage, automated-access restrictions, attribution, dates/regions/categories |
| Meta Ad Library | Search supported ad categories/regions through approved mechanisms | Limited connector; API eligibility and scope must be established | Current API/research access, region/category/date limits, authorization and allowed storage |
| TikTok Commercial Content API | Query supported commercial content and advertiser metadata | Limited connector after approved access | Current eligibility, regions, fields, query limits, retention and attribution |
| General programmatic ad networks/OpenRTB | Bid/auction requests/responses, deals or authorized integration | Not a global searchable ad catalog; integration-specific only | Contract, consent/privacy signals, commercial access, security and actual coverage |
| Independent reviews | Link/search/aggregate supported sources | Source-specific links/summaries unless collection is authorized | Terms, attribution, freshness, duplication handling, verification-signal availability and retention |
| Other providers | Source-specific operations | Unknown | Same review and acceptance process |

## Required record for each operation

Before marking an operation available, add operation ID; permission status; source docs URL; last-checked date; reviewer; authentication/consent; region/categories; request/data-field scope; cache/retention; error/rate-limit behavior; live smoke result; fixtures; GUI path; residual limitation.

This matrix is an implementation gate, not legal advice. Recheck current terms when an integration ships.