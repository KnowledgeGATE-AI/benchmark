export type QuestionType = 'MCQ' | 'MSQ' | 'NAT' | 'TRUE_FALSE';

export type RunStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type DiagnosticsLevel = 'HANDSHAKE' | 'READINESS';

export type DiagnosticsSeverity = 'info' | 'warn' | 'error';

export interface BenchmarkQuestionOption {
  id: number;
  order: number;
  text: string;
}

export interface NumericAnswerRange {
  min?: number;
  max?: number;
  precision?: number;
}

export type BenchmarkQuestionAnswer =
  | {
      kind: 'single';
      correctOption: number;
    }
  | {
      kind: 'multiple';
      correctOptions: number[];
    }
  | {
      kind: 'numeric';
      range: NumericAnswerRange;
      acceptedAnswers: string[];
      caseSensitive: boolean;
    }
  | {
      kind: 'boolean';
      value: boolean;
    }
  | {
      kind: 'descriptive';
      acceptedAnswers: string[];
      caseSensitive: boolean;
    };

export interface BenchmarkQuestionMetadata {
  status: string;
  hasImages?: boolean;
  createdAt?: string;
  updatedAt?: string;
  tags: string[];
  topology?: {
    subjectId?: string | null;
    topicId?: string | null;
    subtopicId?: string | null;
  };
  pyq?: {
    type?: string | null;
    year?: number | null;
    exam?: string | null;
    branch?: string | null;
    paper?: string | null;
  };
}

export type BenchmarkQuestionMediaSource = 'prompt' | 'instructions' | 'option' | 'solution';

export interface BenchmarkQuestionMediaImage {
  id: string;
  url: string;
  source: BenchmarkQuestionMediaSource;
  optionIndex?: number;
  altText?: string | null;
  inferredFrom?: 'markdown' | 'html' | 'url' | 'metadata';
}

export interface BenchmarkQuestionMedia {
  images: BenchmarkQuestionMediaImage[];
}

export interface BenchmarkQuestion {
  id: string;
  questionId: number;
  displayId: string | null;
  type: QuestionType;
  difficulty: string;
  prompt: string;
  instructions?: string;
  options: BenchmarkQuestionOption[];
  answer: BenchmarkQuestionAnswer;
  solution?: string;
  metadata: BenchmarkQuestionMetadata;
  media?: BenchmarkQuestionMedia;
}

export interface QuestionDatasetSummary {
  label: string;
  generatedAt: string;
  total: number;
  filters: string[];
  stats: {
    poolSize?: number;
    poolWithoutImages?: number;
    countsByType?: Record<string, number>;
  };
}

export interface QuestionTopologySubtopic {
  id: string;
  name: string;
}

export interface QuestionTopologyTopic {
  id: string;
  name: string;
  subtopics: QuestionTopologySubtopic[];
}

export interface QuestionTopologySubject {
  id: string;
  name: string;
  topics: QuestionTopologyTopic[];
}

export interface QuestionTopology {
  generatedAt?: string;
  subjects: QuestionTopologySubject[];
}

export interface DiagnosticsLogEntry {
  id: string;
  timestamp: string;
  message: string;
  severity: DiagnosticsSeverity;
}

export interface DiagnosticsResult {
  id: string;
  profileId: string;
  level: DiagnosticsLevel;
  startedAt: string;
  completedAt: string;
  status: 'pass' | 'fail';
  summary: string;
  fallbackApplied?: boolean;
  metadata?: DiagnosticsMetadata;
  logs: DiagnosticsLogEntry[];
}

export interface DiagnosticsMetadata {
  supportsJsonMode?: boolean;
  evaluation?: BenchmarkAttemptEvaluation;
  expected?: string;
  questionId?: string;
  error?: string;
  [key: string]: unknown;
}

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

export interface BenchmarkStepConfig {
  id: string;
  label: string;
  description?: string;
  promptTemplate: string;
  enabled: boolean;
}

export type ModelBindingCapability = 'image-to-text' | 'text-to-text';

export type ModelBindingTransport = 'lmstudio' | 'openai-compatible' | 'openrouter';

export interface ModelBinding {
  id: string;
  name: string;
  capability: ModelBindingCapability;
  transport: ModelBindingTransport;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  defaultSystemPrompt: string;
  notes?: string;
  metadata?: {
    supportsJsonMode?: boolean;
  };
}

export interface ProfilePipelineStep {
  id: string;
  label: string;
  capability: ModelBindingCapability;
  bindingId: string | null;
  enabled: boolean;
}

