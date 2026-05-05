import { ModelProfile } from '@/types/benchmark';
import { fetchModels, sendChatCompletion } from '@/services/lmStudioClient';
import {
  parseModelResponse,
  parseTopologySubjectPrediction,
  parseTopologyTopicPrediction,
  parseTopologySubtopicPrediction,
} from '@/services/evaluation';
import { questionTopology } from '@/data/topology';
import createId from '@/utils/createId';
import { ensureTextBinding } from '@/utils/profile';

export interface CompatibilityCheckLog {
  id: string;
  timestamp: string;
  message: string;
  severity: 'info' | 'warn' | 'error';
}

export interface CompatibilityCheckStep {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'pending';
  logs: CompatibilityCheckLog[];
  error?: string;
}

export interface CompatibilityCheckResult {
  compatible: boolean;
  summary: string;
  jsonFormat?: 'json_object' | 'json_schema' | 'none';
  steps: CompatibilityCheckStep[];
  startedAt: string;
  completedAt: string;
  metadata: Record<string, unknown>;
}

const createLog = (message: string, severity: 'info' | 'warn' | 'error' = 'info'): CompatibilityCheckLog => ({
  id: createId(),
  timestamp: new Date().toISOString(),
  message,
  severity,
});

// Simple test question for protocol compliance
const TEST_QUESTION = {
  id: 'compat-test',
  type: 'MCQ',
  prompt: 'What is 2 + 2?',
  options: [
    { id: 0, order: 0, text: '3' },
    { id: 1, order: 1, text: '4' },
    { id: 2, order: 2, text: '5' },
    { id: 3, order: 3, text: '6' },
  ],
};

const SUBJECT_SAMPLE_LIMIT = 12;
const TOPIC_SAMPLE_LIMIT = 12;
const SUBTOPIC_SAMPLE_LIMIT = 20;

const formatQuestionReference = (question: typeof TEST_QUESTION) => {
  const lines: string[] = [];
  lines.push(`Question (${question.type}): ${question.prompt}`);

  if (Array.isArray(question.options) && question.options.length > 0) {
    lines.push('');
    lines.push('Options:');
    question.options.forEach((option, index) => {
      const label = String.fromCharCode(65 + index);
      lines.push(`${label}. ${option.text}`);
    });
  }

  return lines.join('\n');
};

