# Cross-app requests handled by Pida

This index is the Pida owner's intake/response record. Original requests remain owned by their source app; incoming copies are immutable source snapshots. Their original `PENDING` section is not rewritten. Creating these records does not post a message or alter another repository.

| Direction | Request | Owner disposition | Response / next gate |
| --- | --- | --- | --- |
| Persona → Pida | [CR-PIDA-001](incoming/PERSONA-CR-PIDA-001.md) | ACCEPTED; input-boundary slice implemented in 0.8.5 | [Response](responses/PERSONA-CR-PIDA-001.md); public remote revalidation and receipt readback remain owner-pending |
| Schumpeter → Pida | [CR-PIDA-20261103-01](incoming/SCHUMPETER-CR-PIDA-20261103-01.md) | ACCEPTED; current producer evidence supplied | [Response](responses/SCHUMPETER-CR-PIDA-20261103-01.md); actual pinned importer rejects current fields, consumer change required |
| Pida → Persona | [CR-PERSONA-20261103-01](CR-PERSONA-20261103-01.md) | Owner-pending | 0.8.5 response above supersedes the older NOT_RUN statement only for local pinned-source input validation |
| Pida → PIX | [CR-PIDA-PIX-2026-11-03](CR-PIDA-PIX-2026-11-03.md) | Owner-pending | Batch engine already works; current-cut/operator questions remain separate |
| Pida → Schumpeter | [CR-PIDA-SCHUMPETER-2026-11-03-01](CR-PIDA-SCHUMPETER-2026-11-03.md) | Owner-pending | Exact current-import incompatibility reproduced in 0.8.5 |

Sources checked 2026-11-03 (Asia/Seoul): Persona local continuity worktree based on `7378040533b0333c3a24b01fbe8614c1de7b52f1`; Schumpeter PR6 `01d616d0dc32961dc0fc9ab76ca25e08d0f66fc0`. Exact imported source hashes are in `fixtures/cr-integration/consumer-lock.json`. No Pida-addressed CR was found in the inspected PIX PR13 tree `3205d832d5dcdc6901f916b35496a0c60b657e7a`; this says nothing about uncommitted work in other conversations.

At the start of later Pida work, inspect the source app's current CR/response location and revision, compare it with this index and current code, and record the disposition here. Reuse implemented behavior; a new request does not automatically require a new API. This is a development workflow, not a background cross-conversation subscription.
