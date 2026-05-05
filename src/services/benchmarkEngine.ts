import {
  BenchmarkAttempt,
  BenchmarkAttemptEvaluation,
  BenchmarkAttemptStepResult,
  BenchmarkModelResponse,
  BenchmarkRun,
  BenchmarkRunMetrics,
  BenchmarkQuestion,
  BenchmarkTopologyPrediction,
  ModelProfile,
  ImageSummary,
} from '@/types/benchmark';
import { sendChatCompletion, type ChatCompletionMessage } from '@/services/lmStudioClient';
import {
  evaluateModelAnswer,
  evaluateTopologyPrediction,
  parseModelResponse,
  parseTopologySubjectPrediction,
  parseTopologyTopicPrediction,
  parseTopologySubtopicPrediction,
} from '@/services/evaluation';
import { createEmptyRunMetrics, defaultBenchmarkSteps } from '@/data/defaults';
import { questionTopology } from '@/data/topology';
import createId from '@/utils/createId';
import { preprocessQuestionImages } from '@/services/imagePreprocessor';
import { ensureTextBinding } from '@/utils/profile';

/**
 * Builds question context FOR REFERENCE ONLY - without answer format instructions.
 * Used for topology classification where we don't want to confuse the model with answer format.
 */
const formatImageSummariesBlock = (imageSummaries?: ImageSummary[]): string[] => {
  if (!imageSummaries || imageSummaries.length === 0) {
    return [];
  }

  const header = 'Image summaries (preprocessed):';
  const lines = imageSummaries.map((summary, index) => {
    const segments: string[] = [];
    segments.push(summary.image.source.toUpperCase());
    if (typeof summary.image.optionIndex === 'number') {
      segments.push(`option ${summary.image.optionIndex + 1}`);
    }
    const statusLabel = summary.status !== 'ok' ? `${summary.status.toUpperCase()}: ` : '';
    const text = summary.text ?? '(no OCR text available)';
    return `${index + 1}. [${segments.join(' ')}] — ${statusLabel}${text}`;
  });

  return [header, ...lines];
};

const stripMarkdownImages = (text: string): string => {
  // Remove markdown image syntax: ![alt](url)
  return text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '').trim();
};

const buildSimpleQuestionContext = (
  question: BenchmarkQuestion,
  imageSummaries?: ImageSummary[]
) => {
  const lines: string[] = [];
  // Strip markdown images from prompt if we have image summaries
  const promptText = imageSummaries && imageSummaries.length > 0
    ? stripMarkdownImages(question.prompt)
    : question.prompt;
  lines.push(`Question (${question.type}): ${promptText}`);

  if (question.instructions) {
    const instructionsText = imageSummaries && imageSummaries.length > 0
      ? stripMarkdownImages(question.instructions)
      : question.instructions;
    lines.push(`Instructions: ${instructionsText}`);
  }

  if (question.options.length > 0) {
    lines.push('');
    lines.push('Options:');
    question.options.forEach((option, index) => {
      const label = String.fromCharCode(65 + index);
      const optionText = imageSummaries && imageSummaries.length > 0
        ? stripMarkdownImages(option.text)
        : option.text;
      lines.push(`${label}. ${optionText}`);
    });
  }

  const imageBlock = formatImageSummariesBlock(imageSummaries);
  if (imageBlock.length > 0) {
    lines.push('');
    lines.push(...imageBlock);
  }

  return lines.join('\n');
};

/**
 * Builds full question context WITH answer format instructions.
 * Used for answer step where we need the model to return answer, explanation, confidence.
 */
const buildQuestionContext = (question: BenchmarkQuestion, imageSummaries?: ImageSummary[]) => {
  const lines: string[] = [];
  // Strip markdown images from prompt if we have image summaries
  const promptText = imageSummaries && imageSummaries.length > 0
    ? stripMarkdownImages(question.prompt)
    : question.prompt;
  lines.push(`Question (${question.type}): ${promptText}`);

  if (question.instructions) {
    const instructionsText = imageSummaries && imageSummaries.length > 0
      ? stripMarkdownImages(question.instructions)
      : question.instructions;
    lines.push(`Instructions: ${instructionsText}`);
  }

  if (question.options.length > 0) {
    lines.push('');
    lines.push('Options:');
    question.options.forEach((option, index) => {
      const label = String.fromCharCode(65 + index);
      const optionText = imageSummaries && imageSummaries.length > 0
        ? stripMarkdownImages(option.text)
        : option.text;
      lines.push(`${label}. ${optionText}`);
    });
  }

  lines.push('');
  lines.push(
    'Return JSON with keys `answer`, `explanation`, and `confidence` (0-1). For multiple answers, join option letters using commas - e.g., "A,C".'
  );

  if (question.type === 'NAT' && question.answer.kind === 'numeric') {
    if (question.answer.range.min != null && question.answer.range.max != null) {
      lines.push(
        `Numeric tolerance: [${question.answer.range.min}, ${question.answer.range.max}] (precision ${question.answer.range.precision ?? 'unspecified'}).`
      );
    }
  }

  const imageBlock = formatImageSummariesBlock(imageSummaries);
  if (imageBlock.length > 0) {
    lines.push('');
    lines.push(...imageBlock);
  }

  return lines.join('\n');
};

