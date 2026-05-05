import {
  BenchmarkQuestion,
  DiagnosticsLevel,
  DiagnosticsLogEntry,
  DiagnosticsResult,
  ModelBinding,
  ModelProfile,
} from '@/types/benchmark';
import createId from '@/utils/createId';
import { sendChatCompletion, fetchModels } from '@/services/lmStudioClient';
import {
  parseModelResponse,
  parseTopologySubjectPrediction,
  parseTopologyTopicPrediction,
  parseTopologySubtopicPrediction,
} from '@/services/evaluation';
import { questionTopology } from '@/data/topology';
import { ensureTextBinding, inferProviderFromBinding } from '@/utils/profile';

/**
 * Dummy question used exclusively for L2 readiness checks.
 * This simple MCQ verifies protocol compliance without testing model intelligence.
 */
const READINESS_DUMMY_QUESTION: BenchmarkQuestion = {
  id: 'diagnostics-dummy',
  questionId: -1,
  displayId: null,
  type: 'MCQ',
  difficulty: 'easy',
  prompt: 'What is 2 + 2?',
  options: [
    { id: 0, order: 0, text: '3' },
    { id: 1, order: 1, text: '4' },
    { id: 2, order: 2, text: '5' },
    { id: 3, order: 3, text: '6' },
  ],
  answer: {
    kind: 'single',
    correctOption: 1,
  },
  metadata: {
    status: 'active',
    tags: ['diagnostics', 'dummy'],
  },
};

const createLog = (message: string, severity: 'info' | 'warn' | 'error' = 'info') => ({
  id: createId(),
  timestamp: new Date().toISOString(),
  message,
  severity,
});

const formatQuestionPrompt = (question: BenchmarkQuestion) => {
  const lines: string[] = [];
  lines.push(`Question (${question.type}): ${question.prompt}`);

  if (question.instructions) {
    lines.push(`Instructions: ${question.instructions}`);
  }

  if (question.options.length > 0) {
    lines.push('');
    lines.push('Options:');
    question.options.forEach((option, index) => {
      const label = String.fromCharCode(65 + index);
      lines.push(`${label}. ${option.text}`);
    });
  }

  lines.push('');
  lines.push(
    'Return a JSON object with keys `answer`, `explanation`, and `confidence` (0-1). For multiple answers, join values using commas (e.g., "A,C").'
  );

  if (question.type === 'NAT' && question.answer.kind === 'numeric') {
    if (question.answer.range.min != null && question.answer.range.max != null) {
      lines.push(
        `Accepted numeric range: [${question.answer.range.min}, ${question.answer.range.max}] with precision ${question.answer.range.precision ?? 'unspecified'}.`
      );
    }
  }

  return lines.join('\n');
};

const formatQuestionReference = (question: BenchmarkQuestion) => {
  const lines: string[] = [];
  lines.push(`Question (${question.type}): ${question.prompt}`);

  if (question.instructions) {
    lines.push(`Instructions: ${question.instructions}`);
  }

  if (question.options.length > 0) {
    lines.push('');
    lines.push('Options:');
    question.options.forEach((option, index) => {
      const label = String.fromCharCode(65 + index);
      lines.push(`${label}. ${option.text}`);
    });
  }

  return lines.join('\n');
};

const SUBJECT_SAMPLE_LIMIT = 12;
const TOPIC_SAMPLE_LIMIT = 12;
const SUBTOPIC_SAMPLE_LIMIT = 20;

