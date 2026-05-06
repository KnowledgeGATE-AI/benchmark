# Plan: Fix Vision Model 0 Tokens Output Issue

## Problem Summary
When processing images with vision models (Qwen3-VL-30B-A3B-Instruct-MLX-8bit), the benchmark shows:
- **Processing happens**: GPU is used, 3-7 seconds per image
- **0 tokens captured**: All results show "0 tokens"
- **TTFT captured**: Time-to-first-token metrics are recorded (3.31s P50, 6.59s P95)

## Root Cause Analysis

### Data Flow Trace
```
edu-processor.ts → ai-client.ts → Server chat.ts → tool-orchestrator.ts → vllm-client.ts → vLLM-MLX
```

### The Bug Location: `tool-orchestrator.ts` lines 301-307

```typescript
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  if (delta?.content) {  // ← BUG: Only yields if delta.content exists
    assistantContent += delta.content;
    yield { type: 'chunk', data: chunk };
  }
  // Tool call handling...
}
```

### Why This Causes 0 Tokens for Vision Models

1. **Vision models use SimpleEngine** (not BatchedEngine with continuous batching)
2. **SimpleEngine doesn't stream incrementally** - it processes the entire image, then returns the full response
3. **The final chunk** may have:
   - `finish_reason: 'stop'` with empty `delta.content`
   - Or content in a different structure than `delta.content`
4. **Content is never captured** → `content.length = 0` → `tokens = Math.ceil(0/4) = 0`

### Supporting Evidence
- `vllm-process-manager.ts:191-206`: Confirms vision models use SimpleEngine
- `edu-processor.ts:9-14`: Documents this limitation
- The TTFT is captured (3-7s) because the loop runs, but no content chunks match the condition

## Fix Strategy

### Option A: Log and Diagnose First (Recommended)
Add debug logging to understand the actual chunk structure, then fix based on real data.

### Option B: Handle Non-Streaming Responses
Modify the orchestrator to accumulate content from all chunks regardless of structure.

## Implementation Plan (Debug-First Approach)

### Step 1: Add Debug Logging (CURRENT STEP)
**Files to modify:**
- `local-ai/server/src/services/tool-orchestrator.ts` - Server-side streaming
- `local-ai/ui/src/lib/ai-client.ts` - Client-side SSE parsing

**Server-side logging:**
```typescript
// In orchestrateStream, inside the stream loop
for await (const chunk of stream) {
  // DEBUG: Log ALL chunks to understand structure
  console.log('[orchestrateStream] Raw chunk:', JSON.stringify(chunk));

  const delta = chunk.choices[0]?.delta;
  // Also log the delta specifically
  console.log('[orchestrateStream] Delta:', JSON.stringify(delta));
  console.log('[orchestrateStream] Has content:', !!delta?.content);

  // ... existing logic
}
```

**Client-side logging:**
```typescript
// In chatCompletionStream, after parsing each event
console.log('[ai-client] Parsed event:', data);
console.log('[ai-client] Content found:', parsed.choices?.[0]?.delta?.content);
```

### Step 2: Run Test and Collect Logs
1. Start LocalAI with vision model
2. Process one image
3. Check server console for chunk structure
4. Check browser console for SSE events

### Step 3: Fix Based on Actual Data
Based on typical OpenAI-compatible streaming behavior, the fix should:

**Option 2A**: Always yield chunks regardless of content (let client decide)
```typescript
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;

  // Yield ALL chunks to the client, not just content ones
  yield { type: 'chunk', data: chunk };

  if (delta?.content) {
    assistantContent += delta.content;
  }
  // ... tool call handling
}
```

**Option 2B**: Check for content in multiple locations
```typescript
for await (const chunk of stream) {
  const choice = chunk.choices[0];
  const delta = choice?.delta;

  // Content can come from delta.content OR final message
  const content = delta?.content ||
                  (choice?.message as { content?: string })?.content;

  if (content) {
    assistantContent += content;
    yield { type: 'chunk', data: chunk };
  }
  // ...
}
```

### Step 3: Also Fix Client-Side Token Counting
**File:** `local-ai/ui/src/lib/ai-client.ts` (lines 359-363)

The client-side already looks for `parsed.choices?.[0]?.delta?.content`, so if the server yields all chunks properly, this should work.

However, we should also handle the final chunk format:
```typescript
// In chatCompletionStream
const content = parsed.choices?.[0]?.delta?.content ||
                parsed.choices?.[0]?.message?.content;
if (content) {
  yield { type: 'content', content };
}
```

## Files to Modify

| File | Change |
|------|--------|
| `local-ai/server/src/services/tool-orchestrator.ts` | Fix streaming content capture |
| `local-ai/ui/src/lib/ai-client.ts` | Handle alternate response formats |

## Verification

1. Start LocalAI server with vision model
2. Upload a test image in Edu Analyzer
3. Check:
   - Content is returned in the result panel
   - Token count > 0
   - TPS (tokens/second) shows meaningful value

## Alternative Hypothesis

If the fix above doesn't work, the issue might be deeper:
- vLLM-MLX with SimpleEngine might not support streaming at all
- In that case, we'd need to use non-streaming completions for vision models

This can be checked by testing `stream: false` in the request.
