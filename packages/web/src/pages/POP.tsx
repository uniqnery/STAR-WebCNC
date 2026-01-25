// POP Page - Production Performance Dashboard

import { useState, useEffect, useCallback } from 'react';
import { useMachineStore } from '../stores/machineStore';
import { productionApi } from '../lib/api';

type TimeRange = 'today' | 'week' | 'month';

interface ProductionStats {
  machineId: string;
  machineName: string;
  totalParts: number;
  targetParts: number;
  runTime: number;        // minutes
  idleTime: number;       // minutes
  downTime: number;       // minutes
  availability: number;   // percentage
  performance: number;    // percentage
  quality: number;        // percentage
  oee: number;            // percentage
}

interface ProductionChart {
  date: string;
  production: number;
  target: number;
}

export function POP() {
  const machines = useMachineStore((state) => state.machines);
  const selectedMachineId = useMachineStore((state) => state.selectedMachineId);

  const [timeRange, setTimeRange] = useState<TimeRange>('today');
  const [stats, setStats] = useState<ProductionStats[]>([]);
  const [chartData, setChartData] = useState<ProductionChart[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMachine, setSelectedMachine] = useState(selectedMachineId || '');

  // Load production stats
  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await productionApi.getStats(timeRange, selectedMachine || undefined);
      if (response.success && response.data) {
        setStats(response.data.stats as ProductionStats[]);
        setChartData(response.data.chart as ProductionChart[]);
      }
    } catch (err) {
      console.error('Failed to load production stats:', err);
    } finally {
      setIsLoading(false);
    }
  }, [timeRange, selectedMachine]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Calculate totals
  const totals = stats.reduce(
    (acc, s) => ({
      totalParts: acc.totalParts + s.totalParts,
      targetParts: acc.targetParts + s.targetParts,
      runTime: acc.runTime + s.runTime,
      idleTime: acc.idleTime + s.idleTime,
      downTime: acc.downTime + s.downTime,
    }),
    { totalParts: 0, targetParts: 0, runTime: 0, idleTime: 0, downTime: 0 }
  );

  const avgOEE = stats.length > 0
    ? stats.reduce((sum, s) => sum + s.oee, 0) / stats.length
    : 0;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            생산 실적 (POP)
          </h1>
          <p className="text-gray-500">생산 현황 및 KPI 모니터링</p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <select
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">전체 장비</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.machineId}>
                {machine.name}
              </option>
            ))}
          </select>

          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
            {(['today', 'week', 'month'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  timeRange === range
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100'
                }`}
              >
                {range === 'today' ? '오늘' : range === 'week' ? '이번 주' : '이번 달'}
              </button>
            ))}
          </div>

          <button
            onClick={loadStats}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 dark:text-gray-400"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KPICard
          title="총 생산량"
          value={totals.totalParts.toLocaleString()}
          unit="개"
          target={totals.targetParts}
          color="blue"
        />
        <KPICard
          title="평균 OEE"
          value={avgOEE.toFixed(1)}
          unit="%"
          color={avgOEE >= 85 ? 'green' : avgOEE >= 60 ? 'yellow' : 'red'}
        />
        <KPICard
          title="가동 시간"
          value={Math.round(totals.runTime / 60).toString()}
          unit="시간"
          subtext={`비가동: ${Math.round((totals.idleTime + totals.downTime) / 60)}시간`}
          color="green"
        />
        <KPICard
          title="비가동률"
          value={totals.runTime > 0
            ? ((totals.downTime / (totals.runTime + totals.idleTime + totals.downTime)) * 100).toFixed(1)
            : '0'}
          unit="%"
          color="red"
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Production Chart */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            생산량 추이
          </h2>
          <ProductionBarChart data={chartData} isLoading={isLoading} />
        </div>

        {/* OEE Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            OEE 구성요소
          </h2>
          {stats.length > 0 ? (
            <div className="space-y-4">
              <OEEGauge
                label="가동률 (Availability)"
                value={stats.reduce((s, stat) => s + stat.availability, 0) / stats.length}
              />
              <OEEGauge
                label="성능 (Performance)"
                value={stats.reduce((s, stat) => s + stat.performance, 0) / stats.length}
              />
              <OEEGauge
                label="품질 (Quality)"
                value={stats.reduce((s, stat) => s + stat.quality, 0) / stats.length}
              />
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <OEEGauge label="OEE" value={avgOEE} highlight />
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-8">데이터 없음</div>
          )}
        </div>
      </div>

      {/* Machine-wise Stats Table */}
      <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            장비별 실적
          </h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">장비</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">생산량</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">목표</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">달성률</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">가동률</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">OEE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  로딩 중...
                </td>
              </tr>
            ) : stats.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  데이터가 없습니다
                </td>
              </tr>
            ) : (
              stats.map((stat) => (
                <tr key={stat.machineId} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    {stat.machineName}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {stat.totalParts.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-500">
                    {stat.targetParts.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PercentBadge value={stat.targetParts > 0 ? (stat.totalParts / stat.targetParts) * 100 : 0} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PercentBadge value={stat.availability} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PercentBadge value={stat.oee} highlight />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// KPI Card Component
function KPICard({
  title,
  value,
  unit,
  target,
  subtext,
  color,
}: {
  title: string;
  value: string;
  unit: string;
  target?: number;
  subtext?: string;
  color: 'blue' | 'green' | 'yellow' | 'red';
}) {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    red: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  };

  const textColors = {
    blue: 'text-blue-600 dark:text-blue-400',
    green: 'text-green-600 dark:text-green-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    red: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className={`p-4 rounded-lg border ${colors[color]}`}>
      <div className="text-sm text-gray-500 dark:text-gray-400">{title}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-3xl font-bold ${textColors[color]}`}>{value}</span>
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
      {target !== undefined && (
        <div className="mt-1 text-xs text-gray-500">
          목표: {target.toLocaleString()}
        </div>
      )}
      {subtext && (
        <div className="mt-1 text-xs text-gray-500">{subtext}</div>
      )}
    </div>
  );
}

