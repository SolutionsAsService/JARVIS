# Proposed contracts — not live APIs

This specifies intended JARVIS boundaries. It does not claim OpenClaw, Freddie or DevHub expose these exact methods/types.

## Adapter

Declare id, upstream revision, operations, permissions, cancellation and timeout behavior. Proposed methods: inspectCapabilities(), execute(task, signal), reconcile(taskId), cancel(handle). Accepted execution returns a durable handle or an explicit synchronous terminal result. Accepted/running are never succeeded.

Result envelope: taskId, attempt, adapterId, state, startedAt, finishedAt, artifacts[], checks[], failure?, nextAction?. Checks include operation identity, actual exit/conclusion, revision tested and evidence reference. Artifacts are access-controlled references, not secret-bearing raw logs.

## Capability registry

Capability identity (e.g. repo.verify) is independent from display name. Exclusive capabilities allow one provider per project policy. Compare content hashes for exact duplicates; compare capability sets and overrides for conflicts. Deduplication is a proposal until approved. Preserve provider metadata and backups.

## Frontend export v1

kind: jarvis.deployment-plan; mode: preview; schemaVersion: 1; enabled skill ids; planned adapters (connected:false); MCP proposals (installed:false); proposed DevHub endpoint; bounded executionPolicy; secretsIncluded:false. See schemas/stack-plan.schema.json.

Never pass the untrusted client plan directly to a shell/installer. Backend revalidation includes registry ids, privileges, URLs, tenant ownership, pinned package specs and approvals. The preview deadline is checked on action only; real runtime deadlines must be enforced server-side.

## DevHub discovery questions

What repository/version are we integrating? Who owns auth? Are projects tenant-scoped? How are submissions acknowledged? What evidence format and callback/event protocol does it accept? Where can this frontend be mounted? Until answered, no live adapter is advertised.
