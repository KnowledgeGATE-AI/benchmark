import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ActiveRunQuestionStatus,
  BenchmarkAttempt,
  ImageSummary,
  RunStatus,
} from '@/types/benchmark';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import { questionLookup } from '@/data/questions';
import JsonView from 'react18-json-view';
import 'react18-json-view/src/style.css';

const runStatusLabels: Record<RunStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const runStatusClasses: Record<RunStatus, string> = {
  draft:
    'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  queued:
    'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  running:
    'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300',
  completed:
    'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  failed:
    'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
  cancelled:
    'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
};

const questionStatusLabels: Record<ActiveRunQuestionStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  partial: 'Partial',
};

const questionStatusClasses: Record<ActiveRunQuestionStatus, string> = {
  queued:
    'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  running:
    'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300',
  passed:
    'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  partial:
    'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  failed:
    'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
};

const stepStatusClasses: Record<'passed' | 'failed' | 'completed', string> = {
  passed: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  failed: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
  completed: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

const imageSummaryStatusClasses: Record<ImageSummary['status'], string> = {
  ok: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  skipped: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  error: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
};

const formatDateTime = (iso?: string) => {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

const formatElapsed = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const computeElapsedMs = (startedAt?: string, completedAt?: string) => {
  if (!startedAt) {
    return 0;
  }
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return end - start;
};

const formatLatency = (latencyMs?: number) => {
  if (!Number.isFinite(latencyMs) || latencyMs == null) {
    return '—';
  }
  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(2)} s`;
  }
  return `${Math.round(latencyMs)} ms`;
};

// Helper component to display JSON with collapsible structure or plain text fallback
const JsonOrText = ({ text, className = '' }: { text: string; className?: string }) => {
  // Check if we're in dark mode
  const isDarkMode = document.documentElement.classList.contains('dark');

  try {
    const parsed = JSON.parse(text);
    return (
      <div className={`text-xs ${className}`}>
        <JsonView
          src={parsed}
          theme={isDarkMode ? 'a11y' : 'default'}
          dark={isDarkMode}
          collapsed={1}
          displaySize={false}
          enableClipboard={false}
          style={{
            fontSize: '0.75rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
        />
      </div>
    );
  } catch {
    // Not valid JSON, display as plain text
    return (
      <pre className={`text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap overflow-x-auto ${className}`}>
        {text}
      </pre>
    );
  }
};

interface QuestionItem {
  id: string;
  label: string;
  prompt: string;
  type: string;
  status: ActiveRunQuestionStatus;
  topologyStatus?: 'passed' | 'failed';
  answerStatus?: 'passed' | 'failed';
  latencyMs?: number;
  attempt?: BenchmarkAttempt;
}

const RunDetail = () => {
  const { runId } = useParams();
  const navigate = useNavigate();
  const {
    loading,
    getRunById,
    getProfileById,
    deleteRun,
    activeRun,
    runQueue,
    getQueuePosition,
    dequeueRun,
  } = useBenchmarkContext();
  const run = runId ? getRunById(runId) : undefined;
  const profile = run ? getProfileById(run.profileId) : undefined;
  const isActiveRun = Boolean(run && activeRun && activeRun.runId === run.id);
  const [elapsedMs, setElapsedMs] = useState(() =>
    computeElapsedMs(run?.startedAt, run?.completedAt ?? activeRun?.completedAt)
  );

  useEffect(() => {
    setElapsedMs(computeElapsedMs(run?.startedAt, run?.completedAt ?? activeRun?.completedAt));

    if (
      !isActiveRun ||
      !run?.startedAt ||
      activeRun?.status === 'completed' ||
      activeRun?.status === 'failed'
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedMs(computeElapsedMs(run?.startedAt, activeRun?.completedAt));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    isActiveRun,
    run?.startedAt,
    run?.completedAt,
    activeRun?.completedAt,
    activeRun?.status,
    activeRun?.runId,
  ]);

  const attemptsByQuestion = useMemo(() => {
    const map = new Map<string, BenchmarkAttempt>();
    run?.attempts.forEach((attempt) => {
      map.set(attempt.questionId, attempt);
    });
    return map;
  }, [run?.attempts]);

  const questionItems = useMemo<QuestionItem[]>(() => {
    if (!run) {
      return [];
    }
    if (isActiveRun && activeRun) {
      return activeRun.questions.map((question) => {
        const attempt = attemptsByQuestion.get(question.id);

        // For active runs, compute topology and answer statuses from attempt if available
        const topologyStatus = attempt?.topologyEvaluation
          ? attempt.topologyEvaluation.passed
            ? 'passed'
            : 'failed'
          : undefined;

        const answerStatus = attempt
          ? attempt.evaluation.passed
            ? 'passed'
            : 'failed'
          : undefined;

        return {
          id: question.id,
          label: question.label,
          prompt: question.prompt,
          type: question.type,
          status: question.status,
          topologyStatus,
          answerStatus,
          latencyMs: attempt?.latencyMs ?? question.latencyMs,
          attempt,
        };
      });
    }

    return run.questionIds.map((questionId, index) => {
      const attempt = attemptsByQuestion.get(questionId);
      const sourceQuestion = questionLookup.get(questionId);
      const questionNumber = index + 1;
      const numericId = sourceQuestion?.questionId;
      const label = numericId
        ? `Question ${questionNumber} (ID: ${numericId})`
        : `Question ${questionNumber}`;
      const prompt = attempt?.questionSnapshot.prompt ?? sourceQuestion?.prompt ?? '';
      const type = attempt?.questionSnapshot.type ?? sourceQuestion?.type ?? 'Unknown';

      // Separate topology and answer statuses
      const topologyStatus = attempt?.topologyEvaluation
        ? attempt.topologyEvaluation.passed
          ? 'passed'
          : 'failed'
        : undefined;

      const answerStatus = attempt
        ? attempt.evaluation.passed
          ? 'passed'
          : 'failed'
        : undefined;

      // Determine overall status based on BOTH topology and answer
      let status: ActiveRunQuestionStatus = 'queued';
      if (attempt) {
        const answerPassed = attempt.evaluation.passed;
        const topologyPassed = attempt.topologyEvaluation?.passed;

        if (topologyPassed === undefined) {
          // No topology evaluation, just use answer
          status = answerPassed ? 'passed' : 'failed';
        } else if (answerPassed && topologyPassed) {
          status = 'passed'; // Both passed
        } else if (!answerPassed && !topologyPassed) {
          status = 'failed'; // Both failed
        } else {
          status = 'partial'; // Mixed results
        }
      }

      return {
        id: questionId,
        label,
        prompt,
        type,
        status,
        topologyStatus,
        answerStatus,
        latencyMs: attempt?.latencyMs,
        attempt,
      };
    });
  }, [activeRun, attemptsByQuestion, isActiveRun, run]);

  const [selectedQuestionId, setSelectedQuestionId] = useState<string | undefined>(() =>
    questionItems[0]?.id
  );
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [expandedImageSection, setExpandedImageSection] = useState(false);

  const toggleStepExpansion = (stepKey: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepKey)) {
        next.delete(stepKey);
      } else {
        next.add(stepKey);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!questionItems.length) {
      setSelectedQuestionId(undefined);
      return;
    }

    // For active runs, only auto-select if no question is currently selected
    // or if the selected question doesn't exist
    if (isActiveRun && activeRun?.currentQuestionId) {
      // Only auto-follow if user hasn't manually selected a different question
      if (!selectedQuestionId || !questionItems.some((item) => item.id === selectedQuestionId)) {
        setSelectedQuestionId(activeRun.currentQuestionId);
      }
      return;
    }

    if (!selectedQuestionId || !questionItems.some((item) => item.id === selectedQuestionId)) {
      setSelectedQuestionId(questionItems[0].id);
    }
  }, [activeRun?.currentQuestionId, isActiveRun, questionItems, selectedQuestionId]);

  const selectedItem =
    questionItems.find((item) => item.id === selectedQuestionId) ?? questionItems[0];

const selectedDefinition = useMemo(() => {
  if (!selectedItem) {
    return undefined;
  }
  if (selectedItem.attempt?.questionSnapshot) {
    return selectedItem.attempt.questionSnapshot;
  }
  return questionLookup.get(selectedItem.id);
}, [selectedItem]);

  const selectedImageSummaries = selectedItem?.attempt?.imageSummaries ?? [];

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Run Details
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Loading run information...
          </p>
        </header>

        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-accent-200 dark:border-accent-800 border-t-accent-600 dark:border-t-accent-400 rounded-full animate-spin"></div>
            <p className="text-slate-600 dark:text-slate-400 font-medium">Loading run details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 transition-theme">
        <header className="flex flex-col gap-2 mb-6">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Run not found
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            The requested run does not exist. Head back to the runs list and try again.
          </p>
        </header>
        <Link
          className="inline-block bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-6 py-2.5 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
          to="/runs"
        >
          Back to runs
        </Link>
      </section>
    );
  }

  const accuracy = run.metrics.accuracy ? `${(run.metrics.accuracy * 100).toFixed(1)}%` : '—';
  const averageLatency = formatLatency(run.metrics.averageLatencyMs);
  const totalLatency = formatLatency(run.metrics.totalLatencyMs);
  const answeredCount = run.metrics.passedCount + run.metrics.failedCount;
  const totalQuestions = run.questionIds.length;
  const remainingCount = Math.max(totalQuestions - answeredCount, 0);
  const elapsed = formatElapsed(elapsedMs);
  const lastUpdated = isActiveRun
    ? formatDateTime(activeRun?.updatedAt)
    : formatDateTime(run.completedAt ?? run.startedAt);
  const tokensSummary = run.attempts.reduce(
    (acc, attempt) => ({
      prompt: acc.prompt + (attempt.promptTokens ?? 0),
      completion: acc.completion + (attempt.completionTokens ?? 0),
      total: acc.total + (attempt.totalTokens ?? 0),
    }),
    { prompt: 0, completion: 0, total: 0 }
  );

  const handleDelete = () => {
    const message =
      run.status === 'running'
        ? 'This run is still running. Deleting it will discard progress. Continue?'
        : 'Delete this run and all attempt data?';
    if (!window.confirm(message)) {
      return;
    }
    deleteRun(run.id);
    void navigate('/runs');
  };

  const handleRerun = () => {
    if (!run) {
      return;
    }

    // Navigate to /runs with rerun state to open the New Run panel
    void navigate('/runs', {
      state: {
        rerun: {
          questionIds: run.questionIds,
          label: `Rerun of ${run.label}`,
          filters: run.dataset.filters ?? [],
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 transition-theme flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div className="flex flex-col gap-4">
          <Link
            className="inline-flex items-center gap-1.5 text-accent-700 dark:text-accent-400 hover:text-accent-800 dark:hover:text-accent-300 font-semibold transition-colors"
            to="/runs"
          >
            ← Back to runs
          </Link>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">
                {run.label}
              </h2>
              <span
                className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${runStatusClasses[run.status]}`}
              >
                {runStatusLabels[run.status]}
              </span>
              {isActiveRun && activeRun?.status === 'running' ? (
                <span className="px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-accent-500 text-white animate-pulse">
                  Live
                </span>
              ) : null}
            </div>
            <div className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
              <div className="font-semibold mb-1">Profile: {run.profileName}</div>
              {profile?.bindings && profile.bindings.length > 0 ? (
                <div className="flex flex-col gap-1 text-sm">
                  {profile.bindings.map((binding) => (
                    <div key={binding.id} className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-200 dark:bg-slate-700">
                        {binding.capability === 'text-to-text' ? 'Text' : 'Vision'}
                      </span>
                      <span className="text-slate-700 dark:text-slate-300">
                        {binding.name}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">·</span>
                      <span className="text-slate-600 dark:text-slate-400">
                        {binding.modelId}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm">{run.profileModelId}</div>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Started {formatDateTime(run.startedAt)} · Last update {lastUpdated}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-4 py-2 rounded-xl transition-all duration-200"
            type="button"
            onClick={handleRerun}
            title="Rerun with same settings"
          >
            Rerun
          </button>
          <button
            className="bg-gradient-to-r from-danger-600 to-danger-700 hover:from-danger-700 hover:to-danger-800 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
            type="button"
            onClick={handleDelete}
          >
            Delete run
          </button>
        </div>
      </section>

      {run.status === 'queued' && (() => {
        const position = getQueuePosition(run.id);
        const totalQueued = runQueue.queuedRunIds.length;
        return position > 0 ? (
          <section className="bg-warning-50 dark:bg-warning-900/10 border border-warning-200 dark:border-warning-700 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 transition-theme">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-warning-800 dark:text-warning-300">
                This run is queued for execution
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Position #{position} of {totalQueued} in queue{' '}
                {runQueue.currentRunId ? '· Waiting for current run to complete' : '· Will start soon'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Remove this run from the queue?')) {
                  dequeueRun(run.id);
                }
              }}
              className="border border-danger-400 dark:border-danger-500 bg-danger-500/8 dark:bg-danger-500/10 text-danger-700 dark:text-danger-400 hover:bg-danger-500/16 dark:hover:bg-danger-500/20 font-semibold px-4 py-2 rounded-xl text-sm transition-all duration-200"
            >
              Cancel & Remove from Queue
            </button>
          </section>
        ) : null;
      })()}

      <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
        <article className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Answer Accuracy
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">{accuracy}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {run.metrics.passedCount} passed · {run.metrics.failedCount} failed
          </p>
        </article>
        <article className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Topology Accuracy
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            {run.metrics.topologyAccuracy ? `${(run.metrics.topologyAccuracy * 100).toFixed(1)}%` : '—'}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {run.metrics.topologyPassedCount} passed · {run.metrics.topologyFailedCount} failed
          </p>
        </article>
        <article className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Average latency
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            {averageLatency}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Total {totalLatency}</p>
        </article>
        <article className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Elapsed
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">{elapsed}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Updated {lastUpdated}
          </p>
        </article>
        <article className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 sm:p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Questions
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            {answeredCount}/{totalQuestions}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {remainingCount} remaining
          </p>
        </article>
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 sm:p-5 lg:p-6 flex flex-col gap-3 sm:gap-4 transition-theme">
        <header className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Dataset
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {run.dataset.label} · {run.dataset.totalQuestions} questions
          </p>
        </header>
        <div className="flex flex-wrap gap-2">
          {run.dataset.filters.length === 0 ? (
            <span className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-300">
              No additional filters
            </span>
          ) : (
            run.dataset.filters.map((filter) => (
              <span
                key={filter}
                className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-300"
              >
                {filter}
              </span>
            ))
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Prompt tokens
            </h4>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {tokensSummary.prompt.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Completion tokens
            </h4>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {tokensSummary.completion.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total tokens
            </h4>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {tokensSummary.total.toLocaleString()}
            </p>
          </div>
        </div>
        {run.summary ? (
          <p className="text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/30 p-4 rounded-xl">
            {run.summary}
          </p>
        ) : null}
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Attempt breakdown
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Inspect model responses, evaluations, and status for each question. Live runs will
            automatically follow the active question.
          </p>
        </header>
        {questionItems.length === 0 ? (
          <p className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center">
            No questions tracked for this run.
          </p>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6">
            <nav className="lg:w-72 flex-shrink-0">
              <ul className="flex flex-row lg:flex-col gap-3 overflow-x-auto pb-2 lg:pb-0">
                {questionItems.map((item) => {
                  const isSelected = item.id === selectedItem?.id;
                  return (
                    <li key={item.id} className="min-w-[14rem] lg:min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedQuestionId(item.id)}
                        className={`w-full text-left rounded-xl border p-4 flex flex-col gap-2 transition-all ${
                          isSelected
                            ? 'border-accent-400 dark:border-accent-500 bg-accent-50 dark:bg-accent-900/20 shadow-sm'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-accent-300 dark:hover:border-accent-500'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            {item.label}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${questionStatusClasses[item.status]}`}
                          >
                            {questionStatusLabels[item.status]}
                          </span>
                        </div>
                        {item.topologyStatus || item.answerStatus ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.topologyStatus && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-500 dark:text-slate-400">T:</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    item.topologyStatus === 'passed'
                                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                                      : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
                                  }`}
                                >
                                  {item.topologyStatus === 'passed' ? '✓' : '✗'}
                                </span>
                              </div>
                            )}
                            {item.answerStatus && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-500 dark:text-slate-400">A:</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    item.answerStatus === 'passed'
                                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                                      : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
                                  }`}
                                >
                                  {item.answerStatus === 'passed' ? '✓' : '✗'}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                          <span>{item.type}</span>
                          <span>{formatLatency(item.latencyMs)}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <article className="flex-1 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 bg-slate-50 dark:bg-slate-900/30 flex flex-col gap-4 transition-theme">
              {selectedItem ? (
                <>
                  <header className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h4 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
                        {selectedItem.label}
                      </h4>
                      <span
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${questionStatusClasses[selectedItem.status]}`}
                      >
                        {questionStatusLabels[selectedItem.status]}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {selectedItem.type} · Total latency: {formatLatency(selectedItem.latencyMs)}
                    </p>
                  </header>

                  {selectedItem.attempt ? (
                    <>
                      {/* Image Processing Section */}
                      {selectedImageSummaries.length > 0 ? (
                        <section className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900/40">
                          <button
                            type="button"
                            onClick={() => setExpandedImageSection(!expandedImageSection)}
                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors rounded-xl"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                Image Processing
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {selectedImageSummaries.length} image{selectedImageSummaries.length === 1 ? '' : 's'}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                selectedImageSummaries.every(s => s.status === 'ok')
                                  ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                                  : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400'
                              }`}>
                                {selectedImageSummaries.every(s => s.status === 'ok') ? 'All successful' : `${selectedImageSummaries.filter(s => s.status !== 'ok').length} failed`}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {expandedImageSection ? 'Click to collapse' : 'Click to expand'}
                              </span>
                            </div>
                          </button>
                          {expandedImageSection && (
                            <div className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-slate-200 dark:border-slate-700">
                              {selectedImageSummaries.map((summary, index) => (
                                <div key={summary.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col lg:flex-row gap-3">
                                  <div className="flex-1 flex flex-col gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                                        Image {index + 1} • {summary.image.source.toUpperCase()}
                                      </span>
                                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${imageSummaryStatusClasses[summary.status]}`}>
                                        {summary.status}
                                      </span>
                                    </div>
                                    <img
                                      src={summary.url}
                                      alt={summary.image.altText || `Image ${index + 1}`}
                                      className="max-w-full h-auto rounded border border-slate-200 dark:border-slate-700"
                                      loading="lazy"
                                    />
                                    <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                                      <div className="font-semibold">Vision Model Prompt:</div>
                                      <div className="ml-2">
                                        <p className="italic mb-1">System: "You are an expert at analyzing educational technical images including diagrams, graphs, tables, circuits, network topologies, mathematical figures, flowcharts, and data structures. Your goal is to provide comprehensive, detailed descriptions that fully explain the image content."</p>
                                        <p className="italic">User: "This is an educational image. Provide a COMPREHENSIVE description including:</p>
                                        <ul className="list-disc ml-4 mt-1">
                                          <li>Type of image (diagram, graph, table, etc.)</li>
                                          <li>Main components and their labels</li>
                                          <li>Relationships and connections between elements</li>
                                          <li>All text, numbers, labels, and annotations</li>
                                          <li>Visual structure and layout</li>
                                          <li>Arrows, lines, connectors and what they represent</li>
                                          <li>All details needed to understand and answer questions</li>
                                        </ul>
                                        <p className="italic mt-1">Do NOT worry about response length - be as detailed as necessary. Focus on accuracy and completeness."</p>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex-1 flex flex-col gap-2">
                                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                                      Vision Model Response
                                    </span>
                                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded p-2">
                                      <div className="text-xs text-slate-700 dark:text-slate-300">
                                        <div className="font-semibold mb-1">Description:</div>
                                        <p className="whitespace-pre-wrap">{summary.text}</p>
                                      </div>
                                      {summary.confidence != null && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                                          Confidence: {(summary.confidence * 100).toFixed(0)}%
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      ) : null}

                      {/* Sequential Steps */}
                      {selectedItem.attempt.steps && selectedItem.attempt.steps.length > 0 ? (
                        <div className="flex flex-col gap-3">
                          {[...selectedItem.attempt.steps]
                            .sort((a, b) => a.order - b.order)
                            .map((step) => {
                              const stepKey = `${selectedItem.id}-${step.id}`;

                              // Determine status and comparison based on step type
                              let statusKey: 'passed' | 'failed' | 'completed' = 'completed';
                              let comparisonText = '';

                              if (step.id === 'topology-subject' || step.id === 'topology-topic' || step.id === 'topology-subtopic') {
                                // For topology steps, use the evaluation from the step itself
                                if (step.evaluation) {
                                  statusKey = step.evaluation.passed ? 'passed' : 'failed';
                                  comparisonText = step.evaluation.passed
                                    ? step.evaluation.received || ''
                                    : `${step.evaluation.expected} → ${step.evaluation.received}`;
                                }
                              } else if (step.id === 'answer') {
                                // For answer step
                                if (step.evaluation) {
                                  statusKey = step.evaluation.passed ? 'passed' : 'failed';
                                  comparisonText = step.evaluation.passed
                                    ? step.evaluation.received || ''
                                    : `${step.evaluation.expected} → ${step.evaluation.received}`;
                                }
                              } else {
                                // Other steps
                                if (step.evaluation) {
                                  statusKey = step.evaluation.passed ? 'passed' : 'failed';
                                  comparisonText = `${step.evaluation.expected} → ${step.evaluation.received}`;
                                }
                              }

                              const shouldAutoExpand = statusKey === 'failed';
                              const isExpanded = expandedSteps.has(stepKey) || shouldAutoExpand;

                              return (
                                <section
                                  key={stepKey}
                                  className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900/40"
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleStepExpansion(stepKey)}
                                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-900/60 transition-colors rounded-xl"
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                        Step {step.order + 1}: {step.label}
                                      </span>
                                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${stepStatusClasses[statusKey]}`}>
                                        {statusKey === 'passed' ? 'Pass' : statusKey === 'failed' ? 'Fail' : 'Complete'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      {comparisonText && (
                                        <span className="text-xs text-slate-600 dark:text-slate-400">
                                          {comparisonText} {statusKey === 'passed' ? '✓' : statusKey === 'failed' ? '✗' : ''}
                                        </span>
                                      )}
                                      <span className="text-xs text-slate-500 dark:text-slate-400">
                                        {formatLatency(step.latencyMs)}
                                      </span>
                                      <span className="text-xs text-slate-500 dark:text-slate-400">
                                        {isExpanded ? '▼' : '▶'}
                                      </span>
                                    </div>
                                  </button>

                                  {isExpanded && (
                                    <div className="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-slate-200 dark:border-slate-700">
                                      {/* Prompt */}
                                      <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Prompt
                                          </span>
                                          <span className="text-xs text-slate-500 dark:text-slate-400">
                                            {step.prompt.length} chars
                                          </span>
                                        </div>
                                        <pre className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap overflow-x-auto">
                                          {step.prompt}
                                        </pre>
                                      </div>

                                      {/* Response */}
                                      <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 block mb-2">
                                          Response
                                        </span>
                                        {step.responseText ? (
                                          <JsonOrText text={step.responseText} />
                                        ) : (
                                          <span className="text-xs text-slate-500 dark:text-slate-400">—</span>
                                        )}
                                      </div>

                                      {/* Evaluation Details */}
                                      {step.evaluation && (
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 block mb-1">
                                              Expected
                                            </span>
                                            <span className="text-sm text-slate-900 dark:text-slate-50">
                                              {step.evaluation.expected || '—'}
                                            </span>
                                          </div>
                                          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 block mb-1">
                                              Received
                                            </span>
                                            <span className="text-sm text-slate-900 dark:text-slate-50">
                                              {step.evaluation.received || '—'}
                                            </span>
                                          </div>
                                          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 block mb-1">
                                              Result
                                            </span>
                                            <span className={`text-sm font-semibold ${step.evaluation.passed ? 'text-success-700 dark:text-success-400' : 'text-danger-700 dark:text-danger-400'}`}>
                                              {step.evaluation.passed ? 'Match' : 'Mismatch'}
                                            </span>
                                          </div>
                                        </div>
                                      )}

                                      {/* Metadata */}
                                      {step.usage && (
                                        <div className="text-xs text-slate-600 dark:text-slate-400">
                                          Tokens: {step.usage.totalTokens || '—'} (prompt {step.usage.promptTokens || 0}, completion {step.usage.completionTokens || 0})
                                        </div>
                                      )}

                                      {/* Official Solution - only show for answer step */}
                                      {step.id === 'answer' && selectedDefinition?.solution && (
                                        <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 block mb-2">
                                            Official Solution
                                          </span>
                                          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                                            {selectedDefinition.solution}
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </section>
                              );
                            })}
                        </div>
                      ) : (
                        <section className="border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-900/40 p-4">
                          <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
                            No step breakdown available for this attempt.
                          </p>
                        </section>
                      )}
                    </>
                  ) : (
                    <section className="border border-accent-200 dark:border-accent-700 rounded-xl bg-accent-50/70 dark:bg-accent-900/10 p-4">
                      <p className="text-sm text-accent-700 dark:text-accent-300">
                        {selectedItem.status === 'queued'
                          ? 'This question is queued and will be evaluated soon.'
                          : selectedItem.status === 'running'
                          ? 'The model is currently answering this question. Details will appear once the response is evaluated.'
                          : 'No attempt data recorded for this question yet.'}
                      </p>
                    </section>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Select a question to inspect the model response.
                </p>
              )}
            </article>
          </div>
        )}
      </section>
    </div>
  );
};

export default RunDetail;
