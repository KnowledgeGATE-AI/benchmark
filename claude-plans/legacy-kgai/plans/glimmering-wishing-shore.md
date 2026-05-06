# Plan: Fix Overlapping Labels in Question Type Charts

## Context

In the GATE rank predictor individual attempt page, the "Question Type Analysis" section shows three vertical bar charts (MCQ, NAT, MSQ). Each chart has:
1. A Recharts `<Legend verticalAlign="bottom" height={36} />` rendered **inside** the SVG — showing e.g. "■ Scored Marks (+39.33)"
2. A `<p>` tag rendered **below** the chart div — showing e.g. "Scored: +39.33 / 51.00 (77.1%)"

These two elements visually collide because the legend sits at the very bottom of the fixed-height `div.h-64` container and the `<p>` has only `mt-2` clearance.

## Root Cause

The `<Legend>` and the `<p>` tag both display scoring information — they're redundant. The `<Legend>` is inside the SVG viewport's bottom margin (`bottom: 5`), so it bleeds into the space right above the `<p>`.

## Fix

**Remove the `<Legend>` from the three Question Type `BarChart` instances** (lines 282, 344, and similarly for GA/Aptitude sections in the same file). The `<p>` tag below each chart already shows the most useful summary (`Scored / Total (%)`) — keeping both is redundant and causes the overlap.

This approach:
- Eliminates the overlap entirely
- Gives bars more vertical breathing room in the `h-64` container
- Preserves the informative `<p>` summary text

## File to Modify

`frontend/app/components/gate-rank-predictor/MarksAnalysis.tsx`

### Changes

Remove `<Legend verticalAlign="bottom" height={36} />` from:
1. **Line 282** — the Question Type map (`{Object.entries(marksByCategory.types).map(...)}`), three charts for MCQ/NAT/MSQ
2. **Line 344** — the Technical Subjects single chart
3. Any other single-bar vertical `BarChart` instances in the same file that follow this same pattern (GA/Aptitude sections ~lines 389, 451, 502)

The `<p>` tag below each chart (lines 304–317) already carries the full label, so removing `<Legend>` loses nothing.

## Verification

1. Run the frontend dev server: `pnpm --filter kg-portal-frontend dev`
2. Navigate to a student attempt page in the GATE rank predictor
3. Confirm the "Question Type Analysis" section shows MCQ/NAT/MSQ charts without any overlapping text
4. Confirm the summary "Scored: X / Y (Z%)" text below each chart is still visible and readable
