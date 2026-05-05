import { ModelBinding } from '@/types/benchmark';

interface RequestOptions {
  path: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  binding: Pick<ModelBinding, 'baseUrl' | 'apiKey' | 'requestTimeoutMs' | 'transport'>;
  signal?: AbortSignal;
}

const OPENROUTER_SITE_URL =
  import.meta.env.VITE_OPENROUTER_SITE_URL ??
  (typeof window !== 'undefined' ? window.location.origin : '');
const OPENROUTER_APP_TITLE =
  import.meta.env.VITE_OPENROUTER_APP_TITLE ?? 'KG AI Benchmark';

// JSON Schemas for structured JSON responses
const TOPOLOGY_SUBJECT_SCHEMA = {
  type: 'object',
  properties: {
    subjectId: { type: 'string', description: 'Subject identifier' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score' },
  },
  required: ['subjectId'],
  additionalProperties: false,
} as const;

const TOPOLOGY_TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    topicId: { type: 'string', description: 'Topic identifier' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score' },
  },
  required: ['topicId'],
  additionalProperties: false,
} as const;

const TOPOLOGY_SUBTOPIC_SCHEMA = {
  type: 'object',
  properties: {
    subtopicId: { type: 'string', description: 'Subtopic identifier' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score' },
  },
  required: ['subtopicId'],
  additionalProperties: false,
} as const;

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The answer to the question' },
    explanation: { type: 'string', description: 'Explanation of the answer' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score' },
  },
  required: ['answer'],
  additionalProperties: false,
} as const;

type JsonFormatType = 'json_object' | 'json_schema';
type SchemaType = 'topologySubject' | 'topologyTopic' | 'topologySubtopic' | 'answer';

const isJsonModeError = (payload: unknown): { isError: boolean; needsSchema: boolean } => {
  if (!payload) {
    return { isError: false, needsSchema: false };
  }

  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);

  // Check if LM Studio requires json_schema format instead of json_object
  const needsJsonSchema = /response[_-]?format.*must be|json_schema.*text/i.test(text);
  const hasJsonModeError = /json mode|unable to parse/i.test(text);

  return {
    isError: needsJsonSchema || hasJsonModeError,
    needsSchema: needsJsonSchema,
  };
};

const buildHeaders = (binding: Pick<ModelBinding, 'apiKey' | 'transport'>) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (binding.apiKey) {
    headers.Authorization = `Bearer ${binding.apiKey}`;
  }

  if (binding.transport === 'openrouter') {
    if (OPENROUTER_SITE_URL) {
      headers['HTTP-Referer'] = OPENROUTER_SITE_URL;
    }
    if (OPENROUTER_APP_TITLE) {
      headers['X-Title'] = OPENROUTER_APP_TITLE;
    }
  }

  return headers;
};

const request = async <T>({
  path,
  method = 'GET',
  body,
  binding,
  signal,
}: RequestOptions): Promise<{ ok: boolean; status: number; data?: T; raw: Response }> => {
  const url = new URL(path, binding.baseUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), binding.requestTimeoutMs);

  const response = await fetch(url, {
    method,
    headers: buildHeaders(binding),
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ?? controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
  });

  let data: T | undefined;

  try {
    data = (await response.json()) as T;
  } catch (error) {
    console.warn('Failed to parse response JSON', error);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw: response,
  };
};

export type MessageContentPart =
  | { type: 'input_text'; text: string }
  | {
      type: 'input_image';
      image_url: {
        url: string;
      };
    };

type OpenAICompatibleMessageContent =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContentPart[];
}

export interface ChatCompletionParams {
  binding: ModelBinding;
  messages: ChatCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  preferJson?: boolean;
  schemaType?: SchemaType; // Which schema to use for json_schema mode
  signal?: AbortSignal;
}

interface RawChatCompletionChoice {
  message?: { role: string; content: string };
  delta?: { content?: string };
  finish_reason?: string;
}

interface RawChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface RawChatCompletionResponse {
  id?: string;
  model?: string;
  created?: number;
  choices?: RawChatCompletionChoice[];
  usage?: RawChatCompletionUsage;
}

export interface ChatCompletionResult {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw?: RawChatCompletionResponse;
  fallbackUsed: boolean;
  supportsJsonMode: boolean;
  jsonFormat?: JsonFormatType; // Which JSON format was successfully used
}

const extractTextFromResponse = (payload?: RawChatCompletionResponse) => {
  if (!payload?.choices || payload.choices.length === 0) {
    return '';
  }

  const primaryMessage = payload.choices[0].message?.content;
  const deltaMessage = payload.choices[0].delta?.content;

  return primaryMessage ?? deltaMessage ?? '';
};

const mapUsage = (usage?: RawChatCompletionUsage) =>
  usage
    ? {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      }
    : undefined;

const prepareMessagesForTransport = (
  messages: ChatCompletionMessage[],
  transport: ModelBinding['transport']
): unknown => {
  if (transport === 'lmstudio') {
    return messages;
  }

  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return message;
    }

    if (!Array.isArray(message.content)) {
      return message;
    }

    const content: OpenAICompatibleMessageContent[] = message.content.map((part) => {
      if (part.type === 'input_text') {
        return {
          type: 'text',
          text: part.text,
        };
      }

      return {
        type: 'image_url',
        image_url: {
          url: part.image_url.url,
        },
      };
    });

    return {
      role: message.role,
      content,
    };
  });
};