export interface ModelProfile {
  id: string;
  name: string;
  description?: string;
  bindings: ModelBinding[];
  pipeline: ProfilePipelineStep[];
  benchmarkSteps?: BenchmarkStepConfig[]; // Optional - uses defaults if undefined
  createdAt: string;
  updatedAt: string;
  notes?: string;
  // Compatibility fields (deprecated - will be removed once callers migrate to bindings)
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
  diagnostics: DiagnosticsResult[];
  lastCompatibilityCheck?: CompatibilityCheckResult;
  metadata: {
    supportsJsonMode?: boolean;
    lastHandshakeAt?: string;
    lastReadinessAt?: string;
    // New compatibility check fields
    compatibilityStatus?: 'compatible' | 'incompatible' | 'unknown' | 'in_progress';
    jsonFormat?: 'json_object' | 'json_schema' | 'none';
    lastCompatibilityCheckAt?: string;
    compatibilitySummary?: string;
  };
  legacy?: {
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
  };
}

export interface BenchmarkModelResponse {
  answer?: string;
  explanation?: string;
  confidence?: number;
  raw?: unknown;
}

export type TopologyStage = 'subject' | 'topic' | 'subtopic';

export interface BenchmarkTopologyStageResult {
  stage: TopologyStage;
  id?: string;
  confidence?: number;
  raw?: unknown;
  subjectId?: string;
  topicId?: string;
}

export interface BenchmarkTopologyPrediction {
  subjectId?: string;
  subjectConfidence?: number;
  topicId?: string;
  topicConfidence?: number;
  subtopicId?: string;
  subtopicConfidence?: number;
  confidence?: number;
  raw?: {
    subject?: unknown;
    topic?: unknown;
    subtopic?: unknown;
    [key: string]: unknown;
  };
  stages?: {
    subject?: BenchmarkTopologyStageResult;
    topic?: BenchmarkTopologyStageResult;
    subtopic?: BenchmarkTopologyStageResult;
  };
}

export interface BenchmarkAttemptEvaluation {
  expected: string;
  received: string;
  passed: boolean;
  score: number;
  notes?: string;
  metrics?: {
    confidence?: number;
    subjectConfidence?: number;
    topicConfidence?: number;
    subtopicConfidence?: number;
    subjectMatch?: boolean;
    topicMatch?: boolean;
    subtopicMatch?: boolean;
    subjectExpected?: boolean;
    topicExpected?: boolean;
    subtopicExpected?: boolean;
    subjectProvided?: boolean;
    topicProvided?: boolean;
    subtopicProvided?: boolean;
  };
}

export interface BenchmarkAttemptStepUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface BenchmarkAttemptStepResult {
  id: string;
  label: string;
  order: number;
  prompt: string;
  requestPayload: Record<string, unknown>;
  responsePayload?: unknown;
  responseText: string;
  latencyMs: number;
  usage?: BenchmarkAttemptStepUsage;
  modelResponse?: BenchmarkModelResponse;
  topologyPrediction?: BenchmarkTopologyPrediction;
  topologyStage?: BenchmarkTopologyStageResult;
  evaluation?: BenchmarkAttemptEvaluation;
  notes?: string;
}

export interface BenchmarkAttempt {
  id: string;
  questionId: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  requestPayload: Record<string, unknown>;
  responsePayload?: unknown;
  responseText: string;
  modelResponse?: BenchmarkModelResponse;
  evaluation: BenchmarkAttemptEvaluation;
  topologyPrediction?: BenchmarkTopologyPrediction;
  topologyEvaluation?: BenchmarkAttemptEvaluation;
  steps: BenchmarkAttemptStepResult[];
  error?: string;
  imageSummaries?: ImageSummary[];
  questionSnapshot: {
    prompt: string;
    type: QuestionType;
    difficulty: string;
    options: BenchmarkQuestionOption[];
    answer: BenchmarkQuestionAnswer;
    solution?: string;
  };
}

export interface ImageSummary {
  id: string;
  image: BenchmarkQuestionMediaImage;
  url: string;
  text: string;
  status: 'ok' | 'skipped' | 'error';
  bindingId: string;
  bindingName: string;
  confidence?: number;
  raw?: unknown;
  generatedAt: string;
  errorMessage?: string;
}

export interface BenchmarkRunMetrics {
  accuracy: number;
  averageLatencyMs: number;
  totalLatencyMs: number;
  passedCount: number;
  failedCount: number;
  topologyAccuracy: number;
  topologyPassedCount: number;
  topologyFailedCount: number;
  topologySubjectAccuracy: number;
  topologySubjectPassedCount: number;
  topologySubjectFailedCount: number;
  topologyTopicAccuracy: number;
  topologyTopicPassedCount: number;
  topologyTopicFailedCount: number;
  topologySubtopicAccuracy: number;
  topologySubtopicPassedCount: number;
  topologySubtopicFailedCount: number;
}