// Removed - we now pass only essential context inline instead of dumping all previous outputs

const applyTemplateReplacements = (template: string, replacements: Record<string, string>) => {
  return Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    template
  );
};

const buildStepPrompt = (
  question: BenchmarkQuestion,
  stepId: string,
  stepTemplate: string,
  previousSteps: BenchmarkAttemptStepResult[],
  imageSummaries?: ImageSummary[]
) => {
  const simpleContext = buildSimpleQuestionContext(question, imageSummaries);
  const questionReference = '\n---\nQUESTION FOR REFERENCE:\n' + simpleContext;
  const fullQuestionContext = buildQuestionContext(question, imageSummaries);

  const subjectCatalog = questionTopology
    .map((subject) => `- ${subject.id} :: ${subject.name}`)
    .join('\n');

  const getSubjectPrediction = () =>
    previousSteps
      .slice()
      .reverse()
      .find((step) => step.id === 'topology-subject')?.topologyPrediction;

  const getTopicPrediction = () =>
    previousSteps
      .slice()
      .reverse()
      .find((step) => step.id === 'topology-topic')?.topologyPrediction;

  const getSubtopicPrediction = () =>
    previousSteps
      .slice()
      .reverse()
      .find((step) => step.id === 'topology-subtopic')?.topologyPrediction;

  if (stepId === 'topology-subject') {
    const replacements: Record<string, string> = {
      '{{subjectCatalog}}': subjectCatalog,
      '{{questionContext}}': questionReference,
      '{{previousStepOutputs}}': '', // Not needed for first step
    };

    return applyTemplateReplacements(stepTemplate, replacements).trim();
  }

  if (stepId === 'topology-topic') {
    const subjectPrediction = getSubjectPrediction();
    const subjectId = subjectPrediction?.subjectId;
    const subject = questionTopology.find((item) => item.id === (subjectId ?? ''));

    const selectedSubject = subjectId
      ? `${subjectId} (${subject?.name ?? 'Unknown subject'})`
      : 'unknown (no valid subject identified)';

    const topicCatalog = subject
      ? subject.topics.map((topic) => `- ${topic.id} :: ${topic.name}`).join('\n')
      : questionTopology
          .flatMap((item) =>
            item.topics.map((topic) => `- ${topic.id} :: ${topic.name} [subject: ${item.name}]`)
          )
          .join('\n');

    const topicGuidance = subject
      ? 'Focus on the topics listed for this subject. If none seem to match perfectly, pick the closest topic and lower the confidence.'
      : 'Subject prediction was missing or not recognized. Review the catalog carefully and choose the topic whose description best fits the question; use a low confidence if uncertain.';

    const replacements: Record<string, string> = {
      '{{selectedSubject}}': selectedSubject,
      '{{topicCatalog}}': topicCatalog || 'No topics were found for the predicted subject.',
      '{{topicGuidance}}': topicGuidance,
      '{{questionContext}}': questionReference,
      '{{previousStepOutputs}}': '', // Only essential context is in selectedSubject
    };

    return applyTemplateReplacements(stepTemplate, replacements).trim();
  }

  if (stepId === 'topology-subtopic') {
    const subjectPrediction = getSubjectPrediction();
    const topicPrediction = getTopicPrediction();

    const subjectId = subjectPrediction?.subjectId;
    const topicId = topicPrediction?.topicId;

    const subject = questionTopology.find((item) => item.id === (subjectId ?? ''));
    const topic = subject?.topics.find((item) => item.id === (topicId ?? ''));

    const selectedSubject = subjectId
      ? `${subjectId} (${subject?.name ?? 'Unknown subject'})`
      : 'unknown (no valid subject identified)';

    const selectedTopic = topicId
      ? `${topicId} (${topic?.name ?? 'Unknown topic'})`
      : 'unknown (no valid topic identified)';

    let subtopicCatalog = '';
    if (topic && topic.subtopics.length > 0) {
      subtopicCatalog = topic.subtopics.map((sub) => `- ${sub.id} :: ${sub.name}`).join('\n');
    } else if (subject) {
      const allSubtopics = subject.topics.flatMap((t) =>
        t.subtopics.map((sub) => `- ${sub.id} :: ${sub.name} [topic: ${t.name}]`)
      );
      subtopicCatalog =
        allSubtopics.join('\n') || 'No subtopics are defined for this subject and topic.';
    } else {
      const allSubtopics = questionTopology.flatMap((s) =>
        s.topics.flatMap((t) =>
          t.subtopics.map((sub) => `- ${sub.id} :: ${sub.name} [${s.name} › ${t.name}]`)
        )
      );
      subtopicCatalog =
        allSubtopics.join('\n') || 'No subtopics are available in the taxonomy data.';
    }

    const subtopicGuidance =
      topic && topic.subtopics.length > 0
        ? 'Choose the subtopic that best matches the question. If none fit perfectly, pick the closest option and lower the confidence.'
        : 'The selected topic does not list explicit subtopics. Choose the closest available ID from the broader catalog and return a low confidence if unsure.';

    const replacements: Record<string, string> = {
      '{{selectedSubject}}': selectedSubject,
      '{{selectedTopic}}': selectedTopic,
      '{{subtopicCatalog}}': subtopicCatalog,
      '{{subtopicGuidance}}': subtopicGuidance,
      '{{questionContext}}': questionReference,
      '{{previousStepOutputs}}': '', // Only essential context is in selectedSubject and selectedTopic
    };

    return applyTemplateReplacements(stepTemplate, replacements).trim();
  }

  // For answer step and others: Build simple topology context
  const subjectPrediction = getSubjectPrediction();
  const topicPrediction = getTopicPrediction();
  const subtopicPrediction = getSubtopicPrediction();

  const subjectId = subjectPrediction?.subjectId;
  const topicId = topicPrediction?.topicId;
  const subtopicId = subtopicPrediction?.subtopicId;

  const subject = questionTopology.find((item) => item.id === (subjectId ?? ''));
  const topic = subject?.topics.find((item) => item.id === (topicId ?? ''));
  const subtopic = topic?.subtopics.find((item) => item.id === (subtopicId ?? ''));

  const topologyContext = [
    subjectId ? `Subject: ${subject?.name ?? subjectId}` : null,
    topicId ? `Topic: ${topic?.name ?? topicId}` : null,
    subtopicId ? `Subtopic: ${subtopic?.name ?? subtopicId}` : null,
  ].filter(Boolean).join('\n');

  const fullContext = fullQuestionContext;
  const replacements: Record<string, string> = {
    '{{previousStepOutputs}}': topologyContext || '', // Only show subject/topic/subtopic names
    '{{questionContext}}': questionReference,
  };
  const renderedInstructions = applyTemplateReplacements(stepTemplate, replacements);
  const sections = [fullContext, renderedInstructions];

  if (question.type === 'NAT' && question.answer.kind === 'numeric') {
    if (question.answer.range.min != null && question.answer.range.max != null) {
      sections.push(
        `Numeric tolerance: [${question.answer.range.min}, ${question.answer.range.max}] (precision ${question.answer.range.precision ?? 'unspecified'}).`
      );
    } else if (question.answer.acceptedAnswers.length > 0) {
      sections.push(`Accepted numeric answers: ${question.answer.acceptedAnswers.join(', ')}`);
    }
  }

  return sections.filter(Boolean).join('\n\n').trim();
};

