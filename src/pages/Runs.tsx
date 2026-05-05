import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ActiveRunPhase,
  BenchmarkQuestion,
  BenchmarkRun,
  ModelProfile,
  RunStatus,
} from '@/types/benchmark';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import { questionLookup } from '@/data/questions';
import { createEmptyRunMetrics } from '@/data/defaults';
import Modal from '@/components/Modal';

const statusLabels: Record<RunStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const statusClass: Record<RunStatus, string> = {
  draft: 'draft',
  queued: 'queued',
  running: 'running',
  completed: 'ready',
  failed: 'failed',
  cancelled: 'failed',
};

const activeRunStatusLabels: Record<ActiveRunPhase, string> = {
  starting: 'Starting',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const activeRunStatusClasses: Record<ActiveRunPhase, string> = {
  starting:
    'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  running:
    'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300',
  completed:
    'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  failed:
    'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
};

const formatDateTime = (iso?: string) => {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  const day = date.getDate();
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${day} ${month} ${year}, ${time}`;
};

const formatDuration = (startedAt?: string, completedAt?: string) => {
  if (!startedAt) {
    return '—';
  }

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return '—';
  }

  const totalSeconds = Math.floor((end - start) / 1000);
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

const formatLatency = (latencyMs?: number) => {
  if (!Number.isFinite(latencyMs) || latencyMs == null) {
    return '—';
  }
  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(2)} s`;
  }
  return `${Math.round(latencyMs)} ms`;
};

const profileSupportsVision = (profile: ModelProfile): boolean => {
  const visionStep = profile.pipeline.find((step) => step.capability === 'image-to-text');
  if (!visionStep || !visionStep.enabled || !visionStep.bindingId) {
    return false;
  }
  return profile.bindings.some(
    (binding) => binding.id === visionStep.bindingId && binding.capability === 'image-to-text'
  );
};

interface LaunchRunPayload {
  profileIds: string[];  // Changed to array for multi-profile support
  label: string;
  datasetId: string;  // Reference to selected dataset
}


/**
 * Format date as "25 Jun 2025, 3:45 PM"
 */
