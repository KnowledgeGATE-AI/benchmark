# Plan: Restore GATE Rank Predictor Hero Component

## Context

The GATE Rank Predictor Hero (`RankPredictorHero.js`) existed in the original frontend but was deleted in commit `33fb48fcf` ("remove unused frontend components") during a cleanup. The user wants it restored as the **first slide** in the hero carousel.

All dependencies still exist: `AnimatedCounter.tsx`, the `sanchit-rank.webp` image, and the GATE rank predictor routes.

## Changes

### 1. Create `frontend/app/components/general/RankPredictorHero.tsx`

Restore from git history (`7a51b2f52:app/components/general/RankPredictorHero.js`) with these updates:
- Convert to TypeScript (add return type `React.ReactElement`)
- Update image path: `sanchit-rank.png` → `sanchit-rank.webp`
- Update year: `GATE-2025` → `GATE-2026`
- Fix Tailwind v4 classes: `bg-linear-to-r` → `bg-gradient-to-r` (if needed — verify which syntax the codebase uses)
- Add `"use client"` directive
- Add analytics `track()` call on CTA click (consistent with other heroes)

### 2. Edit `frontend/app/components/general/FilteredHeroCarousel.tsx`

- Add import: `import RankPredictorHero from "./RankPredictorHero";`
- Add as **first entry** in `heroComponents` array:
  ```ts
  { component: RankPredictorHero, target: TARGETS.GATE_PSU_NET, id: "gate-rank-predictor" }
  ```

## Files to Modify

| File | Action |
|------|--------|
| `frontend/app/components/general/RankPredictorHero.tsx` | **Create** — restored from git history, converted to TS |
| `frontend/app/components/general/FilteredHeroCarousel.tsx` | **Edit** — add import + first entry in hero array |

## Key Dependencies (all exist)

- `frontend/app/components/general/AnimatedCounter.tsx` — live GATE attempts counter
- `frontend/public/assets/images/sanchit-rank.webp` — hero image
- `/gate-rank-predictor` and `/student/gate-rank-predictor` — target routes

## Verification

1. Run `pnpm typecheck` — ensure no TS errors
2. Run `pnpm --filter kg-portal-frontend lint` — ensure no lint errors
3. Start dev server (`pnpm --filter kg-portal-frontend dev`) and verify:
   - GATE Rank Predictor hero appears as the **first slide** in the carousel
   - AnimatedCounter loads and animates
   - CTA links navigate to correct routes
   - Hero only shows for GATE_PSU_NET target (or interleaved when no target selected)
