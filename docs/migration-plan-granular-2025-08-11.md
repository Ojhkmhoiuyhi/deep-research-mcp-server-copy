---
Timestamp: 2025-08-11T09:56:51-04:00
Version: 1.0.0
Authors: Maintainers
Status: Plan (no code changes in this doc)
Safety: Non-destructive; no commands
---

## Principles

- Exa remains optional and is not implemented yet. All Exa work is flag-gated and additive.
- Firecrawl/irecrawl is not used in runtime paths; removal is scheduled in WS2 cleanup. Until Exa is integrated, agents use only Gemini Google Search grounding + URL context.
- Agents must work first using Google Search grounding + URL context via Gemini API only; MCP uses only GEMINI_API_KEY; Exa is optional later.
- No commands run automatically; contributors must seek approval before installs or changes.
- .env.example must stay in sync with all env flags.
- Prefer schema-validated, JSON-only model outputs.
- Cache and learning features must be opt-in and bounded (TTL, size, memory-safe).

## Global Safeguards

- Env gates (defaults shown):
  - ENABLE_EXA_PRIMARY=false
  - AGENT_MEMORY_TTL_MS=604800000 (7d)
  - AGENT_MEMORY_MAX=500
  - ENABLE_GEMINI_GOOGLE_SEARCH=true
  - ENABLE_GEMINI_FUNCTIONS=false
  - ENABLE_GEMINI_CODE_EXECUTION=false
  - ENABLE_PROVIDER_CACHE=true
  - CONCURRENCY_LIMIT=5
  - MIN_CITATIONS_PER_SECTION=2
  - AUTHORITY_THRESHOLD=0.6
  - MAX_REPAIR_PASSES=1
  - MAX_RETRIES=2
  - PHASE_TIMEOUT_MS=20000
  - OVERALL_DEADLINE_MS=120000
  - PROGRESS_REDACT_BODIES=true
- Caching bounds: use LRU with max items + optional TTL; never write secrets.
- Structured logs with clear error envelopes; retain user-facing messages.
- Backout path on every workstream.

## Execution Order

1. Workstream 1: Types Strengthening
2. Workstream 4: Agent Separation + Supervisor (New Agents) and Gemini settings alignment
3. Workstream 3: Agent Learning via Cache
4. Workstream 5: MCP Server Best Practices
5. Workstream 6: CLI + Console Logging Upgrade
6. Workstream 7: Prompts & Schemas Alignment
7. Workstream 8: Jest Tests & Fixtures (no network; use fixtures)
8. Workstream 2: Exa Integration (flag-gated, execute last)

## Diagram Index (Gemini-Only Architecture)

- agents-gemini-only-v1: Orchestrator states (init → plan → search → read → analyze → synthesize → supervise → done/error)
- agent-io-concept-v1: Agent I/O contracts and types mapped to `src/types.ts`
- grounding-url-flow-v1: Google Search grounding → authority rank/dedupe → URL context → split → analyze → synthesize → supervise
- supervisor-repair-loop-v1: Supervisor review with at-most-one repair pass
- providers-config-graph-v1: `src/ai/providers.ts` baseConfig, env gates, cache, batch
- text-splitter-flow-v1: `src/ai/text-splitter.ts` semantic vs recursive, chunk bounds, policies
- mcp-schema-tools-v1: `src/mcp-server.ts` tools, I/O, progress events, error envelope
- contracts-json-schemas-v1: Outline/Sections/Summary/Verdict schemas + JSON enforcement
- progress-events-v1: `ResearchProgress` emission points and fields
- master-architecture-v1: End-to-end Gemini-only architecture; Exa optional (flag-gated)

These diagrams guide Workstreams 4, 5, and 7 acceptance and implementation.

## Workstream 1): Types Strengthening

- Objective: Centralize and harden types across modules using shared definitions + Zod inference.
- Files:
  - src/types.ts (add/centralize)
  - src/feedback.ts, src/deep-research.ts, src/mcp-server.ts, src/search/providers.ts, src/ai/providers.ts, src/output-manager.ts, src/progress-manager.ts
- Steps:
  1) In `src/types.ts`, add:
     - SearchHit, SearchProvider, ResearchOptions, ResearchProgress, AgentContext, AgentOutput, SupervisorVerdict, MCPResearchResult.
  2) Export Zod-inferred types from existing schemas where applicable (`z.infer`).
  3) Replace inline/duplicate types in the listed files with imports from `src/types.ts`.
  4) Align `systemPrompt()` model default with providers (`gemini-2.5-flash`).
- Acceptance:
  - All listed files compile with shared types; no TS6133 for centrally controlled env/model stragglers.
- Backout:
  - Revert per-file imports to previous inline types.
- Risks/Mitigation:
  - Drift: enforce single source in `src/types.ts`.

## Workstream 2): Exa Integration (Flag-Gated; Execute Last)