const buildSubjectPrompt = (question: BenchmarkQuestion) => {
  const subjectCatalog = questionTopology
    .slice(0, SUBJECT_SAMPLE_LIMIT)
    .map((subject) => `- ${subject.id} :: ${subject.name}`)
    .join('\n');

  return [
    'Identify the best SUBJECT for the question using the catalog below.',
    `SUBJECT CATALOG:\n${subjectCatalog}`,
    'Rules:',
    '1. Copy the subjectId exactly as shown (no new IDs, no "null").',
    '2. Always provide your best guess and set `confidence` between 0 and 1.',
    '3. Use low confidence (e.g., 0.2) if unsure, but still return a subjectId.',
    'Return JSON:\n{\n  "subjectId": "68d24e621c69bbb6f527dabb",\n  "confidence": 0.6\n}',
    '--- QUESTION ---',
    formatQuestionReference(question),
  ].join('\n\n');
};

const findSubjectById = (subjectId?: string | null) =>
  subjectId ? questionTopology.find((subject) => subject.id === subjectId) ?? null : null;

const buildTopicPrompt = (question: BenchmarkQuestion, subjectId?: string) => {
  const subject = findSubjectById(subjectId) ?? questionTopology[0];
  const topicCatalog = subject.topics
    .slice(0, TOPIC_SAMPLE_LIMIT)
    .map((topic) => `- ${topic.id} :: ${topic.name}`)
    .join('\n');

  const selectedSubject = subjectId
    ? `${subjectId} (${subject?.name ?? 'Unknown subject'})`
    : `${subject.id} (${subject.name}) [default]`;

  return [
    `We will refine within subject ${selectedSubject}. Choose the best TOPIC from the catalog.`,
    `TOPIC CATALOG:\n${topicCatalog || 'No topics available for this subject.'}`,
    'Rules:',
    '1. Return the exact topicId shown (no "null").',
    '2. If unsure or if the subject seems wrong, pick the closest topic and lower the confidence.',
    '3. Confidence must be between 0 and 1.',
    'Return JSON:\n{\n  "topicId": "68d24e71b905a26b8ed99dd0",\n  "confidence": 0.5\n}',
    '--- QUESTION ---',
    formatQuestionReference(question),
  ].join('\n\n');
};

const findTopicById = (subjectId: string | undefined, topicId: string | undefined) => {
  const subject = findSubjectById(subjectId ?? undefined);
  if (!subject || !topicId) {
    return null;
  }

  return subject.topics.find((topic) => topic.id === topicId) ?? null;
};

const buildSubtopicPrompt = (
  question: BenchmarkQuestion,
  subjectId?: string,
  topicId?: string
) => {
  const subject = findSubjectById(subjectId) ?? questionTopology[0];
  const topic =
    findTopicById(subjectId ?? subject.id, topicId) ?? subject.topics[0] ?? null;

  const subtopics = topic?.subtopics ?? [];
  const subtopicCatalog = subtopics
    .slice(0, SUBTOPIC_SAMPLE_LIMIT)
    .map((subtopic) => `- ${subtopic.id} :: ${subtopic.name}`)
    .join('\n');

  const selectedSubject = subjectId
    ? `${subjectId} (${subject?.name ?? 'Unknown subject'})`
    : `${subject.id} (${subject.name}) [default]`;
  const selectedTopic = topicId
    ? `${topicId} (${topic?.name ?? 'Unknown topic'})`
    : topic
    ? `${topic.id} (${topic.name}) [default]`
    : 'unknown (no topic available)';

  return [
    `Subject: ${selectedSubject}\nTopic: ${selectedTopic}`,
    `Choose the best SUBTOPIC from the catalog below.`,
    `SUBTOPIC CATALOG:\n${subtopicCatalog || 'No subtopics available; pick the closest classification and note low confidence.'}`,
    'Rules:',
    '1. Return the exact subtopicId; never respond with "null".',
    '2. Provide your best guess even if uncertain and reflect that in the confidence score.',
    '3. Confidence must be between 0 and 1.',
    'Return JSON:\n{\n  "subtopicId": "68d24ec31c69bbb6f528892b",\n  "confidence": 0.4\n}',
    '--- QUESTION ---',
    formatQuestionReference(question),
  ].join('\n\n');
};