const formatRunLabel = (date: Date): string => {
  const day = date.getDate();
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${day} ${month} ${year}, ${time}`;
};

interface NewRunPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: (payload: LaunchRunPayload) => Promise<void>;
  initialDatasetId?: string;
  initialLabel?: string;
}

const NewRunPanel = ({ isOpen, onClose, onLaunch, initialDatasetId, initialLabel }: NewRunPanelProps) => {
  const { profiles, datasets } = useBenchmarkContext();

  // Filter to only show compatibility-passed profiles
  const compatibleProfiles = useMemo(
    () =>
      profiles.filter(
        (profile) => profile.metadata.compatibilityStatus === 'compatible'
      ),
    [profiles]
  );

  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(
    () => new Set(compatibleProfiles.length > 0 ? [compatibleProfiles[0].id] : [])
  );
  const [runLabel, setRunLabel] = useState<string>(
    initialLabel ?? formatRunLabel(new Date())
  );
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(
    initialDatasetId ?? (datasets.length > 0 ? datasets[0].id : '')
  );
  const [launching, setLaunching] = useState(false);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId),
    [datasets, selectedDatasetId]
  );

  const requiresVision = selectedDataset?.metadata.hasImages ?? false;
  const supportedProfiles = useMemo(() => {
    if (!requiresVision) {
      return compatibleProfiles;
    }
    return compatibleProfiles.filter((profile) => profileSupportsVision(profile));
  }, [compatibleProfiles, requiresVision]);
  const incompatibleCount = profiles.length - compatibleProfiles.length;
  const visionFilteredCount = compatibleProfiles.length - supportedProfiles.length;

  useEffect(() => {
    if (supportedProfiles.length === 0) {
      setSelectedProfileIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    setSelectedProfileIds((prev) => {
      const allowed = new Set(supportedProfiles.map((profile) => profile.id));
      const retained = Array.from(prev).filter((id) => allowed.has(id));
      const hasSameSelection =
        retained.length === prev.size && retained.every((id) => prev.has(id));
      if (hasSameSelection) {
        return prev;
      }
      const next = new Set<string>(retained);
      if (next.size === 0) {
        next.add(supportedProfiles[0].id);
      }
      return next;
    });
  }, [supportedProfiles]);

  // Sync state with initial props when panel opens with rerun data
  useEffect(() => {
    if (isOpen) {
      if (initialDatasetId) {
        setSelectedDatasetId(initialDatasetId);
      }
      if (initialLabel) {
        setRunLabel(initialLabel);
      }
    }
  }, [isOpen, initialDatasetId, initialLabel]);

  const toggleSet = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  };

  const handleToggleProfile = (profileId: string) => () => {
    setSelectedProfileIds((prev) => toggleSet(prev, profileId));
  };

  const handleLaunch = async (event: FormEvent) => {
    event.preventDefault();
    if (selectedProfileIds.size === 0 || !selectedDatasetId || !selectedDataset) {
      return;
    }

    setLaunching(true);

    try {
      await onLaunch({
        profileIds: [...selectedProfileIds],
        label: runLabel,
        datasetId: selectedDatasetId,
      });
      onClose();
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Launch new benchmark">
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          void handleLaunch(event);
        }}
      >
        <div className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-400">
          <p>Select a validated profile and curate the question set (up to 100 items).</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            After launch we will open a full-screen dashboard so you can watch the run in real time.
          </p>
        </div>

        <label className="flex flex-col">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            Run label
          </span>
          <input
            type="text"
            value={runLabel}
            onChange={(event) => setRunLabel(event.target.value)}
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
          />
        </label>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Model profiles
            </span>
            <span className="text-xs font-semibold text-accent-700 dark:text-accent-400 px-2.5 py-1 rounded-full bg-accent-100 dark:bg-accent-900/30">
              {selectedProfileIds.size} selected → {selectedProfileIds.size} {selectedProfileIds.size === 1 ? 'run' : 'runs'} will be created
            </span>
          </div>
          {requiresVision ? (
            <p className="text-xs text-warning-700 dark:text-warning-400">
              Selected questions include images. Only profiles with an active vision binding are shown.
            </p>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Profiles that passed compatibility checks appear here. Select one or more to launch parallel runs.
            </p>
          )}
          <div className="max-h-60 overflow-y-auto flex flex-col gap-2 border border-slate-300 dark:border-slate-600 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-900/30">
            {profiles.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-3">
                No profiles available. Create a profile first.
              </p>
            ) : compatibleProfiles.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm font-semibold text-danger-700 dark:text-danger-400 mb-2">
                  No compatible models available
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                  All {profiles.length} {profiles.length === 1 ? 'profile' : 'profiles'} failed compatibility checks.
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Run compatibility checks on profiles to verify they support JSON mode and can return properly formatted responses.
                </p>
              </div>
            ) : supportedProfiles.length === 0 && requiresVision ? (
              <div className="text-center py-4">
                <p className="text-sm font-semibold text-danger-700 dark:text-danger-400 mb-2">
                  No vision-capable profiles available
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                  Configure at least one profile with an image-to-text binding enabled in the pipeline before running on image questions.
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tip: edit a profile to assign a vision binding, then enable the “Image preprocessing” step.
                </p>
              </div>
            ) : (
              <>
                {supportedProfiles.map((profile) => {
                  const isSelected = selectedProfileIds.has(profile.id);
                  const textBinding = profile.bindings.find(
                    (binding) => binding.capability === 'text-to-text'
                  );
                  const visionStep = profile.pipeline.find(
                    (step) => step.capability === 'image-to-text'
                  );
                  const visionBinding =
                    (visionStep?.bindingId
                      ? profile.bindings.find((binding) => binding.id === visionStep.bindingId)
                      : null) ??
                    profile.bindings.find((binding) => binding.capability === 'image-to-text');
                  const visionActive = Boolean(visionStep?.enabled && visionBinding);
                  return (
                    <label
                      key={profile.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                          : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-accent-300 dark:hover:border-accent-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={handleToggleProfile(profile.id)}
                        className="w-4 h-4 mt-1 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-50">
                            {profile.name}
                          </span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400">
                            ✓ Supported
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                          {textBinding?.modelId ?? profile.modelId ?? 'Model not assigned'}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-semibold bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300">
                            Text: {textBinding?.modelId ?? 'Not set'}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-semibold ${
                              visionActive
                                ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                                : 'bg-slate-200 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                            }`}
                          >
                            Vision:{' '}
                            {visionActive
                              ? visionBinding?.modelId ?? 'Assigned'
                              : visionBinding
                              ? 'Disabled'
                              : 'Not configured'}
                          </span>
                        </div>
                        {profile.metadata.lastCompatibilityCheckAt ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Last checked: {formatDateTime(profile.metadata.lastCompatibilityCheckAt)}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
                {(incompatibleCount > 0 || visionFilteredCount > 0) && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 text-center py-2 border-t border-slate-300 dark:border-slate-600 space-y-1">
                    {incompatibleCount > 0 ? (
                      <p>
                        {incompatibleCount} {incompatibleCount === 1 ? 'profile' : 'profiles'} hidden
                        — failed compatibility checks
                      </p>
                    ) : null}
                    {visionFilteredCount > 0 && requiresVision ? (
                      <p>
                        {visionFilteredCount}{' '}
                        {visionFilteredCount === 1 ? 'profile' : 'profiles'} hidden — no vision
                        binding
                      </p>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Dataset
            </span>
            {datasets.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-3 px-4 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50 dark:bg-slate-900/30">
                No datasets available. Create a dataset first on the Datasets page.
              </p>
            ) : (
              <select
                value={selectedDatasetId}
                onChange={(event) => setSelectedDatasetId(event.target.value)}
                className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl pl-3 pr-10 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] dark:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5rem_1.5rem] bg-[right_0.5rem_center] bg-no-repeat"
              >
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name} ({dataset.metadata.totalQuestions} questions)
                  </option>
                ))}
              </select>
            )}
          </label>

          {selectedDataset && (
            <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-300 dark:border-slate-600 rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Dataset details
                </span>
                {selectedDataset.metadata.hasImages && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                    Has images
                  </span>
                )}
              </div>

              {selectedDataset.description && (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {selectedDataset.description}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {Object.entries(selectedDataset.metadata.questionTypeBreakdown).map(([type, count]) => (
                  <span
                    key={type}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                  >
                    {type}: {count}
                  </span>
                ))}
              </div>

              {selectedDataset.filters.types.length > 0 ||
              selectedDataset.filters.difficulty.length > 0 ||
              selectedDataset.filters.pyqYears.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Applied filters
                  </span>
                  <div className="flex flex-wrap gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    {selectedDataset.filters.types.length > 0 && (
                      <span>Types: {selectedDataset.filters.types.join(', ')}</span>
                    )}
                    {selectedDataset.filters.difficulty.length > 0 && (
                      <span>· Difficulty: {selectedDataset.filters.difficulty.join(', ')}</span>
                    )}
                    {selectedDataset.filters.pyqYears.length > 0 && (
                      <span>· PYQ Years: {selectedDataset.filters.pyqYears.join(', ')}</span>
                    )}
                  </div>
                </div>
              ) : null}

              {requiresVision && (
                <p className="text-xs text-warning-700 dark:text-warning-400">
                  This dataset includes image-based questions. Only profiles with vision support will be available.
                </p>
              )}
            </div>
          )}
        </div>

        <p className="bg-info-100 dark:bg-info-900/30 border border-info-300 dark:border-info-700 text-info-800 dark:text-info-400 px-4 py-3 rounded-xl text-sm">
          Diagnostics will run automatically before each benchmark. Runs will be skipped if diagnostics fail.
        </p>

        <div className="flex justify-end gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <button
            className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-6 py-3 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            type="submit"
            disabled={
              launching ||
              selectedProfileIds.size === 0 ||
              !selectedDatasetId ||
              datasets.length === 0
            }
          >
            {launching ? 'Starting…' : `Run benchmark${selectedProfileIds.size > 1 ? 's' : ''}`}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const Runs = () => {
  const {
    loading,
    runs,
    profiles,
    datasets,
    upsertRun,
    deleteRun,
    getProfileById,
    getRunById,
    activeRun,
    clearActiveRun,
    enqueueRun,
    enqueueBatch,
    runQueue,
    getQueuePosition,
  } = useBenchmarkContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [showNewRunPanel, setShowNewRunPanel] = useState(false);
  const [rerunData, setRerunData] = useState<{
    datasetId: string;
    label: string;
  } | null>(null);

  // Check for rerun state from navigation
  useEffect(() => {
    const state = location.state as { rerun?: { datasetId: string; label: string } } | null;
    if (state?.rerun) {
      setRerunData(state.rerun);
      setShowNewRunPanel(true);
      // Clear the state to prevent reopening on refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  const filteredRuns = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return runs
      .filter((run) => (statusFilter === 'all' ? true : run.status === statusFilter))
      .filter((run) =>
        providerFilter === 'all'
          ? true
          : getProfileById(run.profileId)?.provider === providerFilter
      )
      .filter((run) => {
        if (!term) {
          return true;
        }
        const haystack = `${run.label} ${run.profileName} ${run.profileModelId}`.toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [runs, statusFilter, providerFilter, searchTerm, getProfileById]);

  const providerOptions = useMemo(
    () => Array.from(new Set(profiles.map((profile) => profile.provider))),
    [profiles]
  );

  const handleDeleteRun = (runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      return;
    }

    deleteRun(runId);
  };

  // Helper: Check if run can be resumed (has partial attempts)
  const canResumeRun = (run: BenchmarkRun): boolean => {
    // Only failed/cancelled runs can be resumed
    if (run.status !== 'failed' && run.status !== 'cancelled') {
      return false;
    }

    // Must have some attempts but not all
    const attemptedQuestionIds = new Set(run.attempts.map((a) => a.questionId));
    const hasPartialAttempts = attemptedQuestionIds.size > 0 && attemptedQuestionIds.size < run.questionIds.length;

    return hasPartialAttempts;
  };

  const handleResumeBenchmark = (runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      return;
    }

    const profile = getProfileById(run.profileId);
    if (!profile) {
      alert('Profile not found. The model profile may have been deleted.');
      return;
    }

    // Find unanswered questions
    const attemptedQuestionIds = new Set(run.attempts.map((a) => a.questionId));
    const unansweredQuestionIds = run.questionIds.filter((id) => !attemptedQuestionIds.has(id));

    if (unansweredQuestionIds.length === 0) {
      alert('All questions have been answered. Use Rerun to start fresh.');
      return;
    }

    // Update run to queued status and queue it
    const resumedRun = upsertRun({
      ...run,
      status: 'queued',
      summary: `Resuming from ${attemptedQuestionIds.size}/${run.questionIds.length} questions answered`,
      notes: run.notes
        ? `${run.notes}\n\nResumed at ${new Date().toISOString()}`
        : `Resumed at ${new Date().toISOString()}`,
    });

    enqueueRun(resumedRun.id);
    setShowNewRunPanel(false);
  };

  const handleStartDraftRun = (runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      return;
    }

    const profile = getProfileById(run.profileId);
    if (!profile) {
      alert('Profile not found. The model profile may have been deleted.');
      return;
    }

    // Update draft run to queued status and queue it
    const queuedRun = upsertRun({
      ...run,
      status: 'queued',
      summary: `Starting benchmark with ${run.questionIds.length} questions`,
    });

    enqueueRun(queuedRun.id);
    setShowNewRunPanel(false);
  };

  const handleRerunBenchmark = (runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      return;
    }

    // Set rerun data and open the panel for profile selection
    setRerunData({
      datasetId: run.datasetId,
      label: `Rerun of ${run.label}`,
    });
    setShowNewRunPanel(true);
  };

  const handleLaunchRun = (payload: LaunchRunPayload): Promise<void> => {
    const { profileIds, datasetId } = payload;

    if (profileIds.length === 0) {
      throw new Error('No profiles selected');
    }

    // Get the selected dataset
    const dataset = datasets.find((d) => d.id === datasetId);
    if (!dataset) {
      throw new Error('Dataset not found');
    }

    // Get questions from the dataset
    const selectedQuestions = dataset.questionIds
      .map((id) => questionLookup.get(id))
      .filter((question): question is BenchmarkQuestion => Boolean(question));

    if (selectedQuestions.length === 0) {
      throw new Error('No questions in dataset');
    }

    const now = new Date().toISOString();
    const createdRuns: BenchmarkRun[] = [];

    // Create a run for each selected profile
    profileIds.forEach((profileId, index) => {
      const profile = getProfileById(profileId);
      if (!profile) {
        console.error(`Profile ${profileId} not found, skipping`);
        return;
      }

      // Add profile name suffix if multiple profiles selected
      const runLabel = profileIds.length > 1
        ? `${payload.label} - ${profile.name} (${index + 1}/${profileIds.length})`
        : payload.label;

      // Build filters string for display
      const filtersDisplay: string[] = [];
      if (dataset.filters.types.length > 0) {
        filtersDisplay.push(`Types: ${dataset.filters.types.join(', ')}`);
      }
      if (dataset.filters.difficulty.length > 0) {
        filtersDisplay.push(`Difficulty: ${dataset.filters.difficulty.join(', ')}`);
      }
      if (dataset.filters.pyqYears.length > 0) {
        filtersDisplay.push(`PYQ Years: ${dataset.filters.pyqYears.join(', ')}`);
      }

      const run = upsertRun({
        label: runLabel,
        profileId: profile.id,
        profileName: profile.name,
        profileModelId: profile.modelId,
        status: 'draft',  // Start as draft, will be updated by enqueueRun
        createdAt: now,
        datasetId: dataset.id,
        questionIds: dataset.questionIds,
        dataset: {
          id: dataset.id,
          name: dataset.name,
          label: dataset.name,
          totalQuestions: selectedQuestions.length,
          filters: filtersDisplay,
        },
        metrics: createEmptyRunMetrics(),
        attempts: [],
      });

      createdRuns.push(run);
    });

    if (createdRuns.length === 0) {
      throw new Error('Failed to create any runs');
    }

    // Enqueue all created runs
    createdRuns.forEach((run) => {
      enqueueRun(run.id);
    });

    // Navigate to the first run's detail page
    const firstRun = createdRuns[0];
    void navigate(`/runs/${firstRun.id}?live=1`);

    // The queue watcher will automatically execute the run
    return Promise.resolve();
  };

  const showInlineActiveRun = Boolean(
    activeRun && (activeRun.status === 'starting' || activeRun.status === 'running')
  );
  const inlineTotalQuestions = activeRun?.totalQuestions ?? 0;
  const inlineAnsweredCount = activeRun
    ? activeRun.metrics.passedCount + activeRun.metrics.failedCount
    : 0;
  const inlineProgressPercent =
    activeRun && inlineTotalQuestions > 0
      ? Math.round((inlineAnsweredCount / inlineTotalQuestions) * 100)
      : 0;
  const inlineStatusLabel = activeRun ? activeRunStatusLabels[activeRun.status] : '';
  const inlineStatusClass = activeRun ? activeRunStatusClasses[activeRun.status] : '';
  const inlineUpdated = activeRun ? formatDateTime(activeRun.updatedAt) : undefined;
  const inlineElapsed = activeRun ? formatDuration(activeRun.startedAt, activeRun.completedAt) : '—';

  const handleOpenNewRunPanel = () => {
    setRerunData(null);
    setShowNewRunPanel(true);
  };
  const handleCloseNewRunPanel = () => {
    setShowNewRunPanel(false);
    setRerunData(null);
  };

  const handleResumeAll = () => {
    console.log('[RESUME ALL] Starting...');
    console.log('[RESUME ALL] Current queue state:', {
      currentRunId: runQueue.currentRunId,
      queuedCount: runQueue.queuedRunIds.length,
      queuedIds: runQueue.queuedRunIds,
    });

    // Find all runs that can be started or resumed
    const resumableRuns = runs.filter((run) => {
      // Include draft runs (can be started)
      if (run.status === 'draft') {
        return true;
      }

      // Include failed/cancelled runs with partial attempts (can be resumed)
      if (run.status === 'failed' || run.status === 'cancelled') {
        const attemptedQuestionIds = new Set(run.attempts.map((a) => a.questionId));
        const hasPartialAttempts = attemptedQuestionIds.size > 0 && attemptedQuestionIds.size < run.questionIds.length;
        return hasPartialAttempts;
      }

      return false;
    });

    console.log('[RESUME ALL] Found resumable runs:', resumableRuns.length);

    if (resumableRuns.length === 0) {
      alert('No runs available to resume or start.');
      return;
    }

    // Prepare all updated runs first
    const updatedRunIds: string[] = [];

    resumableRuns.forEach((run) => {
      // Check if profile still exists
      const profile = getProfileById(run.profileId);
      if (!profile) {
        console.warn(`[RESUME ALL] Skipping run ${run.id} - profile not found`);
        return;
      }

      // Update run status to queued
      const updatedRun = upsertRun({
        ...run,
        status: 'queued',
        summary: run.status === 'draft'
          ? `Starting benchmark with ${run.questionIds.length} questions`
          : `Resuming from ${run.attempts.length}/${run.questionIds.length} questions answered`,
        notes: run.status === 'draft'
          ? run.notes
          : run.notes
            ? `${run.notes}\n\nResumed at ${new Date().toISOString()}`
            : `Resumed at ${new Date().toISOString()}`,
      });

      console.log(`[RESUME ALL] Updated run ${updatedRun.id} to queued status`);
      updatedRunIds.push(updatedRun.id);
    });

    console.log('[RESUME ALL] Enqueueing all runs in a single batch...');

    // Enqueue all runs at once using batch operation
    // This ensures proper queue positioning in a single state update
    enqueueBatch(updatedRunIds);

    alert(`${updatedRunIds.length} run(s) queued for execution.`);
  };

  const handleNavigateToActive = () => {
    if (!activeRun) {
      return;
    }
    void navigate(`/runs/${activeRun.runId}?live=1`);
  };

  // Note: Run auto-execution is now handled in BenchmarkContext.tsx (app-wide)
  // This ensures queued runs start automatically even when navigating away from this page

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Runs
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-[0.95rem] mt-1">
              Review historical runs, filter by status, and drill into attempt analytics.
            </p>
          </div>
        </header>

        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-accent-200 dark:border-accent-800 border-t-accent-600 dark:border-t-accent-400 rounded-full animate-spin"></div>
            <p className="text-slate-600 dark:text-slate-400 font-medium">Loading runs...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Runs
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem] mt-1">
            Review historical runs, filter by status, and drill into attempt analytics.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-900 dark:text-slate-50 font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            type="button"
            onClick={handleResumeAll}
          >
            Resume All
          </button>
          <button
            className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            type="button"
            onClick={handleOpenNewRunPanel}
          >
            New run
          </button>
        </div>
      </header>

      {showInlineActiveRun && activeRun ? (
        <section className="bg-accent-50 dark:bg-accent-900/10 border border-accent-200 dark:border-accent-700 rounded-2xl p-5 flex flex-col gap-3 transition-theme">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-300">
                Active benchmark
              </p>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {activeRun.label}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {activeRun.profileName} · {activeRun.profileModelId}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dataset {activeRun.datasetLabel} · Elapsed {inlineElapsed}
              </p>
              {inlineUpdated ? (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Updated {inlineUpdated}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span
                className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${inlineStatusClass}`}
              >
                {inlineStatusLabel}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleNavigateToActive}
                  className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
                >
                  View progress
                </button>
                {activeRun.status === 'completed' || activeRun.status === 'failed' ? (
                  <button
                    type="button"
                    onClick={clearActiveRun}
                    className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs font-semibold text-accent-700 dark:text-accent-300 mb-2">
              <span>
                {inlineAnsweredCount} of {inlineTotalQuestions} answered
              </span>
              <span>{inlineProgressPercent}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-accent-200/60 dark:bg-accent-900/40 overflow-hidden">
              <div
                className="h-full bg-accent-500 transition-all duration-300"
                style={{ width: `${inlineProgressPercent}%` }}
              />
            </div>
          </div>
        </section>
      ) : null}

      {runQueue.queuedRunIds.length > 0 ? (
        <section className="bg-warning-50 dark:bg-warning-900/10 border border-warning-200 dark:border-warning-700 rounded-2xl p-5 flex flex-col gap-3 transition-theme">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-300">
                Run Queue
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {runQueue.queuedRunIds.length} {runQueue.queuedRunIds.length === 1 ? 'run' : 'runs'} waiting{' '}
                {runQueue.currentRunId ? 'for current run to complete' : 'to start'}
              </p>
              <ul className="flex flex-col gap-1.5 mt-2">
                {runQueue.queuedRunIds.slice(0, 3).map((runId, index) => {
                  const run = getRunById(runId);
                  if (!run) {
                    return null;
                  }
                  return (
                    <li key={runId} className="flex items-center gap-2 text-sm">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-warning-200 dark:bg-warning-800 text-warning-800 dark:text-warning-200 font-semibold text-xs">
                        {index + 1}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-slate-50">
                        {run.label}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        · {run.profileName}
                      </span>
                    </li>
                  );
                })}
                {runQueue.queuedRunIds.length > 3 ? (
                  <li className="text-xs text-slate-500 dark:text-slate-400 ml-8">
                    ... and {runQueue.queuedRunIds.length - 3} more
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            All runs
          </h2>
        </header>

        <div className="flex flex-col md:flex-row gap-4">
          <label className="flex flex-col w-full md:w-auto md:max-w-48">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | RunStatus)}
              className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl pl-3 pr-10 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] dark:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5rem_1.5rem] bg-[right_0.5rem_center] bg-no-repeat"
            >
              <option value="all">All</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col w-full md:w-auto md:max-w-48">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Provider
            </span>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl pl-3 pr-10 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] dark:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5rem_1.5rem] bg-[right_0.5rem_center] bg-no-repeat"
            >
              <option value="all">All</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col flex-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Search
            </span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search run label or model"
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>
        </div>

        {filteredRuns.length === 0 ? (
          <p className="p-4 sm:p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center text-sm sm:text-base">
            No runs match the selected filters.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10">
            <table className="w-full min-w-[900px] border-collapse text-sm sm:text-[0.95rem]">
              <thead className="text-left text-slate-600 dark:text-slate-400 font-semibold text-xs sm:text-sm">
                <tr>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Run / Profile
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Accuracy
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Time
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Questions
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Created
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => {
                      void navigate(`/runs/${run.id}`);
                    }}
                    className="cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <th
                      scope="row"
                      className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-900 dark:text-slate-50">
                          {run.label}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {run.profileName}
                        </span>
                      </div>
                    </th>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                            statusClass[run.status] === 'ready'
                              ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                              : statusClass[run.status] === 'failed'
                              ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400'
                              : statusClass[run.status] === 'running'
                              ? 'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-400'
                              : statusClass[run.status] === 'queued'
                              ? 'bg-info-100 text-info-800 dark:bg-info-900/30 dark:text-info-400'
                              : statusClass[run.status] === 'draft'
                              ? 'bg-slate-100 text-slate-800 dark:bg-slate-700/30 dark:text-slate-400'
                              : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400'
                          }`}
                        >
                          {statusLabels[run.status]}
                        </span>
                        {run.status === 'queued' && (() => {
                          const position = getQueuePosition(run.id);
                          const isCurrentRun = runQueue.currentRunId === run.id;

                          if (isCurrentRun) {
                            return (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-accent-200 dark:bg-accent-800 text-accent-800 dark:text-accent-200">
                                Currently Running
                              </span>
                            );
                          }

                          return position > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-info-200 dark:bg-info-800 text-info-800 dark:text-info-200">
                              #{position} in queue
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.metrics && run.status === 'completed' ? (
                        <div className="flex flex-col gap-0.5">
                          <span>A: {(run.metrics.accuracy * 100).toFixed(1)}%</span>
                          <span className="text-xs">T: {(run.metrics.topologyAccuracy * 100).toFixed(1)}%</span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.metrics && run.status === 'completed' ? (
                        <div className="flex flex-col gap-0.5">
                          <span>{formatLatency(run.metrics.averageLatencyMs)}/q</span>
                          <span className="text-xs">{formatDuration(run.startedAt, run.completedAt)} total</span>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.questionIds.length}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {formatDateTime(run.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex gap-1.5">
                        {/* View icon */}
                        <Link
                          className="p-2 rounded-lg border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 transition-all duration-200"
                          to={`/runs/${run.id}`}
                          onClick={(e) => e.stopPropagation()}
                          title="View details"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                          </svg>
                        </Link>

                        {/* Draft runs: Show Start icon */}
                        {run.status === 'draft' && (
                          <button
                            className="p-2 rounded-lg bg-success-600 hover:bg-success-700 text-white transition-all duration-200"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartDraftRun(run.id);
                            }}
                            title="Start this benchmark run"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}

                        {/* Completed/Failed/Cancelled runs: Show Resume (if resumable) and Rerun icons */}
                        {(run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') && (
                          <>
                            {canResumeRun(run) && (
                              <button
                                className="p-2 rounded-lg border border-warning-400 dark:border-warning-500 bg-warning-500/8 dark:bg-warning-500/10 text-warning-700 dark:text-warning-400 hover:bg-warning-500/16 dark:hover:bg-warning-500/20 transition-all duration-200"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResumeBenchmark(run.id);
                                }}
                                title="Resume from where it left off"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                                </svg>
                              </button>
                            )}
                            <button
                              className="p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRerunBenchmark(run.id);
                              }}
                              title="Rerun with same settings"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                              </svg>
                            </button>
                          </>
                        )}

                        {/* Delete icon - show for all non-running statuses */}
                        {run.status !== 'running' && (
                          <button
                            className="p-2 rounded-lg bg-danger-600 hover:bg-danger-700 text-white transition-all duration-200"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRun(run.id);
                            }}
                            title="Delete run"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NewRunPanel
        isOpen={showNewRunPanel}
        onClose={handleCloseNewRunPanel}
        onLaunch={handleLaunchRun}
        initialDatasetId={rerunData?.datasetId}
        initialLabel={rerunData?.label}
      />
    </div>
  );
};

export default Runs;