const formatQuestionPrompt = (question: typeof TEST_QUESTION) => {
  const lines: string[] = [];
  lines.push(`Question (${question.type}): ${question.prompt}`);

  if (Array.isArray(question.options) && question.options.length > 0) {
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

  return lines.join('\n');
};

const buildSubjectPrompt = (question: typeof TEST_QUESTION) => {
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

const findSubjectById = (subjectId?: string) =>
  subjectId ? questionTopology.find((subject) => subject.id === subjectId) ?? null : null;

const buildTopicPrompt = (question: typeof TEST_QUESTION, subjectId?: string) => {
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
  question: typeof TEST_QUESTION,
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

/**
 * Run unified compatibility check on a profile.
 * This replaces separate L1/L2 diagnostics with a single comprehensive check.
 *
 * Checks performed (fail-fast):
 * 1. Connectivity - Can we reach the server?
 * 2. JSON Mode - Does the server support JSON formatting? (json_object or json_schema)
 * 3. Protocol - Can the model return properly formatted responses?
 */
// Very minimal 1x1 red pixel PNG - smallest valid PNG possible
const TEST_IMAGE_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

export const runCompatibilityCheck = async (
  profile: ModelProfile
): Promise<CompatibilityCheckResult> => {
  const startedAt = new Date().toISOString();

  // Check if profile has vision preprocessing enabled
  const visionBinding = profile.bindings.find((b) => b.capability === 'image-to-text');
  const visionStep = profile.pipeline.find((s) => s.capability === 'image-to-text');
  const hasVisionEnabled = Boolean(visionBinding && visionStep?.enabled);

  const steps: CompatibilityCheckStep[] = [
    { id: 'connectivity', name: 'Server Connectivity', status: 'pending', logs: [] },
    { id: 'json_mode', name: 'JSON Mode Support', status: 'pending', logs: [] },
    { id: 'protocol', name: 'Protocol Compliance', status: 'pending', logs: [] },
    { id: 'vision', name: 'Vision Model Test (Required)', status: 'pending', logs: [] },
  ];

  // Vision is now mandatory - fail early if not configured
  if (!hasVisionEnabled || !visionBinding) {
    const errorMsg = 'Vision preprocessing is required but not configured. All profiles must support image-to-text capability.';
    steps.forEach((step) => {
      step.status = 'fail';
      step.logs.push(createLog(errorMsg, 'error'));
      step.error = errorMsg;
    });

    const completedAt = new Date().toISOString();
    return {
      compatible: false,
      summary: errorMsg,
      jsonFormat: 'none',
      steps,
      startedAt,
      completedAt,
      metadata: { error: errorMsg },
    };
  }

  let compatible = false;
  let summary = '';
  let jsonFormat: 'json_object' | 'json_schema' | 'none' = 'none';

  const textBinding = ensureTextBinding(profile);
  if (!textBinding) {
    const errorMsg = 'Profile has no text-to-text binding configured';
    steps.forEach((step) => {
      step.status = 'fail';
      step.logs.push(createLog(errorMsg, 'error'));
      step.error = errorMsg;
    });

    const completedAt = new Date().toISOString();
    return {
      compatible: false,
      summary: errorMsg,
      jsonFormat: 'none',
      steps,
      startedAt,
      completedAt,
      metadata: { error: errorMsg },
    };
  }

  const bindingDefaults = {
    temperature: textBinding.temperature,
    maxTokens: textBinding.maxOutputTokens,
    topP: textBinding.topP,
    frequencyPenalty: textBinding.frequencyPenalty,
    presencePenalty: textBinding.presencePenalty,
  };
  const systemPrompt = textBinding.defaultSystemPrompt;

  // STEP 1: CONNECTIVITY CHECK
  const connectivityStep = steps[0];
  connectivityStep.status = 'pending';
  connectivityStep.logs.push(createLog('Testing server connectivity...'));

  try {
    const models = await fetchModels({
      baseUrl: textBinding.baseUrl,
      apiKey: textBinding.apiKey,
      requestTimeoutMs: textBinding.requestTimeoutMs,
      transport: textBinding.transport,
    });
    const modelIds = models.map((m) => m.id).join(', ') || 'no models reported';

    connectivityStep.logs.push(createLog(`✓ Server responded successfully`));
    connectivityStep.logs.push(createLog(`Available models: ${modelIds}`));
    connectivityStep.status = 'pass';
  } catch (error) {
    const errorMsg = (error as Error).message || 'unknown error';
    connectivityStep.logs.push(createLog(`❌ Connection failed: ${errorMsg}`, 'error'));
    connectivityStep.status = 'fail';
    connectivityStep.error = errorMsg;

    summary = `Server not reachable at ${textBinding.baseUrl}`;
    const completedAt = new Date().toISOString();

    return {
      compatible: false,
      summary,
      jsonFormat: 'none',
      steps,
      startedAt,
      completedAt,
      metadata: { error: errorMsg },
    };
  }

  // STEP 2: JSON MODE CHECK
  const jsonStep = steps[1];
  jsonStep.status = 'pending';
  jsonStep.logs.push(createLog('Testing JSON mode support...'));

  try {
    const testCompletion = await sendChatCompletion({
      binding: textBinding,
      messages: [
        {
          role: 'system',
          content: 'You are a test assistant. Return only the requested JSON, no additional text.',
        },
        {
          role: 'user',
          content: 'Return the JSON object {"answer": "4"} with no additional text.',
        },
      ],
      temperature: 0,
      maxTokens: bindingDefaults.maxTokens,
      preferJson: true,
      schemaType: 'answer',
    });

    if (testCompletion.supportsJsonMode && testCompletion.jsonFormat) {
      jsonFormat = testCompletion.jsonFormat;
      jsonStep.logs.push(createLog(`✓ JSON mode supported: ${jsonFormat}`));
      jsonStep.status = 'pass';
    } else {
      jsonStep.logs.push(createLog('❌ JSON mode not supported', 'error'));
      jsonStep.status = 'fail';
      jsonStep.error = 'JSON mode required but not available';

      summary = 'Model does not support JSON mode (required for benchmarking)';
      const completedAt = new Date().toISOString();

      return {
        compatible: false,
        summary,
        jsonFormat: 'none',
        steps,
        startedAt,
        completedAt,
        metadata: { supportsJsonMode: false },
      };
    }
  } catch (error) {
    const errorMsg = (error as Error).message || 'unknown error';
    jsonStep.logs.push(createLog(`❌ JSON mode test failed: ${errorMsg}`, 'error'));
    jsonStep.status = 'fail';
    jsonStep.error = errorMsg;

    summary = 'JSON mode test failed';
    const completedAt = new Date().toISOString();

    return {
      compatible: false,
      summary,
      jsonFormat: 'none',
      steps,
      startedAt,
      completedAt,
      metadata: { error: errorMsg },
    };
  }

  // STEP 3: PROTOCOL COMPLIANCE CHECK
  const protocolStep = steps[2];
  protocolStep.status = 'pending';
  protocolStep.logs.push(createLog('Testing protocol compliance with topology and answer steps...'));

  let subjectCompletionResult: Awaited<ReturnType<typeof sendChatCompletion>> | undefined;
  let topicCompletionResult: Awaited<ReturnType<typeof sendChatCompletion>> | undefined;
  let subtopicCompletionResult: Awaited<ReturnType<typeof sendChatCompletion>> | undefined;
  let answerCompletionResult: Awaited<ReturnType<typeof sendChatCompletion>> | undefined;
  let topologySummary:
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
    // SUBJECT STAGE
    const subjectPrompt = buildSubjectPrompt(TEST_QUESTION);
    protocolStep.logs.push(createLog(`Subject prompt length: ${subjectPrompt.length} chars`));
    const subjectStartedAt = Date.now();
    const subjectCompletion = await sendChatCompletion({
      binding: textBinding,
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
    subjectCompletionResult = subjectCompletion;
    const subjectLatency = Date.now() - subjectStartedAt;
    protocolStep.logs.push(createLog(`Subject response received in ${subjectLatency}ms`));
    const subjectStage = parseTopologySubjectPrediction(subjectCompletion.text);
    protocolStep.logs.push(
      createLog(
        `✓ Subject parsed: ${subjectStage.id ?? 'none'} (confidence ${
          subjectStage.confidence ?? 'n/a'
        })`
      )
    );

    // TOPIC STAGE
    const topicPrompt = buildTopicPrompt(TEST_QUESTION, subjectStage.id);
    protocolStep.logs.push(createLog(`Topic prompt length: ${topicPrompt.length} chars`));
    const topicStartedAt = Date.now();
    const topicCompletion = await sendChatCompletion({
      binding: textBinding,
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
    topicCompletionResult = topicCompletion;
    const topicLatency = Date.now() - topicStartedAt;
    protocolStep.logs.push(createLog(`Topic response received in ${topicLatency}ms`));
    const topicStage = parseTopologyTopicPrediction(topicCompletion.text);
    protocolStep.logs.push(
      createLog(
        `✓ Topic parsed: ${topicStage.id ?? 'none'} (confidence ${
          topicStage.confidence ?? 'n/a'
        })`
      )
    );

    // SUBTOPIC STAGE
    const subtopicPrompt = buildSubtopicPrompt(TEST_QUESTION, subjectStage.id, topicStage.id);
    protocolStep.logs.push(createLog(`Subtopic prompt length: ${subtopicPrompt.length} chars`));
    const subtopicStartedAt = Date.now();
    const subtopicCompletion = await sendChatCompletion({
      binding: textBinding,
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
    subtopicCompletionResult = subtopicCompletion;
    const subtopicLatency = Date.now() - subtopicStartedAt;
    protocolStep.logs.push(createLog(`Subtopic response received in ${subtopicLatency}ms`));
    const subtopicStage = parseTopologySubtopicPrediction(subtopicCompletion.text);
    protocolStep.logs.push(
      createLog(
        `✓ Subtopic parsed: ${subtopicStage.id ?? 'none'} (confidence ${
          subtopicStage.confidence ?? 'n/a'
        })`
      )
    );

    const topologyParsed = {
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
    topologySummary = topologyParsed;

    const topologyJson = JSON.stringify(
      {
        subjectId: topologyParsed.subjectId ?? null,
        topicId: topologyParsed.topicId ?? null,
        subtopicId: topologyParsed.subtopicId ?? null,
      },
      null,
      2
    );

    const answerPrompt = formatQuestionPrompt(TEST_QUESTION) + `\n\nTopology classification:\n${topologyJson}`;
    protocolStep.logs.push(createLog(`Answer prompt length: ${answerPrompt.length} chars`));

    const answerCompletion = await sendChatCompletion({
      binding: textBinding,
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
    answerCompletionResult = answerCompletion;

    protocolStep.logs.push(
      createLog(`Answer response received (${answerCompletion.text.length} chars)`)
    );

    const parsedAnswerLocal = parseModelResponse(answerCompletion.text);
    parsedAnswer = parsedAnswerLocal;
    protocolStep.logs.push(createLog(`✓ Answer parsed: "${parsedAnswerLocal.answer}"`));
    if (parsedAnswerLocal.explanation) {
      protocolStep.logs.push(createLog('✓ Explanation included'));
    }
    if (parsedAnswerLocal.confidence !== undefined) {
      protocolStep.logs.push(createLog(`✓ Confidence score: ${parsedAnswerLocal.confidence}`));
    }

    const hasCompleteTopology =
      Boolean(topologyParsed.subjectId) &&
      Boolean(topologyParsed.topicId) &&
      Boolean(topologyParsed.subtopicId);

    if (hasCompleteTopology) {
      protocolStep.logs.push(createLog('✓ All topology stages returned IDs'));
    } else {
      protocolStep.logs.push(
        createLog('Topology classification did not return all required IDs', 'warn')
      );
    }

    protocolStep.status = hasCompleteTopology ? 'pass' : 'fail';
    if (protocolStep.status === 'pass') {
      protocolStep.logs.push(createLog('✓ Protocol compliance verified'));
      compatible = true;
      summary = `Compatible - Supports ${jsonFormat} format`;
    } else {
      compatible = false;
      summary = 'Topology classification missing required fields';
    }

  } catch (error) {
    const errorMsg = (error as Error).message || 'unknown error';
    protocolStep.logs.push(createLog(`❌ Protocol test failed: ${errorMsg}`, 'error'));
    protocolStep.status = 'fail';
    protocolStep.error = errorMsg;

    summary = 'Model does not follow required response format';
  }

  // STEP 4: VISION MODEL TEST (MANDATORY)
  const visionTestStep = steps.find((s) => s.id === 'vision');
  if (visionTestStep) {
    visionTestStep.status = 'pending';
    visionTestStep.logs.push(createLog('Testing vision model with sample image...'));

    try {
      // Test vision model with a simple test image
      const visionTestPrompt = 'Describe what you see in this image.';

      visionTestStep.logs.push(createLog(`Vision binding: ${visionBinding.modelId} at ${visionBinding.baseUrl}`));
      visionTestStep.logs.push(createLog(`Transport: ${visionBinding.transport}`));
      visionTestStep.logs.push(createLog(`Image data length: ${TEST_IMAGE_BASE64.length} chars`));
      visionTestStep.logs.push(createLog(`Image prefix: ${TEST_IMAGE_BASE64.substring(0, 50)}...`));
      visionTestStep.logs.push(createLog('Sending minimal 1x1 red pixel PNG for vision test'));
      const visionStartedAt = Date.now();

      const visionCompletion = await sendChatCompletion({
        binding: visionBinding,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: visionTestPrompt,
              },
              {
                type: 'input_image',
                image_url: {
                  url: TEST_IMAGE_BASE64,
                },
              },
            ],
          },
        ],
        temperature: 0,
        maxTokens: visionBinding.maxOutputTokens,
        preferJson: false, // Vision models typically return plain text
      });

      const visionLatency = Date.now() - visionStartedAt;
      visionTestStep.logs.push(createLog(`Vision response received in ${visionLatency}ms`));

      const extractedText = visionCompletion.text.trim();
      visionTestStep.logs.push(createLog(`Extracted text: "${extractedText}"`));

      // Check if the model extracted any text
      if (extractedText.length > 0) {
        visionTestStep.logs.push(createLog('✓ Vision model successfully extracted text from image'));
        visionTestStep.status = 'pass';

        // Vision test passed - update overall status only if text tests also passed
        if (compatible) {
          summary = `Compatible - Supports ${jsonFormat} format with vision`;
        }
      } else {
        visionTestStep.logs.push(createLog('❌ Vision model returned empty response', 'error'));
        visionTestStep.status = 'fail';
        visionTestStep.error = 'Vision model did not extract any text';

        // Vision is mandatory - fail overall compatibility
        compatible = false;
        summary = 'Vision model test failed - did not extract any text from test image';
      }
    } catch (error) {
      const errorMsg = (error as Error).message || 'unknown error';
      const errorStack = (error as Error).stack || '';

      visionTestStep.logs.push(createLog(`❌ Vision test failed: ${errorMsg}`, 'error'));

      // Log additional error details if available
      if (error && typeof error === 'object') {
        const errorObj = error as any;
        if (errorObj.response) {
          visionTestStep.logs.push(createLog(`HTTP status: ${errorObj.response.status}`, 'error'));
          visionTestStep.logs.push(createLog(`Response: ${JSON.stringify(errorObj.response.data)}`, 'error'));
        }
        if (errorObj.cause) {
          visionTestStep.logs.push(createLog(`Cause: ${JSON.stringify(errorObj.cause)}`, 'error'));
        }
      }

      visionTestStep.logs.push(createLog(`Stack: ${errorStack.substring(0, 500)}`, 'error'));
      visionTestStep.status = 'fail';
      visionTestStep.error = errorMsg;

      // Vision is mandatory - fail overall compatibility
      compatible = false;
      summary = `Vision model test failed: ${errorMsg}`;
    }
  }

  const completedAt = new Date().toISOString();

  return {
    compatible,
    summary,
    jsonFormat,
    steps,
    startedAt,
    completedAt,
    metadata: {
      profileId: profile.id,
      profileName: profile.name,
      binding: {
        id: textBinding.id,
        modelId: textBinding.modelId,
        baseUrl: textBinding.baseUrl,
        capability: textBinding.capability,
        transport: textBinding.transport,
      },
      ...(visionBinding && hasVisionEnabled
        ? {
            visionBinding: {
              id: visionBinding.id,
              modelId: visionBinding.modelId,
              baseUrl: visionBinding.baseUrl,
              capability: visionBinding.capability,
              transport: visionBinding.transport,
            },
          }
        : {}),
      supportsJsonMode: jsonFormat === 'json_object' || jsonFormat === 'json_schema',
      topologyResponse: topologySummary,
      answerResponse: parsedAnswer,
      rawResponses: {
        subject: subjectCompletionResult?.raw,
        topic: topicCompletionResult?.raw,
        subtopic: subtopicCompletionResult?.raw,
        answer: answerCompletionResult?.raw,
      },
    },
  };
};