const aggregateMetrics = (attempts: BenchmarkAttempt[]): BenchmarkRunMetrics => {
  if (attempts.length === 0) {
    return createEmptyRunMetrics();
  }

  const passedCount = attempts.filter((attempt) => attempt.evaluation.passed).length;
  const totalLatencyMs = attempts.reduce((acc, attempt) => acc + attempt.latencyMs, 0);
  const failedCount = attempts.length - passedCount;
  const topologyEvaluations = attempts.filter((attempt) => attempt.topologyEvaluation);
  const topologyPassedCount = topologyEvaluations.filter(
    (attempt) => attempt.topologyEvaluation?.passed
  ).length;
  const topologyFailedCount = topologyEvaluations.length - topologyPassedCount;

  let subjectComparisons = 0;
  let subjectMatches = 0;
  let topicComparisons = 0;
  let topicMatches = 0;
  let subtopicComparisons = 0;
  let subtopicMatches = 0;

  topologyEvaluations.forEach((attempt) => {
    const metrics = attempt.topologyEvaluation?.metrics;
    if (!metrics) {
      return;
    }

    if (metrics.subjectExpected) {
      subjectComparisons += 1;
      if (metrics.subjectMatch) {
        subjectMatches += 1;
      }
    }

    if (metrics.topicExpected) {
      topicComparisons += 1;
      if (metrics.topicMatch) {
        topicMatches += 1;
      }
    }

    if (metrics.subtopicExpected) {
      subtopicComparisons += 1;
      if (metrics.subtopicMatch) {
        subtopicMatches += 1;
      }
    }
  });

  const topologySubjectAccuracy =
    subjectComparisons > 0 ? subjectMatches / subjectComparisons : 0;
  const topologyTopicAccuracy = topicComparisons > 0 ? topicMatches / topicComparisons : 0;
  const topologySubtopicAccuracy =
    subtopicComparisons > 0 ? subtopicMatches / subtopicComparisons : 0;

  return {
    passedCount,
    failedCount,
    totalLatencyMs,
    accuracy: passedCount / attempts.length,
    averageLatencyMs: totalLatencyMs / attempts.length,
    topologyPassedCount,
    topologyFailedCount,
    topologyAccuracy:
      topologyEvaluations.length > 0 ? topologyPassedCount / topologyEvaluations.length : 0,
    topologySubjectAccuracy,
    topologySubjectPassedCount: subjectMatches,
    topologySubjectFailedCount: subjectComparisons - subjectMatches,
    topologyTopicAccuracy,
    topologyTopicPassedCount: topicMatches,
    topologyTopicFailedCount: topicComparisons - topicMatches,
    topologySubtopicAccuracy,
    topologySubtopicPassedCount: subtopicMatches,
    topologySubtopicFailedCount: subtopicComparisons - subtopicMatches,
  };
};

