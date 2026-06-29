// Monitoring Page — NC모니터(좌) + 카메라(우) + 이벤트로그(하단) 3분할
// 리모트패널과 동일한 레이아웃 비율 적용

import { useState, useRef } from 'react';
import {
  useMachineStore, useMachineTelemetry, useMachineAlarms,
  useFocasEvents, type Alarm,
} from '../stores/machineStore';
import { useTemplateStore, type PmcMessageEntry } from '../stores/templateStore';
import { useCamerasForMachine, useCameraStore } from '../stores/cameraStore';
import { NCMonitor, TABS, type MonitorTab } from '../components/NCMonitor';
import { CameraMultiView } from '../components/CameraMultiView';
import { FocasEventLog } from '../components/FocasEventLog';
import { MachineTopBar } from '../components/MachineTopBar';

function AlarmStrip({ alarms, pmcMessages = [] }: { alarms: Alarm[]; pmcMessages?: PmcMessageEntry[] }) {
  const hasAlarms = alarms.length > 0;
  const hasMsgs   = pmcMessages.length > 0;
  const hasAny    = hasAlarms || hasMsgs;

  return (
    <div className={`h-full rounded-lg border px-3 py-2 flex flex-col gap-1 overflow-y-auto transition-colors ${
      hasAlarms ? 'bg-red-950/40 border-red-700/60' : hasMsgs ? 'bg-yellow-950/30 border-yellow-700/50' : 'bg-gray-900 border-gray-700'
    }`}>
      {hasAny ? (
        <>
          {alarms.map((a) => (
            <div key={a.id} className="flex items-start gap-2 min-w-0 shrink-0">
              <span className="shrink-0 text-[10px] font-bold text-red-400 leading-4 tabular-nums">
                {a.category ? `${a.category}` : 'ALM'} {a.alarmNo}
              </span>
              <span className="flex-1 text-[11px] text-red-200 leading-4 truncate">{a.alarmMsg}</span>
              <span className="shrink-0 text-[10px] text-red-500/70 leading-4 tabular-nums">
                {new Date(a.occurredAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))}
          {pmcMessages.map((m) => (
            <div key={m.id} className="flex items-start gap-2 min-w-0 shrink-0">
              <span className="shrink-0 text-[10px] font-bold text-yellow-500 leading-4">MSG</span>
              <span className="flex-1 text-[11px] text-yellow-200 leading-4 truncate">{m.message}</span>
            </div>
          ))}
        </>
      ) : (
        <p className="text-gray-600 text-xs text-center py-2 my-auto">알람 없음</p>
      )}
    </div>
  );
}

export function Monitoring() {
  const { selectedMachineId } = useMachineStore();
  const telemetry    = useMachineTelemetry(selectedMachineId || '');
  const activeAlarms = useMachineAlarms(selectedMachineId || '');
  const focasEvents  = useFocasEvents(selectedMachineId || '');

  const selectedTemplate = useTemplateStore(
    (s) => s.templates.find((t) => t.id === s.selectedTemplateId) ?? null,
  );
  const pmcBits = telemetry?.pmcBits ?? {};
  const activePmcMessages: PmcMessageEntry[] = (selectedTemplate?.pmcMessages ?? [])
    .filter((m) => m.pmcAddr && pmcBits[m.pmcAddr] === 1);

  const cameraEnabled      = useCameraStore((s) => s.cameraEnabled);
  const camerasForMachine  = useCamerasForMachine(selectedMachineId || '');

  const [monitorTab, setMonitorTab] = useState<MonitorTab>('monitor');
  const [mobileTab, setMobileTab]   = useState<'monitor' | 'camera'>('monitor');
  const MOBILE_TABS: ('monitor' | 'camera')[] = ['monitor', 'camera'];

  const swipeStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => { swipeStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (swipeStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    swipeStartX.current = null;
    if (Math.abs(dx) < 50) return;
    const idx = MOBILE_TABS.indexOf(mobileTab);
    if (dx < 0 && idx < MOBILE_TABS.length - 1) setMobileTab(MOBILE_TABS[idx + 1]);
    if (dx > 0 && idx > 0) setMobileTab(MOBILE_TABS[idx - 1]);
  };

  return (
    <div
      className="p-6 lg:p-4 space-y-4 lg:space-y-0 lg:gap-3 lg:h-full lg:flex lg:flex-col lg:overflow-hidden max-lg:landscape:p-1 max-lg:landscape:space-y-1 max-lg:landscape:pl-7"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <MachineTopBar pageId="monitoring" pageTitle="Monitoring" />

      {/* 모바일 portrait 탭 바 — PC/landscape 숨김 */}
      <div className="hidden max-lg:portrait:flex rounded-lg overflow-hidden border border-gray-700">
        {MOBILE_TABS.map((t) => (
          <button key={t} onClick={() => setMobileTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${mobileTab === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            {t === 'monitor' ? '모니터' : '카메라'}
          </button>
        ))}
      </div>

      {/* ── 상단 2분할: NC모니터(좌) + 카메라(우) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 max-lg:landscape:grid-cols-2 gap-4 lg:flex-1 lg:min-h-0">

        {/* 좌측: NC 모니터 + 알람 + 탭 바 */}
        <div className={`flex flex-col gap-2 overflow-hidden lg:h-full max-lg:portrait:h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-16rem)] max-lg:landscape:h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] lg:flex max-lg:landscape:flex ${mobileTab === 'monitor' ? 'max-lg:portrait:flex' : 'max-lg:portrait:hidden'}`}>
          <div className="flex-1 min-h-0 lg:flex-none lg:shrink-0">
            <NCMonitor
              path1={telemetry?.path1}
              path2={telemetry?.path2}
              machineMode={telemetry?.mode ? `PROGRAM( ${telemetry.mode} )` : undefined}
              mode={telemetry?.mode}
              machineId={selectedMachineId || undefined}
              activeTab={monitorTab}
              onTabChange={setMonitorTab}
              hideTabs
            />
          </div>
          <div className="shrink-0 h-24 lg:h-auto lg:flex-1 lg:min-h-0">
            <AlarmStrip alarms={activeAlarms} pmcMessages={activePmcMessages} />
          </div>
          {/* NC 탭 바 — 카메라 탭 제외 (우측 패널에 이미 표시) */}
          <div className="shrink-0 flex rounded-lg overflow-hidden border border-gray-700">
            {TABS.filter((tab) => tab.id !== 'camera').map((tab) => (
              <button key={tab.id} onClick={() => setMonitorTab(tab.id)}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  monitorTab === tab.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
          {/* 모바일 portrait 전용 이벤트 로그 */}
          <div className="lg:hidden landscape:hidden shrink-0 h-40 mt-1">
            <FocasEventLog events={focasEvents} />
          </div>
        </div>

        {/* 우측: 카메라 */}
        <div className={`flex flex-col lg:h-full max-lg:portrait:h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-16rem)] max-lg:landscape:h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem)] lg:flex max-lg:landscape:flex ${mobileTab === 'camera' ? 'max-lg:portrait:flex' : 'max-lg:portrait:hidden'}`}>
          {cameraEnabled && camerasForMachine.length > 0 ? (
            <CameraMultiView cameras={camerasForMachine} className="flex-1 min-h-0 rounded-lg overflow-hidden" />
          ) : (
            <div className="flex-1 min-h-0 rounded-lg bg-gray-900 border border-gray-700 flex flex-col items-center justify-center gap-3 text-gray-500">
              <svg className="w-12 h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.89L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              <p className="text-sm">카메라 미설정</p>
              <p className="text-xs text-gray-600">설정에서 카메라를 등록하세요</p>
            </div>
          )}
          {/* 모바일 portrait 전용 이벤트 로그 */}
          <div className="lg:hidden landscape:hidden shrink-0 h-40 mt-1">
            <FocasEventLog events={focasEvents} />
          </div>
        </div>

      </div>

      {/* ── 하단: 이벤트 로그 — PC/landscape 고정 h-40, 모바일 portrait 숨김 */}
      <div className="max-lg:portrait:hidden max-lg:landscape:h-40 max-lg:landscape:shrink-0 lg:shrink-0 lg:h-40">
        <FocasEventLog events={focasEvents} />
      </div>

    </div>
  );
}