const buildAnswerPromptWithTopology = (
  question: BenchmarkQuestion,
  topologyJson: string | undefined
) => {
  const prompt = formatQuestionPrompt(question);
  const topologyContext = topologyJson ? `\n\nTopology classification: ${topologyJson}` : '';
  return `${prompt}${topologyContext}`;
};

const requireTextBinding = (profile: ModelProfile): ModelBinding => {
  const binding = ensureTextBinding(profile);
  if (!binding) {
    throw new Error('Profile is missing a text-to-text binding required for diagnostics.');
  }
  return binding;
};

interface HandshakeOutcome {
  success: boolean;
  logs: DiagnosticsLogEntry[];
  supportsJsonMode: boolean;
  summary: string;
}

const performHandshake = async (binding: ModelBinding): Promise<HandshakeOutcome> => {
  const logs: DiagnosticsLogEntry[] = [];
  logs.push(createLog('Starting Level 1 handshake diagnostic.'));
  const providerLabel = inferProviderFromBinding(binding) ?? 'model host';

  try {
    logs.push(createLog(`Fetching model list from ${providerLabel}...`));
    const models = await fetchModels({
      baseUrl: binding.baseUrl,
      apiKey: binding.apiKey,
      requestTimeoutMs: binding.requestTimeoutMs,
      transport: binding.transport,
    });
    const modelIds = models.map((model) => model.id).join(', ') || 'no models reported';
    logs.push(createLog(`Received models: ${modelIds}`));
  } catch (error) {
    logs.push(
      createLog(
        `Failed to fetch models: ${(error as Error).message ?? 'unknown error'}`,
        'error'
      )
    );
    return {
      success: false,
      logs,
      supportsJsonMode: false,
      summary: 'Model list request failed',
    };
  }

  try {
    logs.push(createLog('Attempting JSON-mode test completion.'));

    const completion = await sendChatCompletion({
      binding,
      messages: [
        {
          role: 'system',
          content:
            'You are a diagnostics assistant. Follow the instructions exactly, returning only what is requested.',
        },
        {
          role: 'user',
          content: 'Return the JSON object {"answer":"ready"} with no additional text.',
        },
      ],
      temperature: 0,
      preferJson: true,
      schemaType: 'answer', // Use answer schema to match parseModelResponse expectations
    });

    logs.push(
      createLog(
        completion.fallbackUsed
          ? 'Server rejected JSON mode; fallback to plain text succeeded.'
          : 'JSON mode completion succeeded.'
      )
    );

    const parsed = parseModelResponse(completion.text);
    const status = parsed.answer?.toLowerCase() ?? '';
    const success = status.includes('ready');

    logs.push(createLog(`Model response: ${completion.text}`));

    if (!success) {
      logs.push(createLog('Handshake response did not confirm readiness.', 'warn'));
    } else {
      logs.push(createLog('Handshake confirmed JSON compliance.'));
    }

    return {
      success,
      logs,
      supportsJsonMode: !completion.fallbackUsed,
      summary: success
        ? 'Handshake succeeded'
        : 'Handshake completed but response was not in expected format',
    };
  } catch (error) {
    logs.push(
      createLog(
        `Handshake request failed: ${(error as Error).message ?? 'unknown error'}`,
        'error'
      )
    );
    return {
      success: false,
      logs,
      supportsJsonMode: false,
      summary: 'Handshake request failed',
    };
  }
};

interface ReadinessOutcome {
  success: boolean;
  logs: DiagnosticsLogEntry[];
  supportsJsonMode: boolean;
  summary: string;
  metadata: Record<string, unknown>;
}

/**
 * Performs L2 readiness check using a simple dummy question.
 * This check verifies protocol compliance only - it does NOT check answer correctness.
 * Success criteria:
 * - Response received successfully
 * - Response can be parsed into expected format
 * - Response contains required 'answer' field
 */