export interface BenchmarkExecutionOptions {
  profile: ModelProfile;
  questions: BenchmarkQuestion[];
  run: BenchmarkRun;
  onQuestionStart?: (question: BenchmarkQuestion, index: number) => void;
  onProgress?: (attempt: BenchmarkAttempt, progress: number, metrics: BenchmarkRunMetrics) => void;
  signal?: AbortSignal;
}

export const executeBenchmarkRun = async ({
  profile,
  questions,
  run,
  onQuestionStart,
  onProgress,
  signal,
}: BenchmarkExecutionOptions): Promise<BenchmarkRun> => {
  const startedAt = new Date();
  const attempts: BenchmarkAttempt[] = [];
  const imagePipelineStep = profile.pipeline?.find(
    (step) => step.capability === 'image-to-text' && step.enabled
  );
  const visionBinding =
    imagePipelineStep?.bindingId &&
    profile.bindings.find(
      (binding) => binding.id === imagePipelineStep.bindingId && binding.capability === 'image-to-text'
    );
  const imageSummaryCache = new Map<string, ImageSummary>();

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];

    onQuestionStart?.(question, index);

    if (signal?.aborted) {
      throw new DOMException('Benchmark run aborted', 'AbortError');
    }

    const requestStartedAt = new Date();
    let imageSummaries: ImageSummary[] = [];
    if (visionBinding && (question.media?.images?.length ?? 0) > 0) {
      try {
        imageSummaries = await preprocessQuestionImages({
          question,
          binding: visionBinding,
          cache: imageSummaryCache,
          signal,
        });
      } catch (error) {
        const now = new Date().toISOString();
        imageSummaries = (question.media?.images ?? []).map((image) => ({
          id: createId(),
          image,
          url: image.url,
          text: `Failed to preprocess image: ${(error as Error).message}`,
          status: 'error' as const,
          bindingId: visionBinding.id,
          bindingName: visionBinding.name,
          generatedAt: now,
          raw: {
            reason: 'vision_preprocess_error',
          },
          errorMessage: (error as Error).message,
        }));
      }
    }
    const stepsToRun =
      profile.benchmarkSteps?.filter((step) => step.enabled) ?? defaultBenchmarkSteps;
    const fallbackSteps =
      stepsToRun.length > 0 ? stepsToRun : defaultBenchmarkSteps.filter((step) => step.enabled);
    let executionSteps = fallbackSteps.length > 0 ? fallbackSteps : defaultBenchmarkSteps;

    const hasNewTopologySteps = executionSteps.some(
      (step) =>
        step.id === 'topology-subject' ||
        step.id === 'topology-topic' ||
        step.id === 'topology-subtopic'
    );

    if (!hasNewTopologySteps) {
      const withoutLegacyTopology = executionSteps.filter((step) => step.id !== 'topology');
      const topologyDefaults = defaultBenchmarkSteps.filter((step) =>
        ['topology-subject', 'topology-topic', 'topology-subtopic'].includes(step.id)
      );
      const answerIndex = withoutLegacyTopology.findIndex((step) => step.id === 'answer');

      executionSteps =
        answerIndex >= 0
          ? [
              ...withoutLegacyTopology.slice(0, answerIndex),
              ...topologyDefaults,
              ...withoutLegacyTopology.slice(answerIndex),
            ]
          : [...topologyDefaults, ...withoutLegacyTopology];
    }

    const answerStepId =
      executionSteps.find((step) => step.id === 'answer')?.id ??
      executionSteps[executionSteps.length - 1]?.id;

    const attemptSteps: BenchmarkAttemptStepResult[] = [];
    const attemptStartedAtMs = Date.now();
    const topologyPrediction: BenchmarkTopologyPrediction = { raw: {}, stages: {} };
    let finalResponseText = '';
    let finalResponsePayload: unknown;
    let finalModelResponse: BenchmarkModelResponse | undefined;
    let finalEvaluation: BenchmarkAttemptEvaluation | undefined;
    let topologyEvaluation: BenchmarkAttemptEvaluation | undefined;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    const defaultTextBinding = ensureTextBinding(profile);
    if (!defaultTextBinding) {
      throw new Error('Profile is missing a text binding required for benchmark execution.');
    }
    try {

      const ensureTopologyContainers = () => {
        if (typeof topologyPrediction.raw !== 'object' || topologyPrediction.raw === null) {
          topologyPrediction.raw = {};
        }

        topologyPrediction.stages ??= {};

        const raw = topologyPrediction.raw;
        const stages = topologyPrediction.stages;

        if (!raw || !stages) {
          throw new Error('Topology containers failed to initialize');
        }

        return { raw, stages };
      };

      for (let stepIndex = 0; stepIndex < executionSteps.length; stepIndex += 1) {
        const step = executionSteps[stepIndex];
        const prompt = buildStepPrompt(
          question,
          step.id ?? 'unknown',
          step.promptTemplate ?? '',
          attemptSteps,
          imageSummaries
        );

        const stepStartedAt = Date.now();

        const resolvedBinding = defaultTextBinding;

        if (resolvedBinding.capability !== 'text-to-text') {
          // Vision/other capabilities will be handled in Phase III. Skip for now.
          continue;
        }

        // Build messages array for this step
        const messages: ChatCompletionMessage[] = [
          { role: 'system', content: resolvedBinding.defaultSystemPrompt },
          { role: 'user', content: prompt },
        ];

        // Build complete request payload exactly as it will be sent to the API
        const requestPayload: Record<string, unknown> = {
          model: resolvedBinding.modelId,
          temperature: resolvedBinding.temperature,
          max_tokens: resolvedBinding.maxOutputTokens,
          bindingId: resolvedBinding.id,
          messages,
        };

        // Add optional parameters if they exist
        if (resolvedBinding.topP !== undefined) {
          requestPayload.top_p = resolvedBinding.topP;
        }
        if (resolvedBinding.frequencyPenalty !== undefined) {
          requestPayload.frequency_penalty = resolvedBinding.frequencyPenalty;
        }
        if (resolvedBinding.presencePenalty !== undefined) {
          requestPayload.presence_penalty = resolvedBinding.presencePenalty;
        }

        // Add response format if JSON mode is supported
        const preferJson =
          resolvedBinding.metadata?.supportsJsonMode ?? profile.metadata.supportsJsonMode ?? true;
        if (preferJson) {
          requestPayload.response_format = { type: 'json_object' };
        }

        // Add metadata for debugging
        requestPayload._metadata = {
          stepId: step.id,
          stepLabel: step.label,
          questionId: question.id,
          questionType: question.type,
          timestamp: new Date().toISOString(),
          profileId: profile.id,
          profileName: profile.name,
          bindingId: resolvedBinding.id,
          bindingName: resolvedBinding.name,
          imageSummaryCount: imageSummaries.length,
        };

        // Determine which schema to use based on step type
        const resolveSchemaType = (id?: string) => {
          switch (id) {
            case 'topology-subject':
              return 'topologySubject';
            case 'topology-topic':
              return 'topologyTopic';
            case 'topology-subtopic':
              return 'topologySubtopic';
            case 'answer':
              return 'answer';
            default:
              return 'answer';
          }
        };

        const schemaType = resolveSchemaType(step.id);

        const completion = await sendChatCompletion({
          binding: resolvedBinding,
          messages,
          temperature: resolvedBinding.temperature,
          maxTokens: resolvedBinding.maxOutputTokens,
          topP: resolvedBinding.topP,
          frequencyPenalty: resolvedBinding.frequencyPenalty,
          presencePenalty: resolvedBinding.presencePenalty,
          preferJson,
          schemaType,
          signal,
        });

        const stepLatencyMs = Date.now() - stepStartedAt;
        const usage = completion.usage ?? {};
        totalPromptTokens += usage.promptTokens ?? 0;
        totalCompletionTokens += usage.completionTokens ?? 0;
        totalTokens += usage.totalTokens ?? 0;

        const stepResult: BenchmarkAttemptStepResult = {
          id: step.id ?? `step-${stepIndex}`,
          label: step.label ?? `Step ${stepIndex + 1}`,
          order: stepIndex,
          prompt,
          requestPayload, // Now contains COMPLETE request payload
          responsePayload: completion.raw,
          responseText: completion.text,
          latencyMs: stepLatencyMs,
          usage,
        };

        if (step.id === 'topology-subject') {
          const stageResult = parseTopologySubjectPrediction(completion.text);
          const { raw, stages } = ensureTopologyContainers();

          topologyPrediction.subjectId = stageResult.id;
          topologyPrediction.subjectConfidence = stageResult.confidence;
          stages.subject = stageResult;
          raw.subject = stageResult.raw;

          const subjectInfo = stageResult.id
            ? questionTopology.find((item) => item.id === stageResult.id)
            : undefined;
          const subjectIssues: string[] = [];

          if (!subjectInfo) {
            subjectIssues.push('Subject ID not found in taxonomy');
          }
          if (typeof stageResult.confidence === 'number' && stageResult.confidence < 0.3) {
            subjectIssues.push(`Low confidence (${stageResult.confidence.toFixed(2)})`);
          }

          // Create evaluation for subject step
          const expectedSubjectId = question.metadata?.topology?.subjectId;
          const expectedSubject = expectedSubjectId
            ? questionTopology.find((s) => s.id === expectedSubjectId)
            : undefined;
          const receivedSubject = subjectInfo;

          const subjectEval: BenchmarkAttemptEvaluation = {
            expected: expectedSubject?.name || expectedSubjectId || 'Unknown',
            received: receivedSubject?.name || stageResult.id || 'Unknown',
            passed: expectedSubjectId === stageResult.id,
            score: expectedSubjectId === stageResult.id ? 1 : 0,
            notes: subjectIssues.length > 0 ? subjectIssues.join('; ') : undefined,
          };

          stepResult.topologyStage = stageResult;
          stepResult.topologyPrediction = { ...topologyPrediction };
          stepResult.evaluation = subjectEval;
          if (subjectIssues.length > 0) {
            stepResult.notes = subjectIssues.join('; ');
          }
        } else if (step.id === 'topology-topic') {
          const stageResult = parseTopologyTopicPrediction(completion.text);
          const { raw, stages } = ensureTopologyContainers();

          topologyPrediction.topicId = stageResult.id;
          topologyPrediction.topicConfidence = stageResult.confidence;
          stages.topic = stageResult;
          raw.topic = stageResult.raw;

          const subjectInfo = topologyPrediction.subjectId
            ? questionTopology.find((item) => item.id === topologyPrediction?.subjectId)
            : undefined;
          const topicInfo = stageResult.id
            ? subjectInfo?.topics.find((item) => item.id === stageResult.id)
            : undefined;
          const topicIssues: string[] = [];

          if (!subjectInfo) {
            topicIssues.push('Subject context missing when evaluating topic');
          }
          if (!topicInfo) {
            topicIssues.push('Topic ID not found under predicted subject');
          }
          if (
            stageResult.subjectId &&
            topologyPrediction.subjectId &&
            stageResult.subjectId !== topologyPrediction.subjectId
          ) {
            topicIssues.push(
              `Model response subject (${stageResult.subjectId}) differs from prior subject (${topologyPrediction.subjectId})`
            );
          }
          if (typeof stageResult.confidence === 'number' && stageResult.confidence < 0.3) {
            topicIssues.push(`Low confidence (${stageResult.confidence.toFixed(2)})`);
          }

          // Create evaluation for topic step
          const expectedTopicId = question.metadata?.topology?.topicId;
          const expectedSubjectId = question.metadata?.topology?.subjectId;
          const expectedSubject = expectedSubjectId
            ? questionTopology.find((s) => s.id === expectedSubjectId)
            : undefined;
          const expectedTopic = expectedTopicId
            ? expectedSubject?.topics.find((t) => t.id === expectedTopicId)
            : undefined;
          const receivedTopic = topicInfo;

          const topicEval: BenchmarkAttemptEvaluation = {
            expected: expectedTopic?.name || expectedTopicId || 'Unknown',
            received: receivedTopic?.name || stageResult.id || 'Unknown',
            passed: expectedTopicId === stageResult.id,
            score: expectedTopicId === stageResult.id ? 1 : 0,
            notes: topicIssues.length > 0 ? topicIssues.join('; ') : undefined,
          };

          stepResult.topologyStage = stageResult;
          stepResult.topologyPrediction = { ...topologyPrediction };
          stepResult.evaluation = topicEval;
          if (topicIssues.length > 0) {
            stepResult.notes = topicIssues.join('; ');
          }
        } else if (step.id === 'topology-subtopic') {
          const stageResult = parseTopologySubtopicPrediction(completion.text);
          const { raw, stages } = ensureTopologyContainers();

          topologyPrediction.subtopicId = stageResult.id;
          topologyPrediction.subtopicConfidence = stageResult.confidence;
          topologyPrediction.confidence = stageResult.confidence;
          stages.subtopic = stageResult;
          raw.subtopic = stageResult.raw;

          const subjectInfo = topologyPrediction.subjectId
            ? questionTopology.find((item) => item.id === topologyPrediction.subjectId)
            : undefined;
          const topicInfo = topologyPrediction.topicId
            ? subjectInfo?.topics.find((item) => item.id === topologyPrediction.topicId)
            : undefined;
          const subtopicInfo = stageResult.id
            ? topicInfo?.subtopics.find((item) => item.id === stageResult.id)
            : undefined;
          const subtopicIssues: string[] = [];

          if (!subjectInfo) {
            subtopicIssues.push('Subject ID missing or not recognized when selecting subtopic');
          }
          if (!topicInfo) {
            subtopicIssues.push('Topic ID missing or not recognized when selecting subtopic');
          }
          if (!subtopicInfo) {
            subtopicIssues.push('Subtopic ID not found under predicted topic');
          }
          if (stageResult.topicId && topologyPrediction.topicId && stageResult.topicId !== topologyPrediction.topicId) {
            subtopicIssues.push(
              `Model response topic (${stageResult.topicId}) differs from prior topic (${topologyPrediction.topicId})`
            );
          }
          if (
            stageResult.subjectId &&
            topologyPrediction.subjectId &&
            stageResult.subjectId !== topologyPrediction.subjectId
          ) {
            subtopicIssues.push(
              `Model response subject (${stageResult.subjectId}) differs from prior subject (${topologyPrediction.subjectId})`
            );
          }
          if (typeof stageResult.confidence === 'number' && stageResult.confidence < 0.3) {
            subtopicIssues.push(`Low confidence (${stageResult.confidence.toFixed(2)})`);
          }

          const topologyEval = evaluateTopologyPrediction(question, topologyPrediction);
          topologyEvaluation = topologyEval;

          // Create evaluation for subtopic step (just subtopic, not full topology)
          const expectedTopology = question.metadata?.topology;
          const expectedSubtopicId = expectedTopology?.subtopicId;
          const expectedSubject = expectedTopology?.subjectId
            ? questionTopology.find((s) => s.id === expectedTopology.subjectId)
            : undefined;
          const expectedTopic = expectedTopology?.topicId
            ? expectedSubject?.topics.find((t) => t.id === expectedTopology.topicId)
            : undefined;
          const expectedSubtopic = expectedSubtopicId
            ? expectedTopic?.subtopics.find((st) => st.id === expectedSubtopicId)
            : undefined;
          const receivedSubtopic = subtopicInfo;

          const subtopicEval: BenchmarkAttemptEvaluation = {
            expected: expectedSubtopic?.name || expectedSubtopicId || 'Unknown',
            received: receivedSubtopic?.name || stageResult.id || 'Unknown',
            passed: expectedSubtopicId === stageResult.id,
            score: expectedSubtopicId === stageResult.id ? 1 : 0,
            notes: subtopicIssues.length > 0 ? subtopicIssues.join('; ') : undefined,
          };

          stepResult.topologyStage = stageResult;
          stepResult.topologyPrediction = { ...topologyPrediction };
          stepResult.evaluation = subtopicEval; // Use subtopic-specific evaluation
          if (subtopicIssues.length > 0) {
            stepResult.notes = subtopicIssues.join('; ');
          }
        } else if (step.id === answerStepId) {
          const parsedAnswer = parseModelResponse(completion.text);
          const answerEvaluation = evaluateModelAnswer(question, parsedAnswer);

          finalModelResponse = parsedAnswer;
          finalEvaluation = answerEvaluation;
          finalResponseText = completion.text;
          finalResponsePayload = completion.raw;
          stepResult.modelResponse = parsedAnswer;
          stepResult.evaluation = answerEvaluation;
        }

        attemptSteps.push(stepResult);
      }

      const latencyMs = Date.now() - attemptStartedAtMs;
      const answerEvaluation: BenchmarkAttemptEvaluation =
        finalEvaluation ??
        {
          expected: '',
          received: '',
          passed: false,
          score: 0,
          notes: 'Answer step did not execute.',
        };

      const attempt: BenchmarkAttempt = {
        id: createId(),
        questionId: question.id,
        startedAt: requestStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs,
        promptTokens: totalPromptTokens || undefined,
        completionTokens: totalCompletionTokens || undefined,
        totalTokens: totalTokens || undefined,
        requestPayload: {
          // Complete profile configuration used for this attempt
          profileId: profile.id,
          profileName: profile.name,
          bindingId: defaultTextBinding.id,
          bindingName: defaultTextBinding.name,
          model: defaultTextBinding.modelId,
          baseUrl: defaultTextBinding.baseUrl,
          temperature: defaultTextBinding.temperature,
          maxOutputTokens: defaultTextBinding.maxOutputTokens,
          topP: defaultTextBinding.topP,
          frequencyPenalty: defaultTextBinding.frequencyPenalty,
          presencePenalty: defaultTextBinding.presencePenalty,
          requestTimeoutMs: defaultTextBinding.requestTimeoutMs,
          systemPrompt: defaultTextBinding.defaultSystemPrompt,
          supportsJsonMode:
            defaultTextBinding.metadata?.supportsJsonMode ?? profile.metadata.supportsJsonMode,
          // Complete step details including full prompts
          steps: attemptSteps.map((step) => ({
            id: step.id,
            label: step.label,
            order: step.order,
            prompt: step.prompt, // Full prompt with all substitutions
            requestPayload: step.requestPayload, // Complete API request
            latencyMs: step.latencyMs,
            usage: step.usage,
          })),
          // Metadata for debugging
          _metadata: {
            attemptId: createId(),
            questionId: question.id,
            questionType: question.type,
            timestamp: requestStartedAt.toISOString(),
            totalSteps: attemptSteps.length,
            imageSummaries: imageSummaries.map((summary) => ({
              id: summary.id,
              url: summary.url,
              status: summary.status,
              source: summary.image.source,
            })),
          },
        },
        responsePayload: finalResponsePayload,
        responseText: finalResponseText || attemptSteps[attemptSteps.length - 1]?.responseText || '',
        modelResponse: finalModelResponse,
        evaluation: answerEvaluation,
        topologyPrediction,
        topologyEvaluation,
        steps: attemptSteps,
        imageSummaries,
        questionSnapshot: {
          prompt: question.prompt,
          type: question.type,
          difficulty: question.difficulty,
          options: question.options,
          answer: question.answer,
          solution: question.solution,
        },
      };

      attempts.push(attempt);

      const metrics = aggregateMetrics(attempts);
      onProgress?.(attempt, (index + 1) / questions.length, metrics);
    } catch (error) {
      const latencyMs = Date.now() - attemptStartedAtMs;
      const attempt: BenchmarkAttempt = {
        id: createId(),
        questionId: question.id,
        startedAt: requestStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs,
        promptTokens: totalPromptTokens || undefined,
        completionTokens: totalCompletionTokens || undefined,
        totalTokens: totalTokens || undefined,
        requestPayload: {
          // Complete profile configuration used for this attempt
          profileId: profile.id,
          profileName: profile.name,
          bindingId: defaultTextBinding.id,
          bindingName: defaultTextBinding.name,
          model: defaultTextBinding.modelId,
          baseUrl: defaultTextBinding.baseUrl,
          temperature: defaultTextBinding.temperature,
          maxOutputTokens: defaultTextBinding.maxOutputTokens,
          topP: defaultTextBinding.topP,
          frequencyPenalty: defaultTextBinding.frequencyPenalty,
          presencePenalty: defaultTextBinding.presencePenalty,
          requestTimeoutMs: defaultTextBinding.requestTimeoutMs,
          systemPrompt: defaultTextBinding.defaultSystemPrompt,
          supportsJsonMode:
            defaultTextBinding.metadata?.supportsJsonMode ?? profile.metadata.supportsJsonMode,
          // Complete step details including full prompts
          steps: attemptSteps.map((step) => ({
            id: step.id,
            label: step.label,
            order: step.order,
            prompt: step.prompt, // Full prompt with all substitutions
            requestPayload: step.requestPayload, // Complete API request
            latencyMs: step.latencyMs,
            usage: step.usage,
          })),
          // Metadata for debugging
          _metadata: {
            attemptId: createId(),
            questionId: question.id,
            questionType: question.type,
            timestamp: requestStartedAt.toISOString(),
            totalSteps: attemptSteps.length,
            error: (error as Error).message,
            imageSummaries: imageSummaries.map((summary) => ({
              id: summary.id,
              url: summary.url,
              status: summary.status,
              source: summary.image.source,
            })),
          },
        },
        responsePayload: attemptSteps[attemptSteps.length - 1]?.responsePayload,
        responseText: attemptSteps[attemptSteps.length - 1]?.responseText ?? '',
        evaluation: {
          expected: '',
          received: '',
          passed: false,
          score: 0,
          notes: (error as Error).message,
        },
        steps: attemptSteps,
        topologyPrediction,
        topologyEvaluation,
        error: (error as Error).message,
        imageSummaries,
        questionSnapshot: {
          prompt: question.prompt,
          type: question.type,
          difficulty: question.difficulty,
          options: question.options,
          answer: question.answer,
          solution: question.solution,
        },
      };

      attempts.push(attempt);

      const metrics = aggregateMetrics(attempts);
      onProgress?.(attempt, (index + 1) / questions.length, metrics);
    }
  }

  const metrics = aggregateMetrics(attempts);
  const completedAt = new Date();

  return {
    ...run,
    status: 'completed',
    startedAt: run.startedAt ?? startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    attempts,
    metrics,
    summary: `Accuracy ${(metrics.accuracy * 100).toFixed(1)}% across ${attempts.length} questions.`,
  };
};