- Goal:
- Files:
  - `.env.example` (add flags/keys)
  - `src/search/exa.ts` (new, real provider wrapper)
  - `src/deep-research.ts` (provider selection glue; no dead code)
  - `src/types.ts` (add/confirm types for Exa results)
  - Add env flags to `.env.example`: `ENABLE_EXA_PRIMARY=false`, `EXA_API_KEY=`, `EXA_MAX_RESULTS=10`, `EXA_TIMEOUT_MS=15000`.
    - `search(query, { maxResults, timeoutMs }): Promise<SearchHit[]>`
    - Retries with backoff; bounded LRU cache with optional TTL; dedupe by URL.
    - If true, call Exa `search()` + `getContents()`; else use existing provider.
    - Normalize into shared `SearchHit[]` and content payloads used by analyzer.
  - Document rollout and backout in README and rules docs.
  - With `ENABLE_EXA_PRIMARY=false`, behavior identical to current pipeline.
  - No runtime TODO/stub code; all paths implemented and tested.
  - Set `ENABLE_EXA_PRIMARY=false`.
- Risks/Mitigation:
  - Provider differences: normalize fields and enforce shared types.
- Notes:
  - Do not remove Firecrawl until explicitly approved; Exa path is additive and gated by env.
  - Keep Google Search grounding via Gemini tools for augmentation/citations regardless of Exa flag.
  - Record Exa search/content timings, result counts, retries, and cache hits; redact keys.
## Workstream 3) Agent Learning (Flag-Gated; Execute First)
- Objective: Implement: Agent Learning via Cache
- Files:
  - `src/feedback.ts`, `src/deep-research.ts` (read/write integration)
  - `.env.example` (add flags)
- Checklist:
    - Types: `MemoryKey`, `MemoryRecord`.
    - API: `getSimilar(query: string, agent: string)`, `put(record: MemoryRecord)`, `prune()`.
    - Storage: in-memory LRU; optional JSONL persistence at `.cache/agent-memory.jsonl` behind `ENABLE_AGENT_LEARNING`.
  - Integrate reads:
    - In `src/deep-research.ts`, add past learnings/citations to context blocks (token-capped).
  - Integrate writes:
    - After successful outputs, store compact records (learnings, citations, final sections metadata).
- Acceptance:
  - With learning enabled, similar queries yield augmented context from prior records; with it disabled, behavior unchanged.
- Backout:
  - Disable flag; remove read/write call sites.
- Notes:
  - Summarize and cap stored content to avoid token spillover; prefer citations + learnings over raw text.
- Logs:
  - Record `agent-memory` events at INFO with counts (hits/misses, prunes) and sizes; redact content bodies.

## Workstream 4): Agent Separation + Supervisor

- Goal:
  - Implement functional, production-ready agent modules and orchestrator that execute the full pipeline with Gemini settings and supervisor validation. No scaffolds or TODO-only code.
- Files:
  - `src/agents/gatherer.ts`, `src/agents/analyzer.ts`, `src/agents/synthesizer.ts`, `src/agents/supervisor.ts`, `src/agents/orchestrator.ts`
  - `src/deep-research.ts` (delegate to orchestrator; retain compatibility entry)
  - `src/ai/providers.ts` (confirm Gemini settings, response schemas)
  - `src/types.ts` (shared agent interfaces)
- Checklist:
  - Gatherer: implement `gather(query, options)` that calls Gemini Google Search grounding + URL context only and returns `SearchHit[]` + normalized contents. Prepare Exa branch, but keep gated by `ENABLE_EXA_PRIMARY` (Workstream 2).
  - Analyzer: implement `analyze(chunks, context)` using batched Gemini calls with `responseSchema` and token caps; output structured analysis artifacts.
  - Synthesizer: implement `synthesize(analysis, context)` and `writeFinalReport()` producing the final structured paper (Abstract, ToC, Intro, Body, Methodology, Limitations, Key Learnings, References).
  - Supervisor: implement `review(report, evidence)` returning `SupervisorVerdict` with style/citation checks and optional patch suggestions; ensure JSON schema validation.
  - Orchestrator: implement `runResearch(input)` → orchestrates gather → analyze → synthesize → supervise; streams progress via `ResearchProgress`.
  - Wire `src/deep-research.ts` to call orchestrator while preserving current exports/CLI/MCP interfaces.
  - Ensure provider config (model id, responseMimeType/Schema) matches `src/ai/providers.ts` defaults.
