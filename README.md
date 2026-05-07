# KG AI Benchmark

A React + TypeScript playground for benchmarking LLMs hosted in LM Studio, OpenRouter, or any
OpenAI-compatible runtime. The project now ships with a full dashboard, profile management,
diagnostics workflow, and an embedded 100-question GATE PYQ dataset so you can launch end-to-end
evaluations without additional scaffolding.

## Features

- ⚡️ Vite-powered React 19 + TypeScript setup with strict linting
- 🧭 Tabbed dashboard (Dashboard · Profiles · Runs · Run Detail) powered by a shared benchmark context
- 🧪 Level 1/Level 2 diagnostics against LM Studio/OpenRouter servers with JSON-mode fallback and log history
- 📋 Question selector with filter/search + evaluation engine for MCQ/MSQ/NAT/TRUE_FALSE question types
- 📊 Recharts-based analytics (accuracy vs latency trends, pass/fail vs latency, KPI tiles)

## Getting started

```bash
npm install
npm run dev
```

The development server runs at [http://localhost:5173](http://localhost:5173).

## Available scripts

| Script        | Description                                      |
| ------------- | ------------------------------------------------ |
| `npm run dev` | Start the Vite development server                |
| `npm run lint`| Run ESLint with the configured TypeScript rules  |
| `npm run build`| Type-check and build the production bundle      |
| `npm run preview`| Preview the production build locally         |

## OpenRouter configuration

Profiles that target OpenRouter need the public API endpoint plus an API key. Optionally set headers
so OpenRouter can attribute requests to your app:

```bash
VITE_OPENROUTER_SITE_URL=https://your-app.example
VITE_OPENROUTER_APP_TITLE=KG AI Benchmark
```

After restarting the dev server, choose the **OpenRouter** transport in the profile form, accept the
suggested base URL (`https://openrouter.ai/api/v1`), and paste your key. The **Load models** action
calls `/v1/models` so you can select an available hosted model without manual typing.

## Usage workflow

1. **Create a profile** – open the Profiles tab, click “New profile”, pick the transport, and enter
   the base URL plus model details. Use LM Studio for local hosts (e.g., `http://127.0.0.1:1234`), or
   select OpenRouter with `https://openrouter.ai/api/v1` and your API key.
2. **Run diagnostics** – execute Level 1 (handshake) then Level 2 (readiness). The UI records logs,
   flags JSON-mode fallbacks, and blocks benchmarks until readiness passes.
3. **Launch a benchmark** – switch to the Runs tab, click “New run”, filter/select questions from the
   embedded PYQ dataset, and start the run. Progress streams live; results persist to Supabase so you
   can pick up on any device.
4. **Analyze results** – open any run to inspect accuracy, latency, token usage, and per-question
   responses/explanations. Dashboard trend lines summarize the most recent completions.

## Roadmap

1. Harden Supabase schemas/policies (per-user scoping, migrations) and backfill analytics views.
2. Add cancellation controls, progress indicators, and screenshot/export helpers.
3. Extend evaluation to descriptive/FILL_BLANK questions with rubric scoring.
4. Support dataset import/export to drive custom benchmark suites.

## License

MIT License © 2025 Complete Coding with Prashant Sir