const performReadinessCheck = async (
  profile: ModelProfile,
  binding: ModelBinding
): Promise<ReadinessOutcome> => {
  const logs: DiagnosticsLogEntry[] = [];

  logs.push(
    createLog(
      'Running Level 2 readiness check using dummy question to verify protocol compliance.'
    )
  );

  logs.push(createLog(`Profile configuration: ${profile.name} (binding ${binding.modelId})`));
  logs.push(
    createLog(
      `Test question: ${READINESS_DUMMY_QUESTION.type} - "${READINESS_DUMMY_QUESTION.prompt}"`
    )
  );

  const bindingDefaults = {
    temperature: binding.temperature,
    maxTokens: binding.maxOutputTokens,
    topP: binding.topP,
    frequencyPenalty: binding.frequencyPenalty,
    presencePenalty: binding.presencePenalty,
  };
  const systemPrompt = binding.defaultSystemPrompt;

  let subjectCompletion: Awaited<ReturnType<typeof sendChatCompletion>> | undefined;
  let topicCompletion: Awaited<ReturnType<typeof sendChatCompletion>> | undefined;
  let subtopicCompletion: Awaited<ReturnType<typeof sendChatCompletion>> | undefined;
  let answerCompletion: Awaited<ReturnType<typeof sendChatCompletion>> | undefined;
  let topologyResult:
    | {
        subjectId?: string;
        subjectConfidence?: number;
        topicId?: string;
        topicConfidence?: number;
        subtopicId?: string;
        subtopicConfidence?: number;
        stages?: {
          subject?: unknown;
          topic?: unknown;
          subtopic?: unknown;
        };
      }
    | undefined;
  let parsedAnswer: ReturnType<typeof parseModelResponse> | undefined;

  try {
    logs.push(createLog('Step 1: Requesting subject classification.'));
    const subjectPrompt = buildSubjectPrompt(READINESS_DUMMY_QUESTION);
    logs.push(createLog(`Subject prompt length: ${subjectPrompt.length} chars`));
    const subjectStart = Date.now();
    subjectCompletion = await sendChatCompletion({
      binding,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: subjectPrompt },
      ],
      temperature: bindingDefaults.temperature,
      maxTokens: bindingDefaults.maxTokens,
      topP: bindingDefaults.topP,
      frequencyPenalty: bindingDefaults.frequencyPenalty,
      presencePenalty: bindingDefaults.presencePenalty,
      preferJson: true,
      schemaType: 'topologySubject',
    });
    logs.push(createLog(`Subject response received in ${Date.now() - subjectStart}ms`));
    const subjectStage = parseTopologySubjectPrediction(subjectCompletion.text);
    logs.push(
      createLog(
        `Parsed subjectId=${subjectStage.id ?? 'none'} (confidence ${
          subjectStage.confidence ?? 'n/a'
        })`
      )
    );

    logs.push(createLog('Step 2: Requesting topic classification.'));
    const topicPrompt = buildTopicPrompt(READINESS_DUMMY_QUESTION, subjectStage.id);
    logs.push(createLog(`Topic prompt length: ${topicPrompt.length} chars`));
    const topicStart = Date.now();
    topicCompletion = await sendChatCompletion({
      binding,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: topicPrompt },
      ],
      temperature: bindingDefaults.temperature,
      maxTokens: bindingDefaults.maxTokens,
      topP: bindingDefaults.topP,
      frequencyPenalty: bindingDefaults.frequencyPenalty,
      presencePenalty: bindingDefaults.presencePenalty,
      preferJson: true,
      schemaType: 'topologyTopic',
    });
    logs.push(createLog(`Topic response received in ${Date.now() - topicStart}ms`));
    const topicStage = parseTopologyTopicPrediction(topicCompletion.text);
    logs.push(
      createLog(
        `Parsed topicId=${topicStage.id ?? 'none'} (confidence ${
          topicStage.confidence ?? 'n/a'
        })`
      )
    );

    logs.push(createLog('Step 3: Requesting subtopic classification.'));
    const subtopicPrompt = buildSubtopicPrompt(
      READINESS_DUMMY_QUESTION,
      subjectStage.id,
      topicStage.id
    );
    logs.push(createLog(`Subtopic prompt length: ${subtopicPrompt.length} chars`));
    const subtopicStart = Date.now();
    subtopicCompletion = await sendChatCompletion({
      binding,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: subtopicPrompt },
      ],
      temperature: bindingDefaults.temperature,
      maxTokens: bindingDefaults.maxTokens,
      topP: bindingDefaults.topP,
      frequencyPenalty: bindingDefaults.frequencyPenalty,
      presencePenalty: bindingDefaults.presencePenalty,
      preferJson: true,
      schemaType: 'topologySubtopic',
    });
    logs.push(createLog(`Subtopic response received in ${Date.now() - subtopicStart}ms`));
    const subtopicStage = parseTopologySubtopicPrediction(subtopicCompletion.text);
    logs.push(
      createLog(
        `Parsed subtopicId=${subtopicStage.id ?? 'none'} (confidence ${
          subtopicStage.confidence ?? 'n/a'
        })`
      )
    );

    topologyResult = {
      subjectId: subjectStage.id,
      subjectConfidence: subjectStage.confidence,
      topicId: topicStage.id,
      topicConfidence: topicStage.confidence,
      subtopicId: subtopicStage.id,
      subtopicConfidence: subtopicStage.confidence,
      stages: {
        subject: subjectStage,
        topic: topicStage,
        subtopic: subtopicStage,
      },
    };

    const topologyContext = JSON.stringify(
      {
        subjectId: topologyResult.subjectId ?? null,
        topicId: topologyResult.topicId ?? null,
        subtopicId: topologyResult.subtopicId ?? null,
      },
      null,
      2
    );

    logs.push(createLog('Step 4: Requesting final answer using topology context.'));
    const answerPrompt = buildAnswerPromptWithTopology(READINESS_DUMMY_QUESTION, topologyContext);
    logs.push(createLog(`Answer prompt length: ${answerPrompt.length} chars`));
    const answerStart = Date.now();
    answerCompletion = await sendChatCompletion({
      binding,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: answerPrompt },
      ],
      temperature: bindingDefaults.temperature,
      maxTokens: bindingDefaults.maxTokens,
      topP: bindingDefaults.topP,
      frequencyPenalty: bindingDefaults.frequencyPenalty,
      presencePenalty: bindingDefaults.presencePenalty,
      preferJson: true,
      schemaType: 'answer',
    });
    logs.push(createLog(`Answer response received in ${Date.now() - answerStart}ms`));

    parsedAnswer = parseModelResponse(answerCompletion.text);
    logs.push(createLog(`Parsed answer: "${parsedAnswer.answer}"`));

    const hasTopologyPrediction =
      Boolean(topologyResult.subjectId) &&
      Boolean(topologyResult.topicId) &&
      Boolean(topologyResult.subtopicId);
    const hasAnswer =
      parsedAnswer.answer !== undefined && parsedAnswer.answer !== null &&
      parsedAnswer.answer !== '';
    const hasValidFormat = typeof parsedAnswer.answer === 'string';

    logs.push(
      createLog(
        `Validation: hasTopology=${hasTopologyPrediction}, hasAnswer=${hasAnswer}, validFormat=${hasValidFormat}`
      )
    );

    const formatCompliant = hasTopologyPrediction && hasAnswer && hasValidFormat;

    if (!formatCompliant) {
      const failureReasons: string[] = [];
      if (!hasTopologyPrediction) failureReasons.push('Missing topology prediction');
      if (!hasAnswer) failureReasons.push('Missing answer field');
      if (!hasValidFormat) failureReasons.push('Answer is not a string');

      logs.push(createLog(`Protocol check FAILED: ${failureReasons.join(', ')}`, 'error'));
    } else {
      logs.push(createLog('Protocol check PASSED'));
    }

    if (formatCompliant) {
      logs.push(createLog('Readiness check PASSED - Model is ready for benchmarking'));
    }

    const supportsJsonMode =
      !!subjectCompletion &&
      !!topicCompletion &&
      !!subtopicCompletion &&
      !!answerCompletion &&
      !subjectCompletion.fallbackUsed &&
      !topicCompletion.fallbackUsed &&
      !subtopicCompletion.fallbackUsed &&
      !answerCompletion.fallbackUsed;

    return {
      success: formatCompliant,
      logs,
      supportsJsonMode,
      summary: formatCompliant
        ? 'Protocol compliance verified - response format is correct.'
        : 'Protocol check failed - response format is invalid.',
      metadata: {
        topologyResponse: topologyResult,
        parsedResponse: {
          hasAnswer,
          hasExplanation: parsedAnswer.explanation !== undefined,
          hasConfidence: parsedAnswer.confidence !== undefined,
        },
        rawResponses: {
          subject: subjectCompletion.raw,
          topic: topicCompletion.raw,
          subtopic: subtopicCompletion.raw,
          answer: answerCompletion.raw,
        },
      },
    };
  } catch (error) {
    logs.push(
      createLog(
        `Readiness check failed: ${(error as Error).message ?? 'unknown error'}`,
        'error'
      )
    );
    return {
      success: false,
      logs,
      supportsJsonMode: false,
      summary: 'Readiness check failed',
      metadata: {
        error: (error as Error).message ?? 'unknown error',
        subjectRaw: subjectCompletion?.raw,
        topicRaw: topicCompletion?.raw,
        subtopicRaw: subtopicCompletion?.raw,
        answerRaw: answerCompletion?.raw,
      },
    };
  }
};


