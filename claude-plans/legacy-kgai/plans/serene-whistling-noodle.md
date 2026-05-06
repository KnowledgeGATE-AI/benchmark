# TECH-260: Rank Predictor marks evaluation not showing

## Context

Learners from MT (Metallurgical Engineering) and some CS branches cannot see their marks in the Rank Predictor. MT attempts are stuck at "response-parsed" status with "No marks information available". The admin "Reprocess Filtered" button also doesn't fix it.

**Root causes identified (3 bugs):**

### Bug 1: Reprocess corrupts attempt data (CRITICAL)
**File:** `backend/controllers/rankPredictorController.ts:1464-1471`

When reprocessing, the code resets `year=2026` and `subject="TEMP"` before re-fetching the URL. If the URL re-fetch fails (CDN timeout, network issue), the attempt is left with corrupted year/subject and can never be found by subject-based filters again. Even when re-fetch succeeds, this forces an unnecessary full re-parse cycle.

```typescript
// Current (broken):
attempt.status = "pending";
attempt.year = 2026;              // ← hardcoded, corrupts data on failure
attempt.subject = "TEMP";         // ← hardcoded, corrupts data on failure
attempt.candidateInfo = undefined;
attempt.answers = undefined;
attempt.evaluation = undefined;
```

### Bug 2: Answer key cache not invalidated after update
**File:** `backend/controllers/rankPredictorController.ts:2129-2147`

When admin updates an answer key (`updateAnswersInKey`), the in-memory `answerKeyCache` is not invalidated. The cache TTL is 60s. The immediately-triggered reprocess job may read the stale (blank) answer key from cache, causing evaluation to fail silently.

### Bug 3: Dead code + confusing status assignment
**File:** `backend/controllers/rankPredictorController.ts:1373-1375`

```typescript
Date.now();                        // ← dead code, result discarded
attempt.evaluation = evaluation;
attempt.status = "response-parsed"; // ← redundant, already this status
```

## Plan

### Step 1: Fix reprocess to not corrupt data

**File:** `backend/controllers/rankPredictorController.ts` — `processAttemptsInBackground()`

Change the reprocess loop to only clear evaluation and re-evaluate, NOT reset to "pending" with hardcoded values:

```typescript
// Fixed:
for (const attempt of attempts) {
  try {
    // Clear only evaluation — preserve parsed data (year, subject, answers, candidateInfo)
    attempt.evaluation = undefined;
    await attempt.save();

    // processAttempt will enter the non-pending branch (line 1287),
    // fetch the answer key for the correct year/subject, and evaluate
    await processAttempt(attempt as unknown as GateAttemptDocument);
    ...
```

This works because `processAttempt` already handles the case where `status !== "pending"` (line 1287): it fetches the answer key for `attempt.year`/`attempt.subject` and evaluates. The `evaluation.evaluatedAt > answerKey.updatedAt` early-return check (line 1290-1293) is bypassed since evaluation is cleared.

### Step 2: Invalidate answer key cache after update

**File:** `backend/controllers/rankPredictorController.ts` — `updateAnswersInKey()`

After saving the updated answer key (line 2131), invalidate the cache entry:

```typescript
await answerKey.save();

// Invalidate cache so reprocess picks up the updated key
const cacheKey = `${answerKey.year}:${answerKey.subject}`;
answerKeyCache.delete(cacheKey);
```

### Step 3: Clean up dead code

**File:** `backend/controllers/rankPredictorController.ts:1373-1375`

Remove the dead `Date.now()` call. Keep the status assignment as-is (it's technically redundant but documents the expected state).

```typescript
if (evaluation) {
  attempt.evaluation = evaluation;
  attempt.status = "response-parsed";
  await attempt.save();
}
```

### Step 4: Write investigation script for MT answer keys

**File:** `backend/scripts/investigate-tech260.ts` (new)

Script to check:
1. Which GateAnswerKey records exist for MT subject, and whether `answersLastUpdatedAt` is null (meaning no admin has uploaded answers)
2. Count of MT attempts stuck at "response-parsed" with no evaluation
3. Count of attempts with corrupted year=2026/subject="TEMP" from failed reprocesses
4. For the specific CS learners (affected user IDs from the task), check why their evaluation failed (question ID mismatch?)

This will tell us whether the MT issue is purely a missing answer key (admin action needed) or a code bug.

### Step 5: Update tests

**File:** `backend/test/rankPredictorController.edge.test.ts`

- Add test: reprocess preserves year/subject/answers (doesn't corrupt data)
- Add test: answer key cache is invalidated after `updateAnswersInKey`
- Add test: reprocess with already-parsed attempt re-evaluates correctly

## Files to Modify

| File | Change |
|------|--------|
| `backend/controllers/rankPredictorController.ts` | Fix reprocess loop, invalidate cache, remove dead code |
| `backend/test/rankPredictorController.edge.test.ts` | Add tests for fixed behavior |
| `backend/scripts/investigate-tech260.ts` | New investigation script |

## Verification

1. Run investigation script to determine MT answer key state
2. Run existing rank predictor tests: `pnpm --filter kg-portal-backend test -- rankPredictorController`
3. Typecheck: `pnpm typecheck`
4. Lint: `pnpm lint`
5. Manual verification: Use admin test token to hit the reprocess endpoint for an MT attempt and confirm evaluation is applied
