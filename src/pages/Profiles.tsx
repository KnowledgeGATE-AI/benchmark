import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import {
  ModelProfile,
  BenchmarkStepConfig,
  DiscoveredModel,
  ModelBinding,
  ProfilePipelineStep,
} from '@/types/benchmark';
import {
  DEFAULT_PROFILE_VALUES,
  DEFAULT_PROFILE_PIPELINE,
  defaultBenchmarkSteps,
  createDefaultTextBinding,
  createDefaultVisionBinding,
} from '@/data/defaults';
import { runCompatibilityCheck } from '@/services/compatibilityCheck';
import { fetchModels } from '@/services/lmStudioClient';
import Modal from '@/components/Modal';
import createId from '@/utils/createId';

interface ProfileFormState {
  id?: string;
  name: string;
  description: string;
  notes: string;
  bindings: ModelBinding[];
  pipeline: ProfilePipelineStep[];
  benchmarkSteps: BenchmarkStepConfig[];
}

const cloneBinding = (binding: ModelBinding): ModelBinding => ({
  ...binding,
  metadata: binding.metadata ? { ...binding.metadata } : undefined,
});

const clonePipelineStep = (step: ProfilePipelineStep): ProfilePipelineStep => ({
  ...step,
});


const toFormState = (profile?: ModelProfile): ProfileFormState =>
  profile
    ? {
        id: profile.id,
        name: profile.name,
        description: profile.description ?? '',
        notes: profile.notes ?? '',
        bindings: profile.bindings.map(cloneBinding),
        pipeline: profile.pipeline.map(clonePipelineStep),
        benchmarkSteps:
          profile.benchmarkSteps?.map((step) => ({ ...step })) ??
          defaultBenchmarkSteps.map((step) => ({ ...step })),
      }
    : {
        name: DEFAULT_PROFILE_VALUES.name,
        description: DEFAULT_PROFILE_VALUES.description ?? '',
        notes: DEFAULT_PROFILE_VALUES.notes,
        bindings: DEFAULT_PROFILE_VALUES.bindings.map(cloneBinding),
        pipeline: DEFAULT_PROFILE_PIPELINE.map(clonePipelineStep),
        benchmarkSteps: DEFAULT_PROFILE_VALUES.benchmarkSteps.map((step) => ({ ...step })),
      };

