// Machine Detail Component

import { useMachineStore, useMachineTelemetry, useMachineAlarms } from '../stores/machineStore';
import { getRunStateText } from '../lib/machineUtils';
import { RUN_STATE } from '../lib/constants';

interface MachineDetailProps {
  machineId: string;
}

export function MachineDetail({ machineId }: MachineDetailProps) {
  const machines = useMachineStore((state) => state.machines);
  const machine = machines.find((m) => m.machineId === machineId);
  const telemetry = useMachineTelemetry(machineId);
  const alarms = useMachineAlarms(machineId);

  if (!machine) {
    return (
      <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-8 text-center text-gray-500">
        장비를 찾을 수 없습니다
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
        <h3 className="font-semibold text-gray-900 dark:text-white">
          {machine.name}
        </h3>
        <p className="text-sm text-gray-500">
          {machine.template?.cncType} {machine.template?.seriesName}
        </p>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Status */}
        <Section title="운전 상태">
          {telemetry ? (
            <div className="grid grid-cols-2 gap-3">
              <InfoItem label="모드" value={telemetry.mode} />
              <InfoItem
                label="상태"
                value={getRunStateText(telemetry.runState)}
                valueClass={telemetry.runState === RUN_STATE.START ? 'text-green-600' : ''}
              />
              <InfoItem label="프로그램" value={telemetry.programNo || '-'} />
              <InfoItem
                label="알람"
                value={telemetry.alarmActive ? '발생' : '없음'}
                valueClass={telemetry.alarmActive ? 'text-red-600 font-bold' : 'text-green-600'}
              />
            </div>
          ) : (
            <div className="text-center text-gray-500 py-4">오프라인</div>
          )}
        </Section>

        {/* Spindle & Feed */}
        <Section title="스핀들 / 이송">
          {telemetry ? (
            <div className="grid grid-cols-2 gap-3">
              <InfoItem
                label="스핀들 속도"
                value={`${telemetry.spindleSpeed} rpm`}
              />
              <InfoItem
                label="이송 속도"
                value={`${telemetry.feedrate} mm/min`}
              />
            </div>
          ) : (
            <div className="text-center text-gray-500 py-4">-</div>
          )}
        </Section>

        {/* Position */}
        <Section title="좌표 (절대)">
          {telemetry?.absolutePosition ? (
            <div className="grid grid-cols-4 gap-2 font-mono text-sm">
              {['X', 'Y', 'Z', 'A'].map((axis, i) => (
                <div key={axis} className="text-center">
                  <div className="text-gray-500 text-xs">{axis}</div>
                  <div className="text-gray-900 dark:text-white">
                    {formatPosition(telemetry.absolutePosition?.[i])}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-4">-</div>
          )}
        </Section>

        {/* Parts Count */}
        <Section title="생산 현황">
          <div className="text-center">
            <div className="text-4xl font-bold text-blue-600">
              {telemetry?.partsCount ?? '-'}
            </div>
            <div className="text-sm text-gray-500">가공 수량</div>
          </div>
        </Section>

        {/* Active Alarms */}
        {alarms.length > 0 && (
          <Section title="활성 알람">
            <div className="space-y-2">
              {alarms.map((alarm) => (
                <div
                  key={alarm.id}
                  className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm"
                >
                  <span className="text-red-600 font-bold">#{alarm.alarmNo}</span>
                  <span className="text-red-800 dark:text-red-300">
                    {alarm.alarmMsg}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Connection Info */}
        <Section title="연결 정보">
          <div className="text-sm text-gray-500 space-y-1">
            <div className="flex justify-between">
              <span>IP</span>
              <span className="font-mono">{machine.ipAddress}</span>
            </div>
            <div className="flex justify-between">
              <span>Port</span>
              <span className="font-mono">{machine.port}</span>
            </div>
            <div className="flex justify-between">
              <span>템플릿</span>
              <span className="font-mono">{machine.template?.templateId}</span>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

function InfoItem({
  label,
  value,
  valueClass = '',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-700 rounded p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`font-semibold text-gray-900 dark:text-white ${valueClass}`}>
        {value}
      </div>
    </div>
  );
}

function formatPosition(value?: number): string {
  if (value === undefined || value === null) return '-';
  return (value / 1000).toFixed(3);
}