// OEE Gauge Component
function OEEGauge({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  const getColor = (v: number) => {
    if (v >= 85) return 'bg-green-500';
    if (v >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className={highlight ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-500'}>
          {label}
        </span>
        <span className={highlight ? 'font-bold text-lg' : 'font-medium'}>
          {value.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
        <div
          className={`h-full ${getColor(value)} transition-all`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  );
}

// Percent Badge Component
function PercentBadge({ value, highlight }: { value: number; highlight?: boolean }) {
  const getColor = (v: number) => {
    if (v >= 100) return 'text-green-600 bg-green-100 dark:bg-green-900/30';
    if (v >= 85) return 'text-blue-600 bg-blue-100 dark:bg-blue-900/30';
    if (v >= 60) return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30';
    return 'text-red-600 bg-red-100 dark:bg-red-900/30';
  };

  return (
    <span className={`px-2 py-1 rounded text-sm font-medium ${getColor(value)} ${highlight ? 'font-bold' : ''}`}>
      {value.toFixed(1)}%
    </span>
  );
}

// Production Bar Chart (Simple CSS-based)
function ProductionBarChart({
  data,
  isLoading,
}: {
  data: ProductionChart[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return <div className="h-64 flex items-center justify-center text-gray-500">로딩 중...</div>;
  }

  if (data.length === 0) {
    return <div className="h-64 flex items-center justify-center text-gray-500">데이터 없음</div>;
  }

  const maxValue = Math.max(...data.map((d) => Math.max(d.production, d.target)));

  return (
    <div className="h-64">
      <div className="flex items-end justify-around h-48 gap-2">
        {data.map((item, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <div className="w-full flex items-end justify-center gap-1 h-40">
              {/* Production Bar */}
              <div
                className="w-1/3 bg-blue-500 rounded-t transition-all"
                style={{ height: `${(item.production / maxValue) * 100}%` }}
                title={`생산: ${item.production}`}
              />
              {/* Target Bar */}
              <div
                className="w-1/3 bg-gray-300 dark:bg-gray-600 rounded-t transition-all"
                style={{ height: `${(item.target / maxValue) * 100}%` }}
                title={`목표: ${item.target}`}
              />
            </div>
            <div className="text-xs text-gray-500 mt-2 truncate w-full text-center">
              {item.date}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-6 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-blue-500 rounded" />
          <span className="text-gray-600 dark:text-gray-400">생산량</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded" />
          <span className="text-gray-600 dark:text-gray-400">목표</span>
        </div>
      </div>
    </div>
  );
}
