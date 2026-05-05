import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useBenchmarkContext } from '@/context/BenchmarkContext';

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

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
const formatLatency = (value: number) => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${Math.round(value)} ms`;
};

// Performance tier colors
const getPerformanceColor = (rank: number, total: number) => {
  if (rank === 1) return { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-400 dark:border-amber-500', text: 'text-amber-700 dark:text-amber-300', badge: 'bg-amber-500' };
  if (rank === 2) return { bg: 'bg-slate-50 dark:bg-slate-700/30', border: 'border-slate-400 dark:border-slate-500', text: 'text-slate-700 dark:text-slate-300', badge: 'bg-slate-400' };
  if (rank === 3) return { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-400 dark:border-orange-500', text: 'text-orange-700 dark:text-orange-300', badge: 'bg-orange-600' };
  if (total > 3 && rank === total) return { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-300 dark:border-red-500', text: 'text-red-700 dark:text-red-300', badge: 'bg-red-500' };
  return { bg: 'bg-white dark:bg-slate-800', border: 'border-slate-200 dark:border-slate-700', text: 'text-slate-700 dark:text-slate-300', badge: 'bg-slate-500' };
};

const getRankBadge = (rank: number) => {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
};

// Color palette for chart lines
const PROFILE_COLORS = [
  '#10b981', // green
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#a855f7', // purple
];

interface ProfilePerformance {
  profileId: string;
  profileName: string;
  profileModelId: string;
  totalRuns: number;
  averageAccuracy: number;
  averageTopologyAccuracy: number;
  averageLatencyMs: number;
  lastRunAt?: string;
  trend: {
    timestamp: string;
    accuracy: number;
    topologyAccuracy: number;
    latencyMs: number;
  }[];
}

const Dashboard = () => {
  const { loading, runs, datasets } = useBenchmarkContext();
  const [selectedDatasetFilter, setSelectedDatasetFilter] = useState<string>('all');

  const profilePerformanceData = useMemo(() => {
    // Filter runs by dataset if a specific dataset is selected
    const filteredRuns = runs.filter((run) => {
      if (run.status !== 'completed') return false;
      if (selectedDatasetFilter === 'all') return true;
      return run.datasetId === selectedDatasetFilter;
    });

    const completedRuns = filteredRuns;

    if (completedRuns.length === 0) {
      return [];
    }

    // Group runs by profile
    const runsByProfile = new Map<string, typeof completedRuns>();
    completedRuns.forEach((run) => {
      const existing = runsByProfile.get(run.profileId) || [];
      runsByProfile.set(run.profileId, [...existing, run]);
    });

    // Compute performance metrics per profile
    const profilePerformances: ProfilePerformance[] = [];

    runsByProfile.forEach((profileRuns, profileId) => {
      const sortedRuns = [...profileRuns].sort((a, b) => {
        const aTime = a.completedAt ?? a.createdAt;
        const bTime = b.completedAt ?? b.createdAt;
        return aTime.localeCompare(bTime);
      });

      const totalRuns = profileRuns.length;
      const averageAccuracy = profileRuns.reduce((acc, run) => acc + run.metrics.accuracy, 0) / totalRuns;
      const averageTopologyAccuracy = profileRuns.reduce((acc, run) => acc + run.metrics.topologyAccuracy, 0) / totalRuns;
      const averageLatencyMs = profileRuns.reduce((acc, run) => acc + run.metrics.averageLatencyMs, 0) / totalRuns;

      const lastRun = sortedRuns[sortedRuns.length - 1];
      const lastRunAt = lastRun?.completedAt ?? lastRun?.createdAt;

      const trend = sortedRuns.map((run) => ({
        timestamp: run.completedAt ?? run.createdAt,
        accuracy: run.metrics.accuracy * 100,
        topologyAccuracy: run.metrics.topologyAccuracy * 100,
        latencyMs: run.metrics.averageLatencyMs,
      }));

      profilePerformances.push({
        profileId,
        profileName: profileRuns[0].profileName,
        profileModelId: profileRuns[0].profileModelId,
        totalRuns,
        averageAccuracy,
        averageTopologyAccuracy,
        averageLatencyMs,
        lastRunAt,
        trend,
      });
    });

    // Sort by last run date (most recent first)
    return profilePerformances.sort((a, b) => {
      if (!a.lastRunAt) return 1;
      if (!b.lastRunAt) return -1;
      return b.lastRunAt.localeCompare(a.lastRunAt);
    });
  }, [runs, selectedDatasetFilter]);

  // Prepare chart data with all profiles' trends
  const chartData = useMemo(() => {
    if (profilePerformanceData.length === 0) {
      return [];
    }

    // Collect all unique timestamps across all profiles
    const allTimestamps = new Set<string>();
    profilePerformanceData.forEach(profile => {
      profile.trend.forEach(point => {
        allTimestamps.add(point.timestamp);
      });
    });

    const sortedTimestamps = Array.from(allTimestamps).sort();

    // Build chart data with one point per timestamp
    return sortedTimestamps.map(timestamp => {
      const dataPoint: Record<string, number | string> = {
        timestamp: new Date(timestamp).toLocaleDateString(),
        fullTimestamp: timestamp,
      };

      profilePerformanceData.forEach((profile) => {
        const point = profile.trend.find(p => p.timestamp === timestamp);
        if (point) {
          dataPoint[`${profile.profileId}_accuracy`] = point.accuracy;
          dataPoint[`${profile.profileId}_topologyAccuracy`] = point.topologyAccuracy;
          dataPoint[`${profile.profileId}_latency`] = point.latencyMs;
        }
      });

      return dataPoint;
    });
  }, [profilePerformanceData]);

  const activeRuns = useMemo(() =>
    runs.filter((run) => run.status === 'running' || run.status === 'queued').length,
    [runs]
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Track model profile performance and accuracy trends over time.
          </p>
        </header>

        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-accent-200 dark:border-accent-800 border-t-accent-600 dark:border-t-accent-400 rounded-full animate-spin"></div>
            <p className="text-slate-600 dark:text-slate-400 font-medium">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  if (profilePerformanceData.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Track model profile performance and accuracy trends over time.
          </p>
        </header>

        <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm p-8 flex flex-col items-center gap-4">
          <div className="text-slate-400 dark:text-slate-500 text-6xl">📊</div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">No benchmark data yet</h2>
          <p className="text-slate-600 dark:text-slate-400 text-center max-w-md">
            Run your first benchmark to see profile performance metrics and trends.
          </p>
          <Link
            to="/runs"
            className="mt-4 px-6 py-3 bg-accent-600 hover:bg-accent-700 text-white font-semibold rounded-lg transition-colors"
          >
            Launch new benchmark →
          </Link>
        </section>
      </div>
    );
  }

  // Sort profiles by accuracy (best first) and assign ranks
  const rankedProfiles = useMemo(() => {
    return [...profilePerformanceData]
      .sort((a, b) => b.averageAccuracy - a.averageAccuracy)
      .map((profile, index) => ({
        ...profile,
        rank: index + 1,
      }));
  }, [profilePerformanceData]);

  // Prepare data for comparison bar charts
  const comparisonData = useMemo(() => {
    return rankedProfiles.map((profile) => ({
      name: profile.profileName.length > 15
        ? profile.profileName.substring(0, 15) + '...'
        : profile.profileName,
      fullName: profile.profileName,
      accuracy: profile.averageAccuracy * 100,
      topologyAccuracy: profile.averageTopologyAccuracy * 100,
      latency: profile.averageLatencyMs,
    }));
  }, [rankedProfiles]);

  const selectedDatasetName = useMemo(() => {
    if (selectedDatasetFilter === 'all') return 'All Datasets';
    const dataset = datasets.find(d => d.id === selectedDatasetFilter);
    return dataset?.name ?? 'Unknown Dataset';
  }, [selectedDatasetFilter, datasets]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Model Performance Dashboard
        </h1>
        <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
          Compare model profiles and identify top performers on your datasets.
        </p>
      </header>

      {/* Dataset Selector - Prominent */}
      <section className="bg-gradient-to-br from-accent-50 to-accent-100 dark:from-accent-900/20 dark:to-accent-800/20 rounded-xl sm:rounded-2xl shadow-sm p-6 transition-theme border border-accent-200 dark:border-accent-700">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-600 dark:bg-accent-500 flex items-center justify-center text-white font-bold text-lg">
              📊
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Select Dataset to Compare
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Choose a dataset to see how different model profiles perform
              </p>
            </div>
          </div>
          <select
            value={selectedDatasetFilter}
            onChange={(event) => setSelectedDatasetFilter(event.target.value)}
            className="appearance-none bg-white dark:bg-slate-900 border-2 border-accent-300 dark:border-accent-600 rounded-xl pl-4 pr-12 py-3.5 text-lg font-medium text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] dark:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5rem_1.5rem] bg-[right_1rem_center] bg-no-repeat"
          >
            <option value="all">All Datasets</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name} ({dataset.metadata.totalQuestions} questions)
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Active runs indicator */}
      {activeRuns > 0 && (
        <div className="bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-xl p-4 flex items-center gap-3">
          <div className="w-2 h-2 bg-accent-600 dark:bg-accent-400 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-accent-900 dark:text-accent-100">
            {activeRuns} benchmark{activeRuns === 1 ? '' : 's'} running
          </span>
        </div>
      )}

      {/* Performance Leaderboard */}
      <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm p-4 sm:p-5 lg:p-6 flex flex-col gap-4 sm:gap-5 lg:gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Performance Leaderboard
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-[0.95rem]">
            Ranked by average accuracy on <span className="font-semibold">{selectedDatasetName}</span>
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4">
          {rankedProfiles.map((profile) => {
            const colors = getPerformanceColor(profile.rank, rankedProfiles.length);
            return (
              <article
                key={profile.profileId}
                className={`${colors.bg} border-2 ${colors.border} rounded-xl p-5 transition-all hover:shadow-lg`}
              >
                <div className="flex items-start gap-4">
                  {/* Rank Badge */}
                  <div className={`${colors.badge} text-white w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0 shadow-md`}>
                    {getRankBadge(profile.rank)}
                  </div>

                  {/* Profile Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className={`font-bold ${colors.text} text-xl truncate`}>
                          {profile.profileName}
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                          {profile.profileModelId}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                          Total Runs
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                          {profile.totalRuns}
                        </div>
                      </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="bg-white/60 dark:bg-slate-900/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                          Answer Accuracy
                        </div>
                        <div className={`text-3xl font-bold ${
                          profile.averageAccuracy >= 0.8
                            ? 'text-success-600 dark:text-success-400'
                            : profile.averageAccuracy >= 0.6
                            ? 'text-warning-600 dark:text-warning-400'
                            : 'text-error-600 dark:text-error-400'
                        }`}>
                          {formatPercent(profile.averageAccuracy)}
                        </div>
                      </div>

                      <div className="bg-white/60 dark:bg-slate-900/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                          Topology Accuracy
                        </div>
                        <div className={`text-3xl font-bold ${
                          profile.averageTopologyAccuracy >= 0.8
                            ? 'text-success-600 dark:text-success-400'
                            : profile.averageTopologyAccuracy >= 0.6
                            ? 'text-warning-600 dark:text-warning-400'
                            : 'text-error-600 dark:text-error-400'
                        }`}>
                          {formatPercent(profile.averageTopologyAccuracy)}
                        </div>
                      </div>

                      <div className="bg-white/60 dark:bg-slate-900/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                          Avg Latency
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                          {formatLatency(profile.averageLatencyMs)}
                        </div>
                      </div>
                    </div>

                    {profile.lastRunAt && (
                      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Last run: {formatDateTime(profile.lastRunAt)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Comparison Bar Charts */}
      {rankedProfiles.length > 1 && (
        <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm p-4 sm:p-5 lg:p-6 flex flex-col gap-4 sm:gap-5 lg:gap-6 transition-theme">
          <header className="flex flex-col gap-2">
            <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Side-by-Side Comparison
            </h2>
            <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-[0.95rem]">
              Visual comparison of key metrics across all profiles
            </p>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Accuracy Comparison */}
            <div className="flex flex-col gap-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Answer Accuracy Comparison
              </h3>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData} margin={{ top: 16, right: 24, left: 0, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.1)" />
                    <XAxis
                      dataKey="name"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      tick={{ fill: '#52606d', fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(value: number) => `${Math.round(value)}%`}
                      tick={{ fill: '#52606d', fontSize: 11 }}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      formatter={(value: number) => `${value.toFixed(1)}%`}
                      labelFormatter={(label, payload) => {
                        const data = payload?.[0]?.payload;
                        return data?.fullName ?? label;
                      }}
                    />
                    <Bar dataKey="accuracy" fill="#10b981" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Topology Accuracy Comparison */}
            <div className="flex flex-col gap-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Topology Accuracy Comparison
              </h3>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData} margin={{ top: 16, right: 24, left: 0, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.1)" />
                    <XAxis
                      dataKey="name"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      tick={{ fill: '#52606d', fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(value: number) => `${Math.round(value)}%`}
                      tick={{ fill: '#52606d', fontSize: 11 }}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      formatter={(value: number) => `${value.toFixed(1)}%`}
                      labelFormatter={(label, payload) => {
                        const data = payload?.[0]?.payload;
                        return data?.fullName ?? label;
                      }}
                    />
                    <Bar dataKey="topologyAccuracy" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Performance Trends Over Time */}
      {chartData.length > 1 && (
        <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm p-4 sm:p-5 lg:p-6 flex flex-col gap-4 sm:gap-5 lg:gap-6 transition-theme">
          <header className="flex flex-col gap-2">
            <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Performance Trends Over Time
            </h2>
            <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-[0.95rem]">
              Track how model profiles improve or change over time
            </p>
          </header>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Answer Accuracy Trend */}
            <div className="flex flex-col gap-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Answer Accuracy Trend
              </h3>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.1)" />
                    <XAxis dataKey="timestamp" tick={{ fill: '#52606d', fontSize: 11 }} />
                    <YAxis
                      tickFormatter={(value: number) => `${Math.round(value)}%`}
                      tick={{ fill: '#52606d', fontSize: 11 }}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      formatter={(value: number | string) => {
                        if (typeof value === 'number') {
                          return `${value.toFixed(1)}%`;
                        }
                        return value;
                      }}
                      labelFormatter={(label) => `Date: ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    {profilePerformanceData.map((profile, index) => (
                      <Line
                        key={profile.profileId}
                        type="monotone"
                        dataKey={`${profile.profileId}_accuracy`}
                        stroke={PROFILE_COLORS[index % PROFILE_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name={profile.profileName}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Topology Accuracy Trend */}
            <div className="flex flex-col gap-3">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Topology Accuracy Trend
              </h3>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.1)" />
                    <XAxis dataKey="timestamp" tick={{ fill: '#52606d', fontSize: 11 }} />
                    <YAxis
                      tickFormatter={(value: number) => `${Math.round(value)}%`}
                      tick={{ fill: '#52606d', fontSize: 11 }}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      formatter={(value: number | string) => {
                        if (typeof value === 'number') {
                          return `${value.toFixed(1)}%`;
                        }
                        return value;
                      }}
                      labelFormatter={(label) => `Date: ${label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    {profilePerformanceData.map((profile, index) => (
                      <Line
                        key={profile.profileId}
                        type="monotone"
                        dataKey={`${profile.profileId}_topologyAccuracy`}
                        stroke={PROFILE_COLORS[index % PROFILE_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name={profile.profileName}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default Dashboard;