interface DiagnosticsOptions {
  profile: ModelProfile;
  level: DiagnosticsLevel;
}

export const runDiagnostics = async ({
  profile,
  level,
}: DiagnosticsOptions): Promise<DiagnosticsResult> => {
  const startedAt = new Date().toISOString();
  let completedAt: string;
  let status: 'pass' | 'fail' = 'fail';
  let logs: DiagnosticsLogEntry[] = [];
  let summary = '';
  let supportsJsonMode = false;
  let metadata: Record<string, unknown> | undefined;

  let textBinding: ModelBinding;
  try {
    textBinding = requireTextBinding(profile);
  } catch (error) {
    completedAt = new Date().toISOString();
    const message = (error as Error).message ?? 'Profile missing text binding';
    logs = [createLog(message, 'error')];
    summary = message;
    supportsJsonMode = false;

    return {
      id: createId(),
      profileId: profile.id,
      level,
      startedAt,
      completedAt,
      status: 'fail',
      summary,
      fallbackApplied: true,
      metadata: {
        error: message,
        supportsJsonMode,
      },
      logs,
    };
  }

  if (level === 'HANDSHAKE') {
    const result = await performHandshake(textBinding);
    completedAt = new Date().toISOString();
    status = result.success ? 'pass' : 'fail';
    logs = result.logs;
    summary = result.summary;
    supportsJsonMode = result.supportsJsonMode;
  } else {
    const result = await performReadinessCheck(profile, textBinding);
    completedAt = new Date().toISOString();
    status = result.success ? 'pass' : 'fail';
    logs = result.logs;
    summary = result.summary;
    supportsJsonMode = result.supportsJsonMode;
    metadata = result.metadata;
  }

  return {
    id: createId(),
    profileId: profile.id,
    level,
    startedAt,
    completedAt,
    status,
    summary,
    fallbackApplied: !supportsJsonMode,
    metadata: {
      ...(metadata ?? {}),
      supportsJsonMode,
    },
    logs,
  };
};