export interface BenchmarkDataset {
  id: string;
  name: string;
  description?: string;
  questionIds: string[];
  filters: {
    types: string[];
    difficulty: string[];
    pyqYears: string[];
    search?: string;
  };
  metadata: {
    totalQuestions: number;
    hasImages: boolean;
    questionTypeBreakdown: Record<string, number>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkRun {
  id: string;
  label: string;
  profileId: string;
  profileName: string;
  profileModelId: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  datasetId: string;
  questionIds: string[];
  dataset: {
    id: string;
    name: string;
    label: string;
    totalQuestions: number;
    filters: string[];
  };
  metrics: BenchmarkRunMetrics;
  attempts: BenchmarkAttempt[];
  notes?: string;
  summary?: string;
}

export type ActiveRunPhase = 'starting' | 'running' | 'completed' | 'failed';

export type ActiveRunQuestionStatus = 'queued' | 'running' | 'passed' | 'failed' | 'partial';

export interface ActiveRunQuestionProgress {
  id: string;
  order: number;
  label: string;
  prompt: string;
  type: QuestionType;
  status: ActiveRunQuestionStatus;
  latencyMs?: number;
  attemptId?: string;
  notes?: string;
}

export interface ActiveRunState {
  runId: string;
  label: string;
  profileName: string;
  profileModelId: string;
  datasetLabel: string;
  filters: string[];
  totalQuestions: number;
  status: ActiveRunPhase;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  currentQuestionId?: string;
  metrics: BenchmarkRunMetrics;
  questions: ActiveRunQuestionProgress[];
  summary?: string;
  error?: string;
}

export interface ActiveRunStartPayload {
  runId: string;
  label: string;
  profileName: string;
  profileModelId: string;
  datasetLabel: string;
  filters: string[];
  questions: {
    id: string;
    order: number;
    label: string;
    prompt: string;
    type: QuestionType;
  }[];
  startedAt: string;
}

export interface ActiveRunQuestionStartPayload {
  runId: string;
  questionId: string;
  timestamp: string;
}

export interface ActiveRunAttemptPayload {
  runId: string;
  questionId: string;
  attemptId: string;
  passed: boolean;
  latencyMs: number;
  metrics: BenchmarkRunMetrics;
  notes?: string;
  timestamp: string;
}

export interface ActiveRunCompletePayload {
  runId: string;
  status: 'completed' | 'failed';
  summary: string;
  metrics: BenchmarkRunMetrics;
  completedAt: string;
  error?: string;
}

export interface DashboardRunSummary {
  runId: string;
  label: string;
  profileName: string;
  profileModelId: string;
  completedAt: string;
  accuracy: number;
  averageLatencyMs: number;
}

export interface DashboardOverview {
  totalRuns: number;
  activeRuns: number;
  averageAccuracy: number;
  averageTopologyAccuracy: number;
  averageLatencyMs: number;
  lastUpdated?: string;
  latestRuns: DashboardRunSummary[];
  accuracyTrend: { timestamp: string; accuracy: number; runId: string }[];
  topologyAccuracyTrend: { timestamp: string; topologyAccuracy: number; runId: string }[];
  latencyTrend: { timestamp: string; latencyMs: number; runId: string }[];
}

export type ModelCapability =
  | 'tool_use'
  | 'vision'
  | 'embeddings'
  | 'audio'
  | 'function_calling'
  | (string & {});

export interface DiscoveredModel {
  id: string;
  /** Friendly label or alias reported by LM Studio */
  displayName?: string;
  /** Model type (llm, vlm, embeddings, etc.) */
  kind?: string;
  /** Current load state (loaded, unloaded, etc.) */
  state?: string;
  /** Maximum supported context length (tokens) */
  maxContextLength?: number;
  /** Quantization descriptor such as Q4_K_M */
  quantization?: string | null;
  /** Optional filesystem source or archive name */
  source?: string | null;
  /** Capabilities advertised by the runtime */
  capabilities: ModelCapability[];
  /** Whether the runtime reports the model as loaded */
  loaded?: boolean;
  /** Origin information for the discovery request */
  origin?: {
    baseUrl: string;
    endpoint: string;
  };
  /** Raw metadata payload for future use/debugging */
  metadata?: Record<string, unknown>;
}

export type ModelDiscoveryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelDiscoveryState {
  status: ModelDiscoveryStatus;
  models: DiscoveredModel[];
  lastFetchedAt?: string;
  error?: string;
}

export interface BenchmarkRunQueue {
  currentRunId: string | null;
  queuedRunIds: string[];
}
