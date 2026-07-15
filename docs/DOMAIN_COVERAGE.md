# Engineering domain coverage

`data/engineering-domains.json` is the versioned domain registry used by `classify_engineering_domain`, `list_engineering_domains`, `search_standards`, `grounded_engineering_research`, and local-reference indexing.

## Coverage status semantics

- `configured`: the provider is configured and can be queried.
- `indexed`: a direct KDS/KCS code family or one or more local documents are indexed for the domain.
- `partial`: the domain is searchable, but a dedicated KDS/KCS family is absent or the controlling standards are distributed across other ministries/agencies.
- `unavailable`: the provider/key/reference corpus is not configured or no local document is indexed.

These states describe retrieval coverage, not whether a final engineering conclusion is legally or technically sufficient.

## Main domain map

| Domain key | Korean label | Main KDS/KCS prefixes | Retrieval note |
|---|---|---:|---|
| `general` | 공통·융합 | 10 | Common design and general requirements |
| `geotechnical` | 지반·기초 | 11 | Geotechnical, foundation, slope, retaining structure |
| `surveying` | 측량·지형공간 | 12 | Construction/design surveying |
| `structural` | 구조·재료 | 14 | Concrete, steel, composite structural design |
| `seismic` | 내진·재난 | 17 | Common seismic design; facility-specific seismic criteria may also apply |
| `temporary_works` | 가설·시공안전 | 21 | Temporary works and construction safety interfaces |
| `bridge` | 교량 | 24 | Bridge design and construction |
| `tunnel` | 터널·지하공간 | 27 | Tunnel and underground excavation |
| `utility_tunnel` | 공동구 | 29 | Utility tunnel/common duct |
| `building_services` | 기계·전기설비 | 31, 32 | Mechanical and electrical building/facility services |
| `industrial_environment` | 산업·환경설비 | 33 | Industrial/environmental plant structures and facilities |
| `landscape` | 조경·생태 | 34 | Landscape, planting, parks, ecology |
| `architecture` | 건축 | 41, 42, 43 | Building structures, small buildings, special-purpose buildings |
| `road` | 도로·교통 | 44 | Road geometry, earthwork, drainage, pavement, safety facilities |
| `railway` | 철도 | 47 | Railway planning, trackbed, systems, stations |
| `river` | 하천·수자원 | 51 | River planning, levees, revetments, river structures |
| `dam` | 댐·저수지 | 54 | Dam and reservoir facilities |
| `water_supply` | 상수도 | 57 | Water intake, treatment, transmission, distribution, supply |
| `wastewater` | 하수도 | 61 | Sewerage, wastewater treatment, stormwater, sludge |
| `agricultural_infrastructure` | 농업생산기반 | 67 | Agricultural water and production infrastructure |
| `urban_planning` | 도시·단지·계획 | — | Statutes/admin rules plus cross-domain KDS/KCS; no single dedicated family |
| `port` | 항만·해안 | — | Ministry/agency port and fishing-port standards are important; KCSC title coverage is limited |
| `airport` | 공항·항공 | — | Airport statutes/admin rules and aviation authority standards are primary; KCSC direct coverage is limited |
| `construction_management` | 건설사업관리·품질·안전 | — | Statutes/admin rules and related KCS rather than one design family |
| `environment` | 환경·자원순환 | 33 (related) | Environmental statutes/admin rules are usually controlling |

## Multidisciplinary documents

A local reference can be assigned several `domain_keys`. The first match remains `domain_key` for backward compatibility; `domain_keys` and `domain_labels` retain additional interfaces such as:

- road drainage: `road` + `river`/`wastewater`
- railway station: `railway` + `architecture` + `building_services`
- airport terminal: `airport` + `architecture` + `building_services`
- urban utility infrastructure: `urban_planning` + `utility_tunnel` + `water_supply` + `wastewater`

## Maintenance rules

1. Keep domain IDs stable; add aliases rather than renaming IDs casually.
2. Do not assign an unsupported KDS/KCS prefix to make coverage look complete.
3. Add law/admin-rule hints only as search seeds, never as proof that the source controls every question in the domain.
4. When a ministry/agency standard is not available through KCSC, mark the domain `partial` and require current official-source verification.
5. Add classification and live-smoke fixtures when a domain or high-value alias is added.
6. Do not commit copyrighted manuals or confidential project documents. Configure them through `REFERENCE_DIR` only.
