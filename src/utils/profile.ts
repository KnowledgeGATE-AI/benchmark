import {
  BenchmarkStepConfig,
  ModelBinding,
  ModelProfile,
  ProfilePipelineStep,
} from '@/types/benchmark';
import {
  DEFAULT_PROFILE_PIPELINE,
  DEFAULT_TEXT_BINDING_ID,
  createDefaultTextBinding,
  defaultBenchmarkSteps,
  defaultSystemPrompt,
} from '@/data/defaults';
import createId from '@/utils/createId';

export interface LegacyProfileFields {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  temperature?: number;
  maxOutputTokens?: number;
  requestTimeoutMs?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  defaultSystemPrompt?: string;
}

const coalesce = <T>(...values: (T | undefined)[]): T | undefined => {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

export const extractLegacyFields = (
  candidate?: Partial<ModelProfile>,
  existing?: ModelProfile
): LegacyProfileFields => {
  const legacy: LegacyProfileFields = {};

  const directCandidate = candidate as Record<string, unknown> | undefined;
  const directExisting = existing as Record<string, unknown> | undefined;

  const candidateLegacy = candidate?.legacy ?? {};
  const existingLegacy = existing?.legacy ?? {};

  legacy.provider = coalesce(
    candidateLegacy.provider,
    (directCandidate?.provider as string | undefined),
    existingLegacy.provider,
    (directExisting?.provider as string | undefined)
  );

  legacy.baseUrl = coalesce(
    candidateLegacy.baseUrl,
    (directCandidate?.baseUrl as string | undefined),
    existingLegacy.baseUrl,
    (directExisting?.baseUrl as string | undefined)
  );

  legacy.apiKey = coalesce(
    candidateLegacy.apiKey,
    (directCandidate?.apiKey as string | undefined),
    existingLegacy.apiKey,
    (directExisting?.apiKey as string | undefined)
  );

  legacy.modelId = coalesce(
    candidateLegacy.modelId,
    (directCandidate?.modelId as string | undefined),
    existingLegacy.modelId,
    (directExisting?.modelId as string | undefined)
  );

  legacy.temperature = coalesce(
    candidateLegacy.temperature,
    (directCandidate?.temperature as number | undefined),
    existingLegacy.temperature,
    (directExisting?.temperature as number | undefined)
  );

  legacy.maxOutputTokens = coalesce(
    candidateLegacy.maxOutputTokens,
    (directCandidate?.maxOutputTokens as number | undefined),
    existingLegacy.maxOutputTokens,
    (directExisting?.maxOutputTokens as number | undefined)
  );

  legacy.requestTimeoutMs = coalesce(
    candidateLegacy.requestTimeoutMs,
    (directCandidate?.requestTimeoutMs as number | undefined),
    existingLegacy.requestTimeoutMs,
    (directExisting?.requestTimeoutMs as number | undefined)
  );

  legacy.topP = coalesce(
    candidateLegacy.topP,
    (directCandidate?.topP as number | undefined),
    existingLegacy.topP,
    (directExisting?.topP as number | undefined)
  );

  legacy.frequencyPenalty = coalesce(
    candidateLegacy.frequencyPenalty,
    (directCandidate?.frequencyPenalty as number | undefined),
    existingLegacy.frequencyPenalty,
    (directExisting?.frequencyPenalty as number | undefined)
  );

  legacy.presencePenalty = coalesce(
    candidateLegacy.presencePenalty,
    (directCandidate?.presencePenalty as number | undefined),
    existingLegacy.presencePenalty,
    (directExisting?.presencePenalty as number | undefined)
  );

  legacy.defaultSystemPrompt = coalesce(
    candidateLegacy.defaultSystemPrompt,
    (directCandidate?.defaultSystemPrompt as string | undefined),
    existingLegacy.defaultSystemPrompt,
    (directExisting?.defaultSystemPrompt as string | undefined)
  );

  return legacy;
};

export const inferProviderFromBinding = (binding?: ModelBinding): string | undefined => {
  if (!binding) {
    return undefined;
  }

  switch (binding.transport) {
    case 'openrouter':
      return 'OpenRouter';
    case 'openai-compatible':
      return 'OpenAI-compatible';
    case 'lmstudio':
    default:
      return 'LM Studio';
  }
};

const cloneBindingWithDefaults = (
  binding: Partial<ModelBinding> | undefined,
  legacy: LegacyProfileFields,
  existing?: ModelBinding
): ModelBinding => {
  const baseDefaults = createDefaultTextBinding();
  const source = binding ?? {};
  const id = source.id ?? existing?.id ?? createId();

  const capability = source.capability ?? existing?.capability ?? 'text-to-text';
  const transport = source.transport ?? existing?.transport ?? 'lmstudio';
  const fallbackSystemPrompt =
    legacy.defaultSystemPrompt ?? existing?.defaultSystemPrompt ?? baseDefaults.defaultSystemPrompt ?? defaultSystemPrompt;

  return {
    id,
    name: source.name ?? existing?.name ?? (capability === 'image-to-text' ? 'Vision model' : 'Text model'),
    capability,
    transport,
    baseUrl: source.baseUrl ?? existing?.baseUrl ?? legacy.baseUrl ?? baseDefaults.baseUrl,
    apiKey: source.apiKey ?? existing?.apiKey ?? legacy.apiKey,
    modelId: source.modelId ?? existing?.modelId ?? legacy.modelId ?? baseDefaults.modelId,
    temperature:
      source.temperature ?? existing?.temperature ?? legacy.temperature ?? baseDefaults.temperature,
    maxOutputTokens:
      source.maxOutputTokens ?? existing?.maxOutputTokens ?? legacy.maxOutputTokens ?? baseDefaults.maxOutputTokens,
    requestTimeoutMs:
      source.requestTimeoutMs ?? existing?.requestTimeoutMs ?? legacy.requestTimeoutMs ?? baseDefaults.requestTimeoutMs,
    topP: source.topP ?? existing?.topP ?? legacy.topP ?? baseDefaults.topP,
    frequencyPenalty:
      source.frequencyPenalty ?? existing?.frequencyPenalty ?? legacy.frequencyPenalty ?? baseDefaults.frequencyPenalty,
    presencePenalty:
      source.presencePenalty ?? existing?.presencePenalty ?? legacy.presencePenalty ?? baseDefaults.presencePenalty,
    defaultSystemPrompt: source.defaultSystemPrompt ?? fallbackSystemPrompt,
    notes: source.notes ?? existing?.notes,
    metadata: {
      supportsJsonMode:
        source.metadata?.supportsJsonMode ?? existing?.metadata?.supportsJsonMode ?? true,
    },
  };
};

const dedupeBindings = (bindings: ModelBinding[]): ModelBinding[] => {
  const seen = new Map<string, number>();
  return bindings.map((binding) => {
    const existingCount = seen.get(binding.id) ?? 0;
    seen.set(binding.id, existingCount + 1);

    if (existingCount === 0) {
      return binding;
    }

    return {
      ...binding,
      id: createId(),
    };
  });
};

export const ensureBindings = (
  candidate: Partial<ModelProfile>,
  existing: ModelProfile | undefined,
  legacy: LegacyProfileFields
): ModelBinding[] => {
  const incoming = Array.isArray(candidate.bindings) ? candidate.bindings : undefined;
  const base = incoming ?? existing?.bindings;

  if (base && base.length > 0) {
    const normalized = base.map((binding) => {
      const previous = existing?.bindings.find((item) => item.id === binding.id);
      return cloneBindingWithDefaults(binding, legacy, previous);
    });

    return dedupeBindings(normalized);
  }

  // Legacy fallback – build from legacy fields
  const textBinding = cloneBindingWithDefaults(
    {
      id: DEFAULT_TEXT_BINDING_ID,
      capability: 'text-to-text',
    },
    legacy,
    existing?.bindings.find((binding) => binding.capability === 'text-to-text')
  );

  return [textBinding];
};

export const normalizePipeline = (
  candidate: Partial<ModelProfile>,
  existing: ModelProfile | undefined,
  bindings: ModelBinding[]
): ProfilePipelineStep[] => {
  const pipelineSource = Array.isArray(candidate.pipeline)
    ? candidate.pipeline
    : existing?.pipeline ?? DEFAULT_PROFILE_PIPELINE;

  const textBinding = bindings.find((binding) => binding.capability === 'text-to-text');

  const normalized = pipelineSource.map((step, index) => {
    const bindingId = step.bindingId ?? null;
    const resolvedBinding = bindingId ? bindings.find((binding) => binding.id === bindingId) : undefined;
    const fallbackBindingId = step.capability === 'text-to-text' ? textBinding?.id ?? null : bindingId;

    return {
      id: step.id ?? createId(),
      label: step.label ?? `Pipeline step ${index + 1}`,
      capability: step.capability ?? 'text-to-text',
      bindingId: resolvedBinding ? resolvedBinding.id : fallbackBindingId,
      enabled: step.enabled ?? true,
    };
  });

  const hasTextStep = normalized.some((step) => step.capability === 'text-to-text');

  if (!hasTextStep) {
    normalized.push({
      id: createId(),
      label: 'Text reasoning',
      capability: 'text-to-text',
      bindingId: textBinding?.id ?? bindings[0]?.id ?? null,
      enabled: true,
    });
  }

  const uniqueIds = new Set<string>();
  return normalized.map((step) => {
    if (uniqueIds.has(step.id)) {
      return { ...step, id: createId() };
    }
    uniqueIds.add(step.id);
    return step;
  });
};

export const ensureTextBinding = (profile: ModelProfile): ModelBinding | undefined =>
  profile.bindings.find((binding) => binding.capability === 'text-to-text');

export const ensureImageBinding = (profile: ModelProfile): ModelBinding | undefined =>
  profile.bindings.find((binding) => binding.capability === 'image-to-text');

export const deriveLegacyFromBindings = (
  bindings: ModelBinding[],
  fallback?: LegacyProfileFields
): LegacyProfileFields => {
  const textBinding = bindings.find((binding) => binding.capability === 'text-to-text');
  const legacy: LegacyProfileFields = {
    provider: fallback?.provider ?? inferProviderFromBinding(textBinding),
    baseUrl: textBinding?.baseUrl ?? fallback?.baseUrl,
    apiKey: textBinding?.apiKey ?? fallback?.apiKey,
    modelId: textBinding?.modelId ?? fallback?.modelId,
    temperature: textBinding?.temperature ?? fallback?.temperature,
    maxOutputTokens: textBinding?.maxOutputTokens ?? fallback?.maxOutputTokens,
    requestTimeoutMs: textBinding?.requestTimeoutMs ?? fallback?.requestTimeoutMs,
    topP: textBinding?.topP ?? fallback?.topP,
    frequencyPenalty: textBinding?.frequencyPenalty ?? fallback?.frequencyPenalty,
    presencePenalty: textBinding?.presencePenalty ?? fallback?.presencePenalty,
    defaultSystemPrompt: textBinding?.defaultSystemPrompt ?? fallback?.defaultSystemPrompt,
  };

  return legacy;
};

export const normalizeBenchmarkSteps = (
  candidate?: BenchmarkStepConfig[],
  existing?: BenchmarkStepConfig[]
): BenchmarkStepConfig[] | undefined => {
  const source = candidate ?? existing;

  if (!source || source.length === 0) {
    return undefined;
  }

  const normalized = source
    .map((step, index) => {
      if (!step) {
        return null;
      }

      const fallback = defaultBenchmarkSteps[index];

      return {
        id: step.id ?? fallback?.id ?? `step-${index}`,
        label: step.label ?? fallback?.label ?? `Step ${index + 1}`,
        description: step.description ?? fallback?.description,
        promptTemplate: step.promptTemplate ?? fallback?.promptTemplate ?? '',
        enabled: step.enabled ?? fallback?.enabled ?? true,
      };
    })
    .filter(Boolean) as BenchmarkStepConfig[];

  if (
    normalized.length === defaultBenchmarkSteps.length &&
    normalized.every((step, index) => {
      const defaultStep = defaultBenchmarkSteps[index];
      return (
        step.id === defaultStep.id &&
        step.label === defaultStep.label &&
        step.description === defaultStep.description &&
        step.promptTemplate === defaultStep.promptTemplate &&
        step.enabled === defaultStep.enabled
      );
    })
  ) {
    return undefined;
  }

  return normalized;
};
