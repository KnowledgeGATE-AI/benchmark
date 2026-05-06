# Plan: Comment Out UGC NET Rank Predictor Hero Component

## Summary
Comment out the `NetResultPredictorHero` component from the hero carousel to temporarily hide the UGC NET Result Predictor from all users.

## File to Modify
`frontend/app/components/general/FilteredHeroCarousel.tsx`

## Changes

### 1. Comment out the import (line 5)
```typescript
// import NetResultPredictorHero from "./NetResultPredictorHero";
```

### 2. Comment out the hero configuration entry (line 42)
```typescript
// NET Result Predictor - temporarily disabled
// { component: NetResultPredictorHero, target: null, id: "net-result-predictor" },
```

## Verification
1. Run TypeScript check: `pnpm --filter frontend tsc --noEmit`
2. Start frontend dev server and verify the hero carousel no longer shows the UGC NET Result Predictor
3. Verify other heroes still display correctly in the carousel