- Acceptance:
  - Running CLI (`src/run.ts`) executes gather→analyze→synthesize→supervise and outputs a finalized, multi-page paper with sections: Abstract, Table of Contents, Introduction, Body, Methodology, Limitations, Key Learnings, References.
  - Minimum 2 citations per section; links formatted consistently; citations traceable to grounded URLs.
  - Authority threshold met: among 8–12 selected sources, at least 5 are high-scoring after dedupe/ranking (default AUTHORITY_THRESHOLD=0.6); EN-only; deny-list respected.
  - Gather/search path implements retries (exponential backoff, max 2 per call) and timeouts (per-call and overall deadline).
  - Supervisor enforces structure/tone/length/citations; at most one repair pass applied via synthesizer; returns OK or fail with reasons.
  - Progress events emitted at each phase with token counts, batch sizes, and timings; redact content bodies.
  - Gemini-only: `ENABLE_GEMINI_GOOGLE_SEARCH=true`; no Firecrawl; Exa behind `ENABLE_EXA_PRIMARY=false` until later workstream.
- Backout:
  - Revert `src/agents/*` and delegate back to existing monolithic flow in `src/deep-research.ts`.
- Notes:
  - Keep agent boundaries crisp; limit cross-module imports to shared `src/types.ts` and provider interfaces.
  - Ensure analyzer/supervisor requests use structured JSON schemas to avoid brittle parsing.
- Logs:
  - Emit phase timings (gather/analyze/synthesize/supervise), token counts, batch sizes; redact inputs.

## Workstream 5): MCP Server Best Practices

- Objective: Harden schemas, progress, health, and error envelopes.
- Files:
  - src/mcp-server.ts
  - src/types.ts
- Steps:
  1) Tighten tool input/output schemas via Zod; align with `MCPResearchResult`.
  2) Stream progress updates using `ResearchProgress` consistently.
  3) Add tools: `health` (returns ok, version), `server-info` (env gate statuses, no secrets), gated by `ENABLE_MCP_HEALTH` and `ENABLE_MCP_SERVER_INFO`.
  4) Standardize error format: code, message, details, timestamp.
- Acceptance:
  - Inputs/outputs validated via Zod; standardized error envelope { code, message, details, timestamp } returned on failures.
  - Progress events stream with fields appropriate to each phase (e.g., ts, phase, counts, durations); content redacted.
  - Tools registered and working when enabled: `health` and `server-info`; `server-info` reports env gate statuses (booleans only, no secrets or keys).
- Backout:
  - Revert schema tightening and tool registrations.
- Risks/Mitigation:
  - Consumer expectations: note changes in docs and keep backward-compatible shapes.

- Objective: Implement structured, pretty logs and consistent progress with a real logger.
- Files:
  - `src/output-manager.ts`, `src/progress-manager.ts`, `src/terminal-utils.ts`, `src/run.ts`, `src/logger.ts` (new)
- Steps:
{{ ... }}
  - src/prompt.ts, src/ai/providers.ts
- Steps:
  1) `validatePromptConsistency()`: convert throw to warn when “Schema Version” missing.
  2) Align model defaults: `systemPrompt()` uses `gemini-2.5-flash` to match providers.
  3) Keep responseMimeType/responseSchema set for analyzer/synthesizer/supervisor.
  - `responseMimeType: "application/json"` + `responseSchema` enforced in provider calls for analyzer/synthesizer/supervisor; schemas locked for Outline/Sections/Summary.
  - No spurious exceptions; consistent model naming (`gemini-2.5-flash`).
- Backout:
  - Revert warn back to strict throw if needed.
- Risks/Mitigation:
  - Hidden drift: add a CI lint to check required tokens in templates later.

## Workstream 6): Jest Tests & Fixtures (Preparation)

- Objective: Plan ESM Jest setup and key tests (no commands run here).
  - jest.config.ts, package.json (scripts), tests under src/**.test.ts
  1) Plan Jest config (ts-jest ESM): preset `ts-jest/presets/default-esm`, transform `{"^.+\\.ts$": ["ts-jest", { useESM: true }]}`, extensionsToTreatAsEsm `[".ts"]`, testEnvironment `node`.
  3) Add `src/deep-research.test.ts` using recorded fixtures for provider outputs (no network); verify `conductResearch()` pipeline assembly; snapshot final report.
- Acceptance:
- Backout:
- Risks/Mitigation:



- [ ] Env flags documented in `.env.example`.
- [ ] Grounding enabled and gated (ENABLE_GEMINI_GOOGLE_SEARCH=true); progress bodies redacted (PROGRESS_REDACT_BODIES=true).
----------

## Backout Plan (Global)

- Disable flags: `ENABLE_EXA_PRIMARY=false`, `ENABLE_AGENT_LEARNING=false`.
- Remove agent-memory write calls; keep read-only enrichment or disable entirely.
- Revert MCP schema/tool additions if clients break.
- Retain previous console/logging implementation.

## Notes

----------

- Exa is optional and not implemented in this phase. All Exa references are docs/TODOs.
- Keep `.env.example` synced whenever flags change.

----------

## Logs (fill during execution)
----------

- 2025-08-11 08:44 ET: Plan authored, reviewed.
- …

----------

- Logs go above this line.