export const sendChatCompletion = async ({
  binding,
  messages,
  temperature,
  maxTokens,
  topP,
  frequencyPenalty,
  presencePenalty,
  preferJson,
  schemaType,
  signal,
}: ChatCompletionParams): Promise<ChatCompletionResult> => {
  const activeBinding = binding;
  const outboundMessages = prepareMessagesForTransport(messages, activeBinding.transport);

  const effectiveTemperature = temperature ?? activeBinding.temperature;
  const effectiveMaxTokens = maxTokens ?? activeBinding.maxOutputTokens;
  const effectiveTopP = topP ?? activeBinding.topP;
  const effectiveFrequencyPenalty =
    frequencyPenalty ?? activeBinding.frequencyPenalty;
  const effectivePresencePenalty = presencePenalty ?? activeBinding.presencePenalty;
  const prefersJson = preferJson ?? activeBinding.metadata?.supportsJsonMode ?? true;

  const resolveSchema = (type: SchemaType) => {
    switch (type) {
      case 'topologySubject':
        return TOPOLOGY_SUBJECT_SCHEMA;
      case 'topologyTopic':
        return TOPOLOGY_TOPIC_SCHEMA;
      case 'topologySubtopic':
        return TOPOLOGY_SUBTOPIC_SCHEMA;
      case 'answer':
      default:
        return ANSWER_SCHEMA;
    }
  };

  // Helper to build request payload for different JSON formats
  const buildPayload = (jsonFormat: JsonFormatType | null) => {
    let responseFormat = {};

    if (prefersJson && jsonFormat) {
      if (jsonFormat === 'json_object') {
        responseFormat = { response_format: { type: 'json_object' } };
      } else if (jsonFormat === 'json_schema' && schemaType) {
        const schema = resolveSchema(schemaType);
        responseFormat = {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: `${schemaType}_response`,
              schema,
              strict: true,
            },
          },
        };
      }
    }

    return {
      model: activeBinding.modelId,
      temperature: effectiveTemperature,
      max_tokens: effectiveMaxTokens,
      messages: outboundMessages,
      ...(effectiveTopP !== undefined && { top_p: effectiveTopP }),
      ...(effectiveFrequencyPenalty !== undefined && {
        frequency_penalty: effectiveFrequencyPenalty,
      }),
      ...(effectivePresencePenalty !== undefined && {
        presence_penalty: effectivePresencePenalty,
      }),
      // Note: reasoning_effort is NOT supported by LM Studio
      ...responseFormat,
    };
  };

  const attempt = async (jsonFormat: JsonFormatType | null) => {
    const payload = buildPayload(jsonFormat);

    return request<RawChatCompletionResponse>({
      path: '/v1/chat/completions',
      method: 'POST',
      body: payload,
      binding: activeBinding,
      signal,
    });
  };

  if (!prefersJson) {
    // Plain text mode requested - no JSON formatting
    const result = await attempt(null);

    if (!result.ok) {
      const error = result.data ?? (await result.raw.text());
      throw new Error(`Chat completion failed: ${result.status} - ${JSON.stringify(error)}`);
    }

    return {
      text: extractTextFromResponse(result.data),
      usage: mapUsage(result.data?.usage),
      raw: result.data,
      fallbackUsed: false,
      supportsJsonMode: false,
    };
  }

  // Try JSON mode - first attempt with json_object (OpenAI format)
  let result = await attempt('json_object');

  if (result.ok && result.data) {
    return {
      text: extractTextFromResponse(result.data),
      usage: mapUsage(result.data?.usage),
      raw: result.data,
      fallbackUsed: false,
      supportsJsonMode: true,
      jsonFormat: 'json_object',
    };
  }

  // Check if we need to try json_schema format
  const errorBody = result.data ?? (await result.raw.text());
  const jsonError = isJsonModeError(errorBody);

  if (jsonError.isError && jsonError.needsSchema && schemaType) {
    result = await attempt('json_schema');

    if (result.ok && result.data) {
      return {
        text: extractTextFromResponse(result.data),
        usage: mapUsage(result.data?.usage),
        raw: result.data,
        fallbackUsed: false,
        supportsJsonMode: true,
        jsonFormat: 'json_schema',
      };
    }
  }

  // Both JSON formats failed - determine if it's truly a JSON mode issue or other error
  const finalError = result.data ?? (await result.raw.text());
  const errorMessage = typeof finalError === 'string' ? finalError : JSON.stringify(finalError);

  // Check if this is actually a JSON mode compatibility issue or a different error
  const isActualJsonError = jsonError.isError ||
    /json mode|response[_-]?format/i.test(errorMessage);
  const isModelLoadError = result.status === 404 ||
    /model.*not.*found|failed to load model|insufficient.*resources/i.test(errorMessage);
  const jsonCompatibilitySummary = isActualJsonError
    ? 'JSON mode compatibility failure'
    : 'Non-JSON compatibility failure';

  // Log appropriate error based on type
  if (isModelLoadError) {
    console.error('[MODEL LOAD ERROR]', {
      status: result.status,
      error: errorMessage,
    });
  } else {
    console.warn(`[${jsonCompatibilitySummary}]`, {
      status: result.status,
      error: errorMessage,
    });
    console.error('[JSON MODE ERROR]', {
      status: result.status,
      schemaType,
      preferJson: prefersJson,
      error: errorMessage,
      triedJsonObject: true,
      triedJsonSchema: jsonError.isError && jsonError.needsSchema && schemaType ? true : false,
    });
  }

  // Throw appropriate error message
  if (isModelLoadError) {
    throw new Error(
      `Model loading failed: ${result.status} - ${errorMessage}`
    );
  } else {
    throw new Error(
      `JSON mode required but not supported: ${result.status} - ${errorMessage}`
    );
  }
};

export const fetchModels = async (
  binding: Pick<ModelBinding, 'baseUrl' | 'apiKey' | 'requestTimeoutMs' | 'transport'>
) => {
  const response = await request<{ data?: { id: string; object: string }[] }>({
    path: '/v1/models',
    method: 'GET',
    binding,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`);
  }

  return response.data?.data ?? [];
};
