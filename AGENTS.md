# AGENTS.md - Benchmark

## Scope

This repository owns the KG AI Benchmark React + TypeScript application for
benchmarking local LLMs hosted in LM Studio, OpenRouter, or any
OpenAI-compatible runtime.

Keep edits inside the benchmark boundary:

- benchmark dashboard UI
- model profiles and diagnostics
- benchmark run orchestration
- embedded GATE PYQ dataset handling
- Supabase-backed benchmark state

Do not add KGAI product frontend/backend code here. Product web code belongs in
`frontend-main` or `admin/apps/frontend`; product APIs belong in `backend-main`
or `admin/apps/backend`; AI runtime infrastructure belongs in `ai-foundry`.

## Repo Family Rules

- `AGENTS.md` is the canonical agent guidance file for this repo.
- `CLAUDE.md` is only a shim to this file; do not duplicate rules there.
- Keep changes inside benchmark UI/data boundaries unless the task explicitly
  requires a coordinated sibling-repo change.
- Treat `KGAI` as frozen legacy reference, not an active product source.
- Do not commit secrets, raw production dumps, or local agent/session artifacts.
- Run focused local validation before using CI as confirmation.

## Architecture

- React 19 + TypeScript + Vite.
- Client-side benchmark state flows through `src/context/BenchmarkContext.tsx`.
- Profiles, diagnostics, and run history persist through Supabase.
- Static question and topology data live under `src/data/`.
- LM Studio/OpenAI-compatible calls live under `src/services/`.
- `@/` resolves to `src/`.

## Important Rules

- Respect `profile.metadata.supportsJsonMode` when sending chat completions.
- Keep diagnostics as the readiness gate before launching long benchmark runs.
- Normalize profile/run updates through the existing normalization helpers.
- Do not hardcode secrets or API keys; use environment variables.
- Keep Supabase schema/policy assumptions documented when changing persistence.

## Local-First Validation

Run focused checks locally before relying on GitHub Actions:

- `npm run lint`
- `npm run build`
- `npm run preview` when build output needs inspection

No standalone test suite is currently configured.

## Useful Commands

```bash
npm install
npm run dev
npm run lint
npm run build
npm run preview
```