const formatTimestamp = (iso?: string) => {
  if (!iso) {
    return 'Never';
  }
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const Profiles = () => {
  const {
    loading,
    profiles,
    runs,
    upsertProfile,
    deleteProfile,
    deleteRun,
    recordCompatibilityCheck,
    discovery,
    refreshDiscoveredModels,
  } = useBenchmarkContext();
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  const [formState, setFormState] = useState<ProfileFormState>(() => toFormState());
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [isProfileDialogOpen, setProfileDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isProfileDetailOpen, setProfileDetailOpen] = useState(false);
  const [runningCompatibilityCheck, setRunningCompatibilityCheck] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [availableModels, setAvailableModels] = useState<Record<string, { id: string; object: string }[]>>({});

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );

  useEffect(() => {
    if (!selectedProfileId) {
      return;
    }
    const stillExists = profiles.some((profile) => profile.id === selectedProfileId);
    if (!stillExists) {
      setSelectedProfileId(undefined);
      setProfileDetailOpen(false);
    }
  }, [profiles, selectedProfileId]);

  const handleSelectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    setProfileDetailOpen(true);
  };

  const handleCloseProfileDetails = () => {
    setProfileDetailOpen(false);
    setSelectedProfileId(undefined);
  };

  const handleCreateProfile = () => {
    setDialogMode('create');
    setFormState(toFormState());
    setFormError(null);
    setFeedback(null);
    setProfileDialogOpen(true);
  };

  const handleEditProfile = (profile: ModelProfile) => {
    setDialogMode('edit');
    setFormState(toFormState(profile));
    setFormError(null);
    setFeedback(null);
    setProfileDialogOpen(true);
    setSelectedProfileId(profile.id);
    setProfileDetailOpen(false);
  };

  const handleDeleteProfile = (profile: ModelProfile) => {
    // Find all runs associated with this profile
    const associatedRuns = runs.filter((run) => run.profileId === profile.id);

    // Prepare confirmation message
    let confirmMessage = `Delete profile "${profile.name}"?`;
    if (associatedRuns.length > 0) {
      confirmMessage += `\n\nThis will also delete ${associatedRuns.length} associated benchmark run${associatedRuns.length === 1 ? '' : 's'}.`;
    }
    confirmMessage += '\n\nThis action cannot be undone.';

    // Show confirmation dialog
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }

    // Delete all associated runs first
    associatedRuns.forEach((run) => {
      deleteRun(run.id);
    });

    // Then delete the profile
    deleteProfile(profile.id);

    // Close detail panel if this profile was selected
    if (selectedProfileId === profile.id) {
      setProfileDetailOpen(false);
      setSelectedProfileId(undefined);
    }

    // Show feedback
    setFeedback(
      `Profile "${profile.name}" deleted${associatedRuns.length > 0 ? ` along with ${associatedRuns.length} run${associatedRuns.length === 1 ? '' : 's'}` : ''}.`
    );
  };

  const handleCloseDialog = () => {
    setProfileDialogOpen(false);
    setFormError(null);
  };

  const handleRefreshDiscovery = useCallback(() => {
    refreshDiscoveredModels().catch((error) => {
      console.warn('Failed to refresh LM Studio models', error);
    });
  }, [refreshDiscoveredModels]);

  const handleAdoptDiscoveredModel = useCallback(
    (model: DiscoveredModel, capability: 'text-to-text' | 'image-to-text') => {
      const baseUrl = model.origin?.baseUrl ?? DEFAULT_PROFILE_VALUES.baseUrl;
      const existingProfileForBaseUrl = profiles.find((profile) =>
        profile.bindings.some(
          (binding) => binding.capability === 'text-to-text' && binding.baseUrl === baseUrl
        )
      );
      const referenceBinding = existingProfileForBaseUrl?.bindings.find(
        (binding) => binding.capability === 'text-to-text'
      );
      const capabilityNote =
        model.capabilities.length > 0
          ? `Capabilities: ${model.capabilities.join(', ')}.`
          : undefined;
      const quantizationNote =
        model.quantization ? `Quantization: ${model.quantization}.` : undefined;
      const sourceNote = `Discovered via LM Studio (${baseUrl}).`;

      const intelligentMaxOutputTokens = model.maxContextLength
        ? Math.min(Math.floor(model.maxContextLength * 0.5), 8192)
        : DEFAULT_PROFILE_VALUES.maxOutputTokens;

      const existingProfileCount = profiles.filter((p) => p.modelId === model.id).length;
      const profileName =
        existingProfileCount > 0
          ? `${model.displayName ?? model.id} (${existingProfileCount + 1})`
          : model.displayName ?? model.id;

      const template = createDefaultTextBinding();
      const textBinding: ModelBinding = {
        ...template,
        name: profileName,
        baseUrl,
        apiKey: referenceBinding?.apiKey ?? template.apiKey,
        modelId: capability === 'text-to-text' ? model.id : template.modelId,
        temperature: referenceBinding?.temperature ?? template.temperature,
        maxOutputTokens: intelligentMaxOutputTokens,
        requestTimeoutMs: referenceBinding?.requestTimeoutMs ?? template.requestTimeoutMs,
        topP: referenceBinding?.topP ?? template.topP,
        frequencyPenalty: referenceBinding?.frequencyPenalty ?? template.frequencyPenalty,
        presencePenalty: referenceBinding?.presencePenalty ?? template.presencePenalty,
        defaultSystemPrompt:
          referenceBinding?.defaultSystemPrompt ?? template.defaultSystemPrompt,
        notes: referenceBinding?.notes,
        metadata: {
          ...(template.metadata ?? {}),
          supportsJsonMode:
            referenceBinding?.metadata?.supportsJsonMode ??
            template.metadata?.supportsJsonMode ??
            true,
        },
      };

      const basePipeline = DEFAULT_PROFILE_PIPELINE.map((step) =>
        step.capability === 'text-to-text'
          ? {
              ...step,
              bindingId: textBinding.id,
            }
          : { ...step }
      );

      const baseNotes = [sourceNote, quantizationNote, capabilityNote]
        .filter(Boolean)
        .join(' ');

      if (capability === 'text-to-text') {
        const newProfileData: Partial<ModelProfile> = {
          name: profileName,
          description: model.kind ?? '',
          bindings: [textBinding],
          pipeline: basePipeline,
          notes: baseNotes,
        };

        try {
          const saved = upsertProfile(newProfileData);
          setSelectedProfileId(saved.id);
          setFeedback(`Profile "${saved.name}" created successfully from ${model.id}.`);
        } catch (error) {
          setFeedback(`Failed to create profile: ${(error as Error).message}`);
        }
        return;
      }

      const identity = `${model.displayName ?? ''} ${model.id}`.toLowerCase();
      let recommendedVisionPrompt =
        'You are an OCR assistant. Extract all visible text from the supplied image and keep formatting minimal.';
      if (/got|ocr/.test(identity)) {
        recommendedVisionPrompt =
          'You are GOT-OCR 2.0. Transcribe every legible character from the image. Return plain text preserving line breaks.';
      } else if (identity.includes('qwen')) {
        recommendedVisionPrompt =
          'You are Qwen2.5-VL. Read the image and output only the detected text with newline separators. Do not describe visuals.';
      } else if (identity.includes('gemma')) {
        recommendedVisionPrompt =
          'You are Gemma3 Vision. Provide a faithful transcription of any printed or handwritten text in the image.';
      }

      const visionBinding: ModelBinding = {
        id: createId(),
        name: `${profileName} (Vision)`,
        capability: 'image-to-text',
        transport: 'lmstudio',
        baseUrl,
        apiKey: referenceBinding?.apiKey ?? template.apiKey,
        modelId: model.id,
        temperature: 0,
        maxOutputTokens: 1024,
        requestTimeoutMs: referenceBinding?.requestTimeoutMs ?? template.requestTimeoutMs,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        defaultSystemPrompt: recommendedVisionPrompt,
        metadata: {
          supportsJsonMode: false,
        },
      };

      const pipeline = basePipeline.map((step) =>
        step.capability === 'image-to-text'
          ? {
              ...step,
              bindingId: visionBinding.id,
              enabled: true,
            }
          : step
      );

      const visionNotes = [
        baseNotes,
        'Vision preprocessing enabled by default.',
        `Seeded OCR prompt for ${model.displayName ?? model.id}.`,
      ]
        .filter(Boolean)
        .join(' ');

      const newProfileData: Partial<ModelProfile> = {
        name: `${profileName} (Vision chain)`,
        description: model.kind ?? 'Vision pipeline',
        bindings: [textBinding, visionBinding],
        pipeline,
        notes: visionNotes,
      };

      try {
        const saved = upsertProfile(newProfileData);
        setSelectedProfileId(saved.id);
        setFeedback(`Profile "${saved.name}" created successfully from ${model.id}.`);
      } catch (error) {
        setFeedback(`Failed to create profile: ${(error as Error).message}`);
      }
    },
    [profiles, upsertProfile]
  );

  const handleFieldChange =
    (field: 'name' | 'description' | 'notes') =>
    (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      setFormState((prev) => ({
        ...prev,
        [field]: value,
      }));
    };

  const handleBindingFieldChange =
    (bindingId: string, field: keyof ModelBinding) =>
    (
      event: FormEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => {
      const numericFields: (keyof ModelBinding)[] = [
        'temperature',
        'maxOutputTokens',
        'requestTimeoutMs',
        'topP',
        'frequencyPenalty',
        'presencePenalty',
      ];
      const rawValue = event.currentTarget.value;
      const nextValue = numericFields.includes(field) ? Number(rawValue) : rawValue;

      setFormState((prev) => ({
        ...prev,
        bindings: prev.bindings.map((binding) => {
          if (binding.id !== bindingId) {
            return binding;
          }

          let updatedBinding: ModelBinding = {
            ...binding,
            [field]: nextValue as ModelBinding[typeof field],
          };

          if (field === 'transport' && typeof nextValue === 'string') {
            const nextTransport = nextValue as ModelBinding['transport'];

            if (nextTransport === 'openrouter') {
              const needsBaseUrlUpdate =
                !binding.baseUrl ||
                binding.baseUrl === '' ||
                binding.baseUrl.startsWith('http://localhost');

              if (needsBaseUrlUpdate) {
                updatedBinding = {
                  ...updatedBinding,
                  baseUrl: OPENROUTER_BASE_URL,
                };
              }

              updatedBinding = {
                ...updatedBinding,
                metadata: {
                  ...(updatedBinding.metadata ?? {}),
                  supportsJsonMode: true,
                },
              };
            } else if (nextTransport === 'lmstudio') {
              const needsLmStudioDefault =
                !binding.baseUrl ||
                binding.baseUrl === '' ||
                binding.baseUrl === OPENROUTER_BASE_URL;

              if (needsLmStudioDefault) {
                updatedBinding = {
                  ...updatedBinding,
                  baseUrl: 'http://localhost:1234',
                };
              }
            }
          }

          return updatedBinding;
        }),
      }));
    };

  const handleBindingMetadataChange =
    (bindingId: string, key: 'supportsJsonMode') =>
    (event: FormEvent<HTMLInputElement>) => {
      const checked = event.currentTarget.checked;
      setFormState((prev) => ({
        ...prev,
        bindings: prev.bindings.map((binding) =>
          binding.id === bindingId
            ? {
                ...binding,
                metadata: {
                  ...(binding.metadata ?? {}),
                  [key]: checked,
                },
              }
            : binding
        ),
      }));
    };

  const handleLoadModels = async (bindingId: string) => {
    const binding = formState.bindings.find((b) => b.id === bindingId);
    if (!binding?.baseUrl) {
      alert('Please enter a Base URL first');
      return;
    }

    setLoadingModels((prev) => ({ ...prev, [bindingId]: true }));
    try {
      const models = await fetchModels({
        baseUrl: binding.baseUrl,
        apiKey: binding.apiKey,
        requestTimeoutMs: binding.requestTimeoutMs,
        transport: binding.transport,
      });
      setAvailableModels((prev) => ({ ...prev, [bindingId]: models }));
    } catch (error) {
      console.error('Failed to load models:', error);
      alert(`Failed to load models: ${(error as Error).message}`);
    } finally {
      setLoadingModels((prev) => ({ ...prev, [bindingId]: false }));
    }
  };

  const handleSelectModel = (bindingId: string, modelId: string) => {
    setFormState((prev) => ({
      ...prev,
      bindings: prev.bindings.map((binding) =>
        binding.id === bindingId
          ? {
              ...binding,
              modelId,
            }
          : binding
      ),
    }));
  };

  const handleVisionEnabledChange = () => {
    // Vision is always enabled - this function only adds the binding if missing
    setFormState((prev) => {
      const current = prev.bindings.find((binding) => binding.capability === 'image-to-text');

      // If binding already exists, do nothing
      if (current) {
        return prev;
      }

      // Create new vision binding
      const binding = createDefaultVisionBinding();
      const bindings = [...prev.bindings, binding];

      return {
        ...prev,
        bindings,
        pipeline: prev.pipeline.map((step) =>
          step.capability === 'image-to-text'
            ? {
                ...step,
                enabled: true,
                bindingId: binding.id,
              }
            : step
        ),
      };
    });
  };

  const handleRestoreTextBinding = () => {
    setFormState((prev) => {
      const existing = prev.bindings.find((binding) => binding.capability === 'text-to-text');
      if (existing) {
        return prev;
      }

      const template = createDefaultTextBinding();
      return {
        ...prev,
        bindings: [template, ...prev.bindings],
        pipeline: prev.pipeline.map((step) =>
          step.capability === 'text-to-text'
            ? {
                ...step,
                bindingId: template.id,
                enabled: true,
              }
            : step
        ),
      };
    });
  };

  const handlePipelineBindingChange =
    (stepId: string) =>
    (event: FormEvent<HTMLSelectElement>) => {
      const bindingId = event.currentTarget.value || null;
      setFormState((prev) => ({
        ...prev,
        pipeline: prev.pipeline.map((step) =>
          step.id === stepId
            ? {
                ...step,
                bindingId,
              }
            : step
        ),
      }));
    };

  const textBinding = useMemo(
    () => formState.bindings.find((binding) => binding.capability === 'text-to-text'),
    [formState.bindings]
  );
  const visionBinding = useMemo(
    () => formState.bindings.find((binding) => binding.capability === 'image-to-text'),
    [formState.bindings]
  );
  const imagePipelineStep = useMemo(
    () => formState.pipeline.find((step) => step.capability === 'image-to-text'),
    [formState.pipeline]
  );
  const textPipelineStep = useMemo(
    () => formState.pipeline.find((step) => step.capability === 'text-to-text'),
    [formState.pipeline]
  );
  const availableVisionBindings = useMemo(
    () => formState.bindings.filter((binding) => binding.capability === 'image-to-text'),
    [formState.bindings]
  );
  const availableTextBindings = useMemo(
    () => formState.bindings.filter((binding) => binding.capability === 'text-to-text'),
    [formState.bindings]
  );

  const handleStepChange =
    (index: number, key: keyof BenchmarkStepConfig) =>
    (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value =
        key === 'enabled'
          ? (event.currentTarget as HTMLInputElement).checked
          : event.currentTarget.value;

      setFormState((prev) => {
        const steps = prev.benchmarkSteps.map((step, stepIndex) =>
          stepIndex === index
            ? {
                ...step,
                [key]: key === 'enabled' ? Boolean(value) : value,
              }
            : step
        );

        return {
          ...prev,
          benchmarkSteps: steps,
        };
      });
    };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    const hasTextBinding = formState.bindings.some(
      (binding) => binding.capability === 'text-to-text'
    );

    if (!hasTextBinding) {
      setFormError('Profiles must include a text binding for the reasoning step.');
      setSaving(false);
      return;
    }

    try {
      const payload: Partial<ModelProfile> = {
        id: formState.id,
        name: formState.name.trim() || DEFAULT_PROFILE_VALUES.name,
        description: formState.description.trim(),
        notes: formState.notes,
        bindings: formState.bindings.map(cloneBinding),
        pipeline: formState.pipeline.map(clonePipelineStep),
        benchmarkSteps: formState.benchmarkSteps.map((step) => ({ ...step })),
      };

      const saved = upsertProfile(payload);
      setSelectedProfileId(saved.id);
      setFeedback(
        dialogMode === 'edit' ? 'Profile updated successfully.' : 'Profile created successfully.'
      );
      setProfileDialogOpen(false);
      setDialogMode('edit');
    } catch (error) {
      setFormError(`Failed to save profile: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfileFromDialog = () => {
    const targetId = formState.id ?? selectedProfile?.id;
    if (!targetId) {
      return;
    }

    const profile = profiles.find((p) => p.id === targetId);
    if (profile) {
      handleDeleteProfile(profile);
    }

    setProfileDialogOpen(false);
    setFormError(null);
    setFormState(toFormState());
    setDialogMode('create');
    setProfileDetailOpen(false);
    setSelectedProfileId((current) => (current === targetId ? undefined : current));
  };

  const handleRunCompatibilityCheck = async (profile: ModelProfile) => {
    setRunningCompatibilityCheck(profile.id);
    setFeedback(null);

    // Set status to in_progress immediately
    const updatedProfile = upsertProfile({
      id: profile.id,
      metadata: {
        ...profile.metadata,
        compatibilityStatus: 'in_progress',
        compatibilitySummary: 'Running compatibility check...',
      },
    });

    try {
      const result = await runCompatibilityCheck(updatedProfile);
      recordCompatibilityCheck(updatedProfile.id, result);
      setFeedback(
        result.compatible
          ? `${profile.name}: Compatible`
          : `${profile.name}: Not compatible - ${result.summary}`
      );
    } catch (error) {
      // On error, set status to incompatible
      upsertProfile({
        id: profile.id,
        metadata: {
          ...profile.metadata,
          compatibilityStatus: 'incompatible',
          compatibilitySummary: `Check failed: ${(error as Error).message}`,
        },
      });
      setFeedback(`${profile.name}: Compatibility check failed: ${(error as Error).message}`);
    } finally {
      setRunningCompatibilityCheck(null);
    }
  };

  const dialogTitle = dialogMode === 'edit' ? 'Edit profile' : 'Create profile';

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-4 mb-6">
          <div className="flex justify-between items-center gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
                Profiles
              </h1>
              <p className="text-slate-600 dark:text-slate-400 text-[0.95rem] mt-1">
                Configure LM Studio endpoints, credentials, and benchmark prompts.
              </p>
            </div>
          </div>
        </header>

        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-accent-200 dark:border-accent-800 border-t-accent-600 dark:border-t-accent-400 rounded-full animate-spin"></div>
            <p className="text-slate-600 dark:text-slate-400 font-medium">Loading profiles...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Profiles
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-[0.95rem] mt-1">
              Configure LM Studio endpoints, credentials, and benchmark prompts.
            </p>
          </div>
          <button
            className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            type="button"
            onClick={handleCreateProfile}
          >
            New profile
          </button>
        </div>
        {feedback && !isProfileDialogOpen && !isProfileDetailOpen ? (
          <div className="rounded-xl border border-success-200 dark:border-success-800/60 bg-success-50/60 dark:bg-success-900/20 px-4 py-3 text-sm font-semibold text-success-700 dark:text-success-400 transition-theme">
            {feedback}
          </div>
        ) : null}
      </header>

      <div className="flex flex-col gap-6">
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-4 transition-theme">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Saved profiles
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Persisted locally so you can reuse configurations.
            </p>
          </div>
          {profiles.length === 0 ? (
                <p className="p-4 sm:p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center text-sm sm:text-base">
                  No profiles yet. Create one to get started.
                </p>
              ) : (
                <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                  {profiles.map((profile) => {
                    const isActive = isProfileDetailOpen && profile.id === selectedProfileId;
                    const textBinding = profile.bindings.find(
                      (binding) => binding.capability === 'text-to-text'
                    );
                    const visionPipelineStep = profile.pipeline.find(
                      (step) => step.capability === 'image-to-text'
                    );
                    const visionBinding =
                      (visionPipelineStep?.bindingId
                        ? profile.bindings.find((binding) => binding.id === visionPipelineStep.bindingId)
                        : null) ??
                      profile.bindings.find((binding) => binding.capability === 'image-to-text');
                    const visionEnabled =
                      Boolean(visionPipelineStep?.enabled) && Boolean(visionBinding);
                    const bindingBadges = [
                      {
                        label: 'Text',
                        value: textBinding?.modelId || 'Not set',
                        tone: textBinding?.modelId ? 'accent' : 'muted',
                      },
                      {
                        label: 'Vision',
                        value: visionEnabled
                          ? visionBinding?.modelId ?? 'Assigned'
                          : visionBinding
                          ? 'Disabled'
                          : 'Not configured',
                        tone: visionEnabled ? 'success' : 'muted',
                      },
                    ];

                    return (
                      <li key={profile.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-pressed={isActive}
                          onClick={() => handleSelectProfile(profile.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleSelectProfile(profile.id);
                            }
                          }}
                          className={`border rounded-lg sm:rounded-xl p-3 sm:p-4 flex flex-col gap-2 sm:gap-3 transition-all duration-200 cursor-pointer focus:outline-none h-full ${
                            isActive
                              ? 'bg-accent-50 dark:bg-slate-700 border-accent-400 dark:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500'
                              : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent-500/70'
                          }`}
                        >
                          <div className="flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-slate-900 dark:text-slate-50 truncate">
                                  {profile.name}
                                </h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                                  {profile.provider} &middot; {profile.modelId}
                                </p>
                                {/* Model Support Status Badge */}
                                {profile.metadata.compatibilityStatus === 'compatible' ? (
                                  <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    Compatible
                                  </span>
                                ) : profile.metadata.compatibilityStatus === 'incompatible' ? (
                                  <div className="flex flex-col gap-1 mt-1.5">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400">
                                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                      </svg>
                                      Not Compatible
                                    </span>
                                    {profile.metadata.compatibilitySummary && (
                                      <span className="text-xs text-danger-700 dark:text-danger-400 leading-relaxed">
                                        {profile.metadata.compatibilitySummary}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                    </svg>
                                    Check Needed
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-2 flex-shrink-0">
                                {profile.metadata.lastCompatibilityCheckAt && (
                                  <span className="text-xs text-slate-500 dark:text-slate-400" title={`Last checked: ${formatTimestamp(profile.metadata.lastCompatibilityCheckAt)}`}>
                                    {new Date(profile.metadata.lastCompatibilityCheckAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                              {profile.baseUrl ?? 'No base URL configured'}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {bindingBadges.map((badge) => (
                                <span
                                  key={badge.label}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.7rem] font-semibold tracking-wide ${
                                    badge.tone === 'success'
                                      ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                                      : badge.tone === 'accent'
                                      ? 'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300'
                                      : 'bg-slate-200 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300'
                                  }`}
                                >
                                  <span>{badge.label}:</span>
                                  <span className="font-medium truncate max-w-[10rem]">
                                    {badge.value}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>

                          <dl className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <dt className="text-[0.65rem] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                Temp
                              </dt>
                              <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {profile.temperature}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[0.65rem] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                Top P
                              </dt>
                              <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {profile.topP}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[0.65rem] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                Tokens
                              </dt>
                              <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {profile.maxOutputTokens}
                              </dd>
                            </div>
                          </dl>

                          {profile.notes ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Notes: {profile.notes}
                            </p>
                          ) : null}

                          <div className="flex flex-col gap-2 pt-2 border-t border-slate-200 dark:border-slate-700 mt-auto">
                            <p className="text-[0.65rem] text-slate-500 dark:text-slate-400 text-center">
                              Click card for details &amp; history
                            </p>
                            <div className="grid grid-cols-3 gap-1.5">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRunCompatibilityCheck(profile);
                                }}
                                disabled={runningCompatibilityCheck !== null}
                                className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold border border-accent-500/70 text-accent-600 dark:text-accent-400 hover:text-accent-700 dark:hover:text-accent-300 hover:border-accent-600 rounded-lg transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {runningCompatibilityCheck === profile.id
                                  ? 'Checking…'
                                  : 'Compatibility'}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleEditProfile(profile);
                                }}
                                className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 rounded-lg transition-all duration-200"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteProfile(profile);
                                }}
                                className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold bg-gradient-to-r from-danger-600 to-danger-700 hover:from-danger-700 hover:to-danger-800 text-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
        </section>

        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-4 transition-theme">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                LM Studio models
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Auto-detected from your running LM Studio instance.
              </p>
              {discovery.lastFetchedAt && (
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                  Last updated {formatTimestamp(discovery.lastFetchedAt)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleRefreshDiscovery}
              disabled={discovery.status === 'loading'}
              className="inline-flex items-center px-3 py-2 text-sm font-medium border border-accent-500/70 text-accent-600 hover:text-accent-700 hover:border-accent-600 rounded-xl transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {discovery.status === 'loading' ? 'Scanning…' : 'Refresh'}
            </button>
          </header>

          {discovery.status === 'error' && (
            <div className="border border-danger-200 dark:border-danger-800/60 bg-danger-50/50 dark:bg-danger-900/20 rounded-xl px-3 py-2 text-sm text-danger-700 dark:text-danger-300">
              Failed to refresh models: {discovery.error}
            </div>
          )}
          {discovery.models.length === 0 && discovery.status !== 'loading' ? (
            <p className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-sm text-slate-500 dark:text-slate-400">
              No models discovered yet. Make sure LM Studio&apos;s server is running and accessible.
            </p>
          ) : (
            <>
              {(() => {
                // Count profiles per model ID
                const profileCountByModel = new Map<string, number>();
                profiles.forEach((profile) => {
                  if (!profile.modelId) {
                    return;
                  }
                  const count = profileCountByModel.get(profile.modelId) ?? 0;
                  profileCountByModel.set(profile.modelId, count + 1);
                });

                // Split models into two groups
                const modelsWithProfiles = discovery.models.filter((model) =>
                  profileCountByModel.has(model.id)
                );
                const modelsWithoutProfiles = discovery.models.filter(
                  (model) => !profileCountByModel.has(model.id)
                );

                return (
                  <div className="flex flex-col gap-6">
                    {modelsWithProfiles.length > 0 && (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Models with profiles ({modelsWithProfiles.length})
                          </h4>
                          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700"></div>
                        </div>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {modelsWithProfiles.map((model) => {
                            const supportsVision = model.capabilities.includes('vision');
                            const profileCount = profileCountByModel.get(model.id) ?? 0;
                            return (
                              <li
                                key={model.id}
                                className="border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/30 rounded-xl p-4 flex flex-col gap-3 transition-theme"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <h5 className="font-semibold text-slate-900 dark:text-slate-50 truncate">
                                      {model.displayName ?? model.id}
                                    </h5>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                      {model.kind ?? 'Model'} · {model.state ?? 'unknown'}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                                      {model.maxContextLength
                                        ? `${model.maxContextLength.toLocaleString()} tokens`
                                        : 'Context unknown'}
                                      {model.quantization ? ` · ${model.quantization}` : ''}
                                    </p>
                                  </div>
                                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-400">
                                      {profileCount} {profileCount === 1 ? 'profile' : 'profiles'}
                                    </span>
                                    <span
                                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${
                                        model.loaded
                                          ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                                          : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300'
                                      }`}
                                    >
                                      {model.loaded ? 'Loaded' : 'Unloaded'}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleAdoptDiscoveredModel(model, 'text-to-text')}
                                    className="flex-1 text-sm font-semibold text-accent-600 dark:text-accent-400 hover:text-accent-700 dark:hover:text-accent-300 border border-accent-500/60 hover:border-accent-600 rounded-lg px-3 py-1.5 transition-all duration-200"
                                  >
                                    Create text profile
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAdoptDiscoveredModel(model, 'image-to-text')}
                                    disabled={!supportsVision}
                                    className="flex-1 text-sm font-semibold border rounded-lg px-3 py-1.5 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-accent-400 dark:hover:border-accent-500"
                                  >
                                    Vision pipeline
                                  </button>
                                </div>
                                {!supportsVision ? (
                                  <p className="text-xs text-slate-500 dark:text-slate-500">
                                    Vision option disabled — model does not advertise vision capability.
                                  </p>
                                ) : null}
                                <div className="flex flex-wrap gap-1.5">
                                  {model.capabilities.length > 0 ? (
                                    model.capabilities.slice(0, 3).map((capability) => (
                                      <span
                                        key={capability}
                                        className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300"
                                      >
                                        {capability.replace(/_/g, ' ')}
                                      </span>
                                    ))
                                  ) : null}
                                  {model.capabilities.length > 3 && (
                                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400">
                                      +{model.capabilities.length - 3}
                                    </span>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {modelsWithoutProfiles.length > 0 && (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Available models ({modelsWithoutProfiles.length})
                          </h4>
                          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700"></div>
                        </div>
                        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {modelsWithoutProfiles.map((model) => {
                            const supportsVision = model.capabilities.includes('vision');
                            return (
                              <li
                                key={model.id}
                                className="border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/30 rounded-xl p-4 flex flex-col gap-3 transition-theme"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <h5 className="font-semibold text-slate-900 dark:text-slate-50 truncate">
                                      {model.displayName ?? model.id}
                                    </h5>
                                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                                      {model.kind ?? 'Model'} · {model.state ?? 'unknown'}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                                      {model.maxContextLength
                                        ? `${model.maxContextLength.toLocaleString()} tokens`
                                        : 'Context unknown'}
                                      {model.quantization ? ` · ${model.quantization}` : ''}
                                    </p>
                                  </div>
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide flex-shrink-0 ${
                                      model.loaded
                                        ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                                        : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300'
                                    }`}
                                  >
                                    {model.loaded ? 'Loaded' : 'Unloaded'}
                                  </span>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleAdoptDiscoveredModel(model, 'text-to-text')}
                                    className="flex-1 text-sm font-semibold text-accent-600 dark:text-accent-400 hover:text-accent-700 dark:hover:text-accent-300 border border-accent-500/60 hover:border-accent-600 rounded-lg px-3 py-1.5 transition-all duration-200"
                                  >
                                    Create text profile
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAdoptDiscoveredModel(model, 'image-to-text')}
                                    disabled={!supportsVision}
                                    className="flex-1 text-sm font-semibold border rounded-lg px-3 py-1.5 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-accent-400 dark:hover:border-accent-500"
                                  >
                                    Vision pipeline
                                  </button>
                                </div>
                                {!supportsVision ? (
                                  <p className="text-xs text-slate-500 dark:text-slate-500">
                                    Vision option disabled — model does not advertise vision capability.
                                  </p>
                                ) : null}
                                <div className="flex flex-wrap gap-1.5">
                                  {model.capabilities.length > 0 ? (
                                    model.capabilities.slice(0, 3).map((capability) => (
                                      <span
                                        key={capability}
                                        className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300"
                                      >
                                        {capability.replace(/_/g, ' ')}
                                      </span>
                                    ))
                                  ) : null}
                                  {model.capabilities.length > 3 && (
                                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-400">
                                      +{model.capabilities.length - 3}
                                    </span>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </section>
      </div>

      <Modal
        isOpen={isProfileDetailOpen && Boolean(selectedProfile)}
        onClose={handleCloseProfileDetails}
        title={selectedProfile ? selectedProfile.name : 'Profile details'}
      >
        {selectedProfile ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-2">
                {selectedProfile.description ? (
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {selectedProfile.description}
                  </p>
                ) : null}
                {selectedProfile.notes ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedProfile.notes}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleEditProfile(selectedProfile)}
                  className="inline-flex items-center px-4 py-2.5 text-sm font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-100 rounded-xl hover:border-slate-400 dark:hover:border-slate-500 transition-all duration-200"
                >
                  Edit profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleRunCompatibilityCheck(selectedProfile);
                  }}
                  disabled={runningCompatibilityCheck !== null}
                  className="inline-flex items-center px-4 py-2.5 text-sm font-semibold border border-accent-400 dark:border-accent-500 bg-accent-500/10 dark:bg-accent-500/15 text-accent-700 dark:text-accent-300 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {runningCompatibilityCheck === selectedProfile.id ? 'Checking…' : 'Run Compatibility Check'}
                </button>
              </div>
            </div>

            <section className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-900/40">
              <header className="mb-3">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Pipeline Overview
                </h4>
              </header>
              <ul className="flex flex-col gap-2 text-sm">
                {selectedProfile.pipeline.map((step, index) => {
                  const binding = selectedProfile.bindings.find((b) => b.id === step.bindingId);
                  return (
                    <li key={step.id} className="flex items-start gap-2">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{index + 1}.</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-900 dark:text-slate-50">{step.label}</span>
                          {step.enabled ? (
                            <span className="px-1.5 py-0.5 bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-400 text-xs font-semibold rounded">
                              Enabled
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold rounded">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          {binding ? `${binding.name} (${binding.modelId || 'model unknown'})` : 'No binding assigned'}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-white dark:bg-slate-900/40">
              <header className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Binding overview
                </h4>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedProfile.bindings.length}{' '}
                  {selectedProfile.bindings.length === 1 ? 'binding' : 'bindings'}
                </span>
              </header>
              <ul className="flex flex-col gap-3">
                {selectedProfile.bindings.map((binding) => {
                  const pipelineSteps = selectedProfile.pipeline.filter(
                    (step) => step.bindingId === binding.id
                  );
                  const isVision = binding.capability === 'image-to-text';
                  const stepNames =
                    pipelineSteps.length > 0
                      ? pipelineSteps.map((step) => `${step.label}${step.enabled ? '' : ' (disabled)'}`).join(', ')
                      : 'Not assigned to pipeline';
                  return (
                    <li
                      key={binding.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 bg-slate-50/70 dark:bg-slate-900/30"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            {binding.name}{' '}
                            <span className="text-xs font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {binding.capability === 'text-to-text' ? 'Text' : 'Vision'}
                            </span>
                          </span>
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            {binding.modelId || 'Model not assigned'}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {binding.baseUrl ?? 'No base URL'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          <strong className="font-semibold text-slate-700 dark:text-slate-200">
                            Pipeline:
                          </strong>{' '}
                          {stepNames}
                        </div>
                      </div>
                      {isVision && binding.metadata?.supportsJsonMode === false ? (
                        <p className="text-[0.65rem] text-warning-600 dark:text-warning-400 mt-2">
                          Vision binding marked as non-JSON; OCR summaries will capture plain text only.
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>

            <div className="flex flex-col gap-6 border-t border-slate-200 dark:border-slate-700 pt-6">
              <header className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                    Compatibility Status
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                    Run compatibility checks to verify model support for vision and text reasoning.
                  </p>
                </div>
              </header>

              <div className="bg-accent-500/6 dark:bg-accent-500/10 rounded-xl p-4">
                <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                      Status
                    </dt>
                    <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {selectedProfile.metadata.compatibilityStatus === 'compatible' ? (
                        <span className="text-success-600 dark:text-success-400">Compatible</span>
                      ) : selectedProfile.metadata.compatibilityStatus === 'incompatible' ? (
                        <span className="text-danger-600 dark:text-danger-400">Incompatible</span>
                      ) : selectedProfile.metadata.compatibilityStatus === 'in_progress' ? (
                        <span className="text-accent-600 dark:text-accent-400">Checking...</span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">Not checked</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                      JSON Format
                    </dt>
                    <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {selectedProfile.metadata.jsonFormat || 'Unknown'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                      Last Check
                    </dt>
                    <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {formatTimestamp(selectedProfile.metadata.lastCompatibilityCheckAt)}
                    </dd>
                  </div>
                </dl>
                {selectedProfile.metadata.compatibilitySummary && (
                  <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
                    {selectedProfile.metadata.compatibilitySummary}
                  </p>
                )}
              </div>

              {selectedProfile.lastCompatibilityCheck && selectedProfile.lastCompatibilityCheck.steps.length > 0 && (
                <div className="mt-4 space-y-3">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    Check Details
                  </h4>
                  {selectedProfile.lastCompatibilityCheck.steps.map((step) => (
                    <div
                      key={step.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/30 p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {step.name}
                        </span>
                        {step.status === 'pass' ? (
                          <span className="px-2 py-0.5 bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-400 text-xs font-semibold rounded">
                            Pass
                          </span>
                        ) : step.status === 'fail' ? (
                          <span className="px-2 py-0.5 bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400 text-xs font-semibold rounded">
                            Fail
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold rounded">
                            Pending
                          </span>
                        )}
                      </div>
                      {step.error && (
                        <p className="text-xs text-danger-600 dark:text-danger-400 mb-2">
                          {step.error}
                        </p>
                      )}
                      {step.logs.length > 0 && (
                        <div className="space-y-1">
                          {step.logs.map((log) => (
                            <div
                              key={log.id}
                              className="flex items-start gap-2 text-xs font-mono"
                            >
                              {log.severity === 'error' ? (
                                <span className="text-danger-600 dark:text-danger-400">✗</span>
                              ) : log.severity === 'warn' ? (
                                <span className="text-warning-600 dark:text-warning-400">⚠</span>
                              ) : (
                                <span className="text-slate-500 dark:text-slate-400">•</span>
                              )}
                              <span className={
                                log.severity === 'error'
                                  ? 'text-danger-600 dark:text-danger-400'
                                  : log.severity === 'warn'
                                  ? 'text-warning-600 dark:text-warning-400'
                                  : 'text-slate-600 dark:text-slate-400'
                              }>
                                {log.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={isProfileDialogOpen} onClose={handleCloseDialog} title={dialogTitle}>
        <form className="flex flex-col gap-6" onSubmit={handleSave}>
          {formError ? (
            <div className="rounded-xl border border-danger-200 dark:border-danger-700 bg-danger-50/70 dark:bg-danger-900/30 px-4 py-3 text-sm font-semibold text-danger-700 dark:text-danger-300">
              {formError}
            </div>
          ) : null}
          {feedback && isProfileDialogOpen ? (
            <div className="rounded-xl border border-accent-200 dark:border-accent-600 bg-accent-50/70 dark:bg-accent-900/30 px-4 py-3 text-sm font-semibold text-accent-700 dark:text-accent-300">
              {feedback}
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Name
              </span>
              <input
                required
                type="text"
                value={formState.name}
                onChange={handleFieldChange('name')}
                placeholder="My LM Studio profile"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Description
              </span>
              <input
                type="text"
                value={formState.description}
                onChange={handleFieldChange('description')}
                placeholder="Optional short label"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
          </div>

          <section className="border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900/40 p-4 flex flex-col gap-3 transition-theme">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              Pipeline overview
            </h3>
            <ul className="text-sm text-slate-600 dark:text-slate-400 flex flex-col gap-2">
              <li className="flex items-start gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300">1.</span>
                <span>
                  Image preprocessing &mdash;{' '}
                  {imagePipelineStep?.enabled
                    ? visionBinding
                      ? `${visionBinding.name} (${visionBinding.modelId || 'model unknown'})`
                      : 'Binding required'
                    : 'Disabled'}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300">2.</span>
                <span>
                  Text reasoning &mdash;{' '}
                  {textBinding
                    ? `${textBinding.name} (${textBinding.modelId || 'model unknown'})`
                    : 'Binding required'}
                </span>
              </li>
            </ul>
          </section>

          <section className="border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900/40 p-4 flex flex-col gap-4 transition-theme">
            <header className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                  Vision preprocessing binding
                </h3>
                <span className="px-2 py-0.5 bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 text-xs font-semibold rounded">
                  Required
                </span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Used to extract text from images before the text reasoning step. All profiles must support vision.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Quick start prompts: GOT-OCR — "Transcribe every character and return plain text" · Qwen-VL — "Output only detected text with newline separators" · Gemma Vision — "Provide faithful transcription of printed or handwritten content".
              </p>
            </header>
            {visionBinding ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Binding name
                    </span>
                    <input
                      type="text"
                      value={visionBinding.name}
                      onChange={handleBindingFieldChange(visionBinding.id, 'name')}
                      placeholder="Vision model"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Transport
                    </span>
                    <select
                      value={visionBinding.transport}
                      onChange={handleBindingFieldChange(visionBinding.id, 'transport')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    >
                      <option value="lmstudio">LM Studio</option>
                      <option value="openai-compatible">OpenAI-compatible</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </label>
                </div>
                {(visionBinding.transport === 'lmstudio' || visionBinding.transport === 'openrouter') && (
                  <div className="flex flex-col gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Select model from server
                      </span>
                      <button
                        type="button"
                        onClick={() => handleLoadModels(visionBinding.id)}
                        disabled={loadingModels[visionBinding.id]}
                        className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 transition-all duration-200 disabled:opacity-50"
                      >
                        {loadingModels[visionBinding.id] ? 'Loading...' : 'Load Models'}
                      </button>
                    </div>
                    {availableModels[visionBinding.id] && availableModels[visionBinding.id].length > 0 && (
                      <select
                        value={visionBinding.modelId}
                        onChange={(e) => handleSelectModel(visionBinding.id, e.target.value)}
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                      >
                        <option value="">Select a model...</option>
                        {availableModels[visionBinding.id].map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.id}
                          </option>
                        ))}
                      </select>
                    )}
                    {availableModels[visionBinding.id]?.length === 0 && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        No models found. Ensure the server is reachable and exposes the /v1/models endpoint.
                      </p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Base URL
                    </span>
                    <input
                      type="text"
                      value={visionBinding.baseUrl}
                      onChange={handleBindingFieldChange(visionBinding.id, 'baseUrl')}
                      placeholder="http://localhost:1235/v1"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Model ID
                    </span>
                    <input
                      type="text"
                      value={visionBinding.modelId}
                      onChange={handleBindingFieldChange(visionBinding.id, 'modelId')}
                      placeholder="vision/model"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Max output tokens
                    </span>
                    <input
                      type="number"
                      value={visionBinding.maxOutputTokens}
                      onChange={handleBindingFieldChange(visionBinding.id, 'maxOutputTokens')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Temperature
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      value={visionBinding.temperature}
                      onChange={handleBindingFieldChange(visionBinding.id, 'temperature')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Request timeout (ms)
                    </span>
                    <input
                      type="number"
                      value={visionBinding.requestTimeoutMs}
                      onChange={handleBindingFieldChange(visionBinding.id, 'requestTimeoutMs')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                </div>
                <label className="flex flex-col">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Default prompt (optional)
                  </span>
                  <textarea
                    value={visionBinding.defaultSystemPrompt}
                    onChange={handleBindingFieldChange(visionBinding.id, 'defaultSystemPrompt')}
                    rows={3}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={visionBinding.metadata?.supportsJsonMode ?? false}
                    onChange={handleBindingMetadataChange(visionBinding.id, 'supportsJsonMode')}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-accent-500"
                  />
                  Vision binding expects JSON
                </label>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Vision binding is missing. All profiles require vision support to pass compatibility checks.
                </p>
                <button
                  type="button"
                  onClick={handleVisionEnabledChange as any}
                  className="inline-flex items-center justify-center px-3 py-2 text-sm font-semibold border border-accent-500/70 text-accent-600 hover:text-accent-700 hover:border-accent-600 rounded-xl transition-all duration-200"
                >
                  Add vision binding
                </button>
              </div>
            )}
            {imagePipelineStep ? (
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
                <label className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Vision step binding
                  </span>
                  <select
                    value={imagePipelineStep.bindingId ?? ''}
                    onChange={handlePipelineBindingChange(imagePipelineStep.id)}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme md:w-72"
                    disabled={availableVisionBindings.length === 0}
                  >
                    <option value="">Unassigned</option>
                    {availableVisionBindings.map((binding) => (
                      <option key={binding.id} value={binding.id}>
                        {binding.name} · {binding.modelId || 'model unknown'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </section>

          <section className="border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900/40 p-4 flex flex-col gap-4 transition-theme">
            <header className="flex flex-col gap-1">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Text reasoning binding
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Primary text-to-text model used for benchmark steps.
              </p>
            </header>
            {textBinding ? (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Binding name
                    </span>
                    <input
                      type="text"
                      value={textBinding.name}
                      onChange={handleBindingFieldChange(textBinding.id, 'name')}
                      placeholder="Text model"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Transport
                    </span>
                    <select
                      value={textBinding.transport}
                      onChange={handleBindingFieldChange(textBinding.id, 'transport')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    >
                      <option value="lmstudio">LM Studio</option>
                      <option value="openai-compatible">OpenAI-compatible</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </label>
                </div>
                {(textBinding.transport === 'lmstudio' || textBinding.transport === 'openrouter') && (
                  <div className="flex flex-col gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Select model from server
                      </span>
                      <button
                        type="button"
                        onClick={() => handleLoadModels(textBinding.id)}
                        disabled={loadingModels[textBinding.id]}
                        className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 transition-all duration-200 disabled:opacity-50"
                      >
                        {loadingModels[textBinding.id] ? 'Loading...' : 'Load Models'}
                      </button>
                    </div>
                    {availableModels[textBinding.id] && availableModels[textBinding.id].length > 0 && (
                      <select
                        value={textBinding.modelId}
                        onChange={(e) => handleSelectModel(textBinding.id, e.target.value)}
                        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                      >
                        <option value="">Select a model...</option>
                        {availableModels[textBinding.id].map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.id}
                          </option>
                        ))}
                      </select>
                    )}
                    {availableModels[textBinding.id]?.length === 0 && (
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        No models found. Make sure LM Studio is running and has models loaded.
                      </p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Base URL
                    </span>
                    <input
                      required
                      type="text"
                      value={textBinding.baseUrl}
                      onChange={handleBindingFieldChange(textBinding.id, 'baseUrl')}
                      placeholder="http://localhost:1234/v1"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      API key
                    </span>
                    <input
                      type="password"
                      value={textBinding.apiKey ?? ''}
                      onChange={handleBindingFieldChange(textBinding.id, 'apiKey')}
                      placeholder="Optional"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Model ID
                    </span>
                    <input
                      required
                      type="text"
                      value={textBinding.modelId}
                      onChange={handleBindingFieldChange(textBinding.id, 'modelId')}
                      placeholder="example/model-identifier"
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Request timeout (ms)
                    </span>
                    <input
                      type="number"
                      value={textBinding.requestTimeoutMs}
                      onChange={handleBindingFieldChange(textBinding.id, 'requestTimeoutMs')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Temperature
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      value={textBinding.temperature}
                      onChange={handleBindingFieldChange(textBinding.id, 'temperature')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Top P
                    </span>
                    <input
                      type="number"
                      step="0.05"
                      value={textBinding.topP ?? DEFAULT_PROFILE_VALUES.topP}
                      onChange={handleBindingFieldChange(textBinding.id, 'topP')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Max output tokens
                    </span>
                    <input
                      type="number"
                      value={textBinding.maxOutputTokens}
                      onChange={handleBindingFieldChange(textBinding.id, 'maxOutputTokens')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Frequency penalty
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      value={textBinding.frequencyPenalty ?? DEFAULT_PROFILE_VALUES.frequencyPenalty}
                      onChange={handleBindingFieldChange(textBinding.id, 'frequencyPenalty')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Presence penalty
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      value={textBinding.presencePenalty ?? DEFAULT_PROFILE_VALUES.presencePenalty}
                      onChange={handleBindingFieldChange(textBinding.id, 'presencePenalty')}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                </div>
                <label className="flex flex-col">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Default system prompt
                  </span>
                  <textarea
                    value={textBinding.defaultSystemPrompt}
                    onChange={handleBindingFieldChange(textBinding.id, 'defaultSystemPrompt')}
                    rows={4}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={textBinding.metadata?.supportsJsonMode ?? true}
                    onChange={handleBindingMetadataChange(textBinding.id, 'supportsJsonMode')}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-accent-500"
                  />
                  Prefer JSON responses
                </label>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  This profile is missing a text binding. Restore the default to continue editing.
                </p>
                <button
                  type="button"
                  onClick={handleRestoreTextBinding}
                  className="inline-flex items-center justify-center px-3 py-2 text-sm font-semibold border border-accent-500/70 text-accent-600 hover:text-accent-700 hover:border-accent-600 rounded-xl transition-all duration-200"
                >
                  Restore default text binding
                </button>
              </div>
            )}
            {textPipelineStep ? (
              <div className="border-t border-slate-200 dark:border-slate-700 pt-4 mt-2">
                <label className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Text step binding
                  </span>
                  <select
                    value={textPipelineStep.bindingId ?? textBinding?.id ?? ''}
                    onChange={handlePipelineBindingChange(textPipelineStep.id)}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme md:w-72"
                  >
                    {availableTextBindings.map((binding) => (
                      <option key={binding.id} value={binding.id}>
                        {binding.name} · {binding.modelId || 'Unassigned'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </section>

          <label className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Notes
            </span>
            <textarea
              value={formState.notes}
              onChange={handleFieldChange('notes')}
              rows={3}
              placeholder="Optional notes or troubleshooting tips"
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>

          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Benchmark steps
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Enable or disable benchmark phases for this profile.
              </p>
            </div>
            <ul className="flex flex-col gap-4">
              {formState.benchmarkSteps.map((step, index) => (
                <li
                  key={step.id}
                  className="border border-slate-200 dark:border-slate-600 rounded-xl p-4 flex flex-col gap-3 bg-white dark:bg-slate-900/40 transition-theme"
                >
                  <div className="flex justify-between items-center gap-3">
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-slate-50">
                        {step.label}
                      </h4>
                      {step.description ? (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {step.description}
                        </p>
                      ) : null}
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={handleStepChange(index, 'enabled') as never}
                        className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-accent-500"
                      />
                      Enabled
                    </label>
                  </div>
                  <label className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                      Prompt template
                    </span>
                    <textarea
                      value={step.promptTemplate}
                      onChange={handleStepChange(index, 'promptTemplate')}
                      rows={3}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-4">
            <button
              className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Saving…' : dialogMode === 'edit' ? 'Save changes' : 'Create profile'}
            </button>
            {dialogMode === 'edit' || formState.id ? (
              <button
                className="bg-gradient-to-r from-danger-600 to-danger-700 hover:from-danger-700 hover:to-danger-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                type="button"
                onClick={handleDeleteProfileFromDialog}
              >
                Delete profile
              </button>
            ) : null}
          </div>
        </form>
      </Modal>
    </>
  );
};

export default Profiles;
