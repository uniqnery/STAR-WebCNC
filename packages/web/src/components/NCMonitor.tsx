// NCMonitor - 실제 FANUC CNC 화면 레이아웃 공용 컴포넌트
// Scheduler, RemoteControl 좌측에서 동일하게 사용

import { useState } from 'react';
import { PathData, useMachineTelemetry, useControlLock } from '../stores/machineStore';
import { useCamerasForMachine, useCameraStore } from '../stores/cameraStore';
import { commandApi } from '../lib/api';
import { CameraMultiView } from './CameraMultiView';
import { OffsetView } from './ncmonitor/OffsetView';
import { CountView } from './ncmonitor/CountView';
import { ToolLifeView } from './ncmonitor/ToolLifeView';
import { ProgramListModal } from './ncmonitor/ProgramListModal';

export type MonitorTab = 'monitor' | 'camera' | 'offset' | 'count' | 'tool-life';

interface NCMonitorProps {
  path1?: PathData;
  path2?: PathData;
  machineMode?: string;
  mode?: string;
  machineId?: string;
  activeTab?: MonitorTab;
  onTabChange?: (tab: MonitorTab) => void;
  hideTabs?: boolean;
}

export const TABS: { id: MonitorTab; label: string }[] = [
  { id: 'monitor', label: '모니터' },
  { id: 'camera', label: '카메라' },
  { id: 'offset', label: 'OFFSET' },
  { id: 'count', label: 'COUNT' },
  { id: 'tool-life', label: 'TOOL-LIFE' },
];

export function NCMonitor({ path1, path2, machineMode, mode, machineId, activeTab: externalTab, onTabChange, hideTabs }: NCMonitorProps) {
  const [internalTab, setInternalTab] = useState<MonitorTab>('monitor');
  const activeTab = externalTab ?? internalTab;
  const setActiveTab = (tab: MonitorTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };
  const cameraEnabled = useCameraStore((s) => s.cameraEnabled);
  const camerasForMachine = useCamerasForMachine(machineId || '');

  return (
    <div className="bg-gray-900 rounded-lg shadow overflow-hidden flex flex-col">
      <div className="relative">
        {/* MonitorView — 항상 렌더하여 컨테이너 높이 기준 결정 */}
        <div className={activeTab === 'monitor' ? '' : 'invisible pointer-events-none'}>
          <MonitorView path1={path1} path2={path2} machineMode={machineMode} mode={mode} machineId={machineId} />
        </div>
        {/* 비모니터 탭 — MonitorView 위에 절대 위치 오버레이 */}
        {activeTab !== 'monitor' && (
          <div className="absolute inset-0 overflow-hidden">
            {activeTab === 'camera' && (
              cameraEnabled && camerasForMachine.length > 0 ? (
                <CameraMultiView cameras={camerasForMachine} className="h-full" />
              ) : (
                <PlaceholderView title="카메라" description="카메라 옵션 추가 시 실시간 화면이 표시됩니다" />
              )
            )}
            {activeTab === 'offset' && <OffsetView machineId={machineId} />}
            {activeTab === 'count' && <CountView machineId={machineId} />}
            {activeTab === 'tool-life' && <ToolLifeView machineId={machineId} />}
          </div>
        )}
      </div>

      {!hideTabs && (
        <div className="flex border-t border-gray-700 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 모니터 뷰
// ============================================================
const DEFAULT_AXES = ['X', 'Y', 'Z', 'C'];

// 프로그램 내용 라인 색상:
//   O번호 라인 → active=cyan, inactive=white
//   > 현재위치 라인 → active=cyan bold, inactive=gray bold
//   일반 라인 → green
function programLineClass(line: string, isActive: boolean): string {
  const core = line.startsWith('>') ? line.slice(1).trimStart() : line.trimStart();
  if (/^O\d+/i.test(core)) {
    return `font-bold ${isActive ? 'text-cyan-300' : 'text-white'}`;
  }
  if (line.startsWith('>')) {
    return `font-bold ${isActive ? 'text-cyan-300' : 'text-gray-300'}`;
  }
  return 'text-green-400';
}

function MonitorView({
  path1, path2, machineMode, mode, machineId,
}: {
  path1?: PathData;
  path2?: PathData;
  machineMode?: string;
  mode?: string;
  machineId?: string;
}) {
  const [showList,   setShowList]   = useState(false);
  const [mdiInput,   setMdiInput]   = useState('');
  const [mdiConfirm, setMdiConfirm] = useState(false);
  const [mdiSending, setMdiSending] = useState(false);

  const controlLock = useControlLock(machineId ?? '');
  const telemetry   = useMachineTelemetry(machineId ?? '');
  const pmcBits     = telemetry?.pmcBits ?? {};

  // G63.0: HEAD SELECT 키로 제어되는 CNC 표시 계통 (0=PATH1, 1=PATH2)
  const activePath: 1 | 2 = pmcBits['G63.0'] === 1 ? 2 : 1;

  const isOwner = controlLock?.isOwner ?? false;
  const rawMode = (mode ?? '').toUpperCase();
  const isEdit  = rawMode.includes('EDIT');
  const isMdi   = rawMode.includes('MDI');

  const listEnabled  = isEdit && isOwner;
  const inputEnabled = isMdi  && isOwner;

  const sendMdi = async () => {
    if (!machineId || !mdiInput.trim()) return;
    setMdiSending(true);
    setMdiConfirm(false);
    try {
      await commandApi.sendAndWait(machineId, 'WRITE_MDI', { program: mdiInput.trim(), path: activePath }, 10_000);
      setMdiInput('');
    } finally {
      setMdiSending(false);
    }
  };

  const formatPos = (val?: number, decimalPlaces?: number) => {
    if (val === undefined) return '0.000';
    const dp = (decimalPlaces && decimalPlaces > 0) ? decimalPlaces : 3;
    return (val / Math.pow(10, dp)).toFixed(dp);
  };

  const axes1 = (path1?.axisNames && path1.axisNames.length > 0) ? path1.axisNames : DEFAULT_AXES;
  const axes2 = (path2?.axisNames && path2.axisNames.length > 0) ? path2.axisNames : DEFAULT_AXES;

  // MDI 모드에서만 비활성 계통을 흐릿하게 표시
  const dimInactive = isMdi;
  const p1Dim = dimInactive && activePath !== 1;
  const p2Dim = dimInactive && activePath !== 2;

  return (
    <div className="flex flex-col">

      {/* NC 데이터 영역 */}
      <div className="text-green-400 font-mono text-xs p-2 max-lg:landscape:p-1 space-y-0">

        {/* 헤더 2분할: 좌=모드+PATH1 O/N | 우=PATH2 O/N */}
        <div className="grid grid-cols-2 gap-0 mb-1 max-lg:landscape:mb-0.5">
          <div className="flex items-center justify-between pr-1">
            <span className="text-cyan-300 text-[10px] max-lg:text-xs truncate min-w-0">
              {machineMode || 'PROGRAM( CHECK )'}
            </span>
            <span className={`text-sm max-lg:text-xs font-bold tabular-nums shrink-0 ml-1 transition-opacity ${
              activePath === 1 ? 'text-cyan-300' : p1Dim ? 'text-white opacity-40' : 'text-white'
            }`}>
              {path1?.programNo || 'O0000'} {path1?.blockNo || 'N00000'}
            </span>
          </div>
          <div className="flex items-center justify-end">
            <span className={`text-sm max-lg:text-xs font-bold tabular-nums transition-opacity ${
              activePath === 2 ? 'text-cyan-300' : p2Dim ? 'text-white opacity-40' : 'text-white'
            }`}>
              {path2?.programNo || 'O0000'} {path2?.blockNo || 'N00000'}
            </span>
          </div>
        </div>

        {/* PATH1 / PATH2 프로그램 표시 */}
        <div className="grid grid-cols-2 gap-0 border border-gray-700">
          <div className="border-r border-gray-700">
            <div className={`bg-gray-800 px-2 py-0.5 flex max-lg:text-xs transition-opacity ${p1Dim ? 'opacity-40' : ''}`}>
              <span className={activePath === 1 ? 'text-cyan-300 font-bold' : 'text-gray-400'}>
                PATH1{activePath === 1 ? ' ▶' : ''}
              </span>
            </div>
            <div className="px-2 max-lg:landscape:px-1 py-1 max-lg:landscape:py-0.5 h-40 max-lg:landscape:h-20 overflow-hidden max-lg:text-xs max-lg:landscape:text-[10px]">
              {path1?.programContent?.map((line, i) => (
                <div key={i} className={programLineClass(line, activePath === 1)}>
                  {line || ' '}
                </div>
              )) || <div className="text-gray-600">-</div>}
            </div>
          </div>
          <div>
            <div className={`bg-gray-800 px-2 py-0.5 flex max-lg:text-xs transition-opacity ${p2Dim ? 'opacity-40' : ''}`}>
              <span className={activePath === 2 ? 'text-cyan-300 font-bold' : 'text-gray-400'}>
                PATH2{activePath === 2 ? ' ▶' : ''}
              </span>
            </div>
            <div className="px-2 max-lg:landscape:px-1 py-1 max-lg:landscape:py-0.5 h-40 max-lg:landscape:h-20 overflow-hidden max-lg:text-xs max-lg:landscape:text-[10px]">
              {path2?.programContent?.map((line, i) => (
                <div key={i} className={programLineClass(line, activePath === 2)}>
                  {line || ' '}
                </div>
              )) || <div className="text-gray-600">-</div>}
            </div>
          </div>
        </div>

        {/* 좌표: ABSOLUTE / DIST TO GO (Path1 | Path2) */}
        <div className="grid grid-cols-2 gap-0 border border-gray-700 border-t-0">
          <div className="border-r border-gray-700">
            <div className={`grid grid-cols-2 transition-opacity ${p1Dim ? 'opacity-40' : ''}`}>
              <div className="border-r border-gray-700">
                <div className="bg-gray-800 px-2 max-lg:px-1.5 h-6 max-lg:h-5 max-lg:landscape:h-4 flex items-center justify-center text-[10px] max-lg:text-xs max-lg:landscape:text-[9px] text-cyan-300">ABSOLUTE</div>
                {axes1.map((axis, i) => (
                  <div key={`p1a-${axis}`} className="flex justify-between items-center px-2 max-lg:px-1.5 h-6 max-lg:h-5 max-lg:landscape:h-4 max-lg:leading-none max-lg:text-xs max-lg:landscape:text-[10px]">
                    <span className="text-cyan-300">{axis}</span>
                    <span className="text-white">{formatPos(path1?.coordinates?.absolute[i], path1?.coordinates?.decimalPlaces?.[i])}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="bg-gray-800 px-2 max-lg:px-1.5 h-6 max-lg:h-5 max-lg:landscape:h-4 flex items-center justify-center text-[10px] max-lg:text-xs max-lg:landscape:text-[9px] text-cyan-300">DIST TO GO</div>
                {axes1.map((axis, i) => (
                  <div key={`p1d-${axis}`} className="flex justify-between items-center px-2 max-lg:px-1.5 h-6 max-lg:h-5 max-lg:landscape:h-4 max-lg:leading-none max-lg:text-xs max-lg:landscape:text-[10px]">
                    <span className="text-cyan-300">{axis}</span>
                    <span className="text-yellow-300">{formatPos(path1?.coordinates?.distanceToGo[i], path1?.coordinates?.decimalPlaces?.[i])}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className={`transition-opacity ${p2Dim ? 'opacity-40' : ''}`}>
            <div className="grid grid-cols-2">
              <div className="border-r border-gray-700">
                <div className="bg-gray-800 px-2 max-lg:px-1.5 h-6 max-lg:h-5 max-lg:landscape:h-4 flex items-center justify-center text-[10px] max-lg:text-xs max-lg:landscape:text-[9px] text-cyan-300">ABSOLUTE</div>
                {axes2.map((axis, i) => (
                  <div key={`p2a-${axis}`} className="flex justify-between items-center px-2 max-lg:px-1.5 h-6 max-lg:h-5 max-lg:landscape:h-4 max-lg:leading-none max-lg:text-xs max-lg:landscape:text-[10px]">
                    <span className="text-cyan-300">{axis}</span>
                    <span className="text-white">{formatPos(path2?.coordinates?.absolute[i], path2?.coordinates?.decimalPlaces?.[i])}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="bg-gray-800 px-2 max-lg:px-1.5 h-6 max-lg:h-5 max-lg:landscape:h-4 flex items-center justify-center text-[10px] max-lg:text-xs max-lg:landscape:text-[9px] text-cyan-300">DIST TO GO</div>
                {axes2.map((axis, i) => (
                  <div key={`p2d-${axis}`} className="flex justify-between items-center px-2 max-lg:px-1.5 h-6 max-lg:h-5 max-lg:landscape:h-4 max-lg:leading-none max-lg:text-xs max-lg:landscape:text-[10px]">
                    <span className="text-cyan-300">{axis}</span>
                    <span className="text-yellow-300">{formatPos(path2?.coordinates?.distanceToGo[i], path2?.coordinates?.decimalPlaces?.[i])}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Feed / Spindle */}
        <div className="grid grid-cols-2 gap-0 border border-gray-700 border-t-0">
          <div className="border-r border-gray-700">
            <div className={`px-2 max-lg:landscape:px-1 py-1 max-lg:landscape:py-0.5 text-[10px] max-lg:text-xs max-lg:landscape:text-[9px] space-y-0.5 max-lg:landscape:space-y-0 transition-opacity ${p1Dim ? 'opacity-40' : ''}`}>
              <div className="flex justify-between text-gray-400">
                <span>F</span>
                <span>{path1?.modal?.feedActual ?? 0} MM/MIN</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>S1</span>
                <span className="text-white">{path1?.modal?.spindleActual ?? 0} /MIN</span>
              </div>
            </div>
          </div>
          <div className={`px-2 max-lg:landscape:px-1 py-1 max-lg:landscape:py-0.5 text-[10px] max-lg:text-xs max-lg:landscape:text-[9px] space-y-0.5 max-lg:landscape:space-y-0 transition-opacity ${p2Dim ? 'opacity-40' : ''}`}>
            <div className="flex justify-between text-gray-400">
              <span>F</span>
              <span>{path2?.modal?.feedActual ?? 0} MM/MIN</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>S2</span>
              <span className="text-white">{path2?.modal?.spindleActual ?? 0} /MIN</span>
            </div>
          </div>
        </div>

        {/* Path 상태바 */}
        <div className="grid grid-cols-2 gap-0 border border-gray-700 border-t-0">
          <div className="border-r border-gray-700">
            <div className={`bg-gray-800 px-2 max-lg:landscape:px-1 py-1 max-lg:landscape:py-0.5 text-[10px] max-lg:text-xs max-lg:landscape:text-[9px] text-green-400 transition-opacity ${p1Dim ? 'opacity-40' : ''}`}>
              {path1?.pathStatus || '---- ---- ---- ---'}
            </div>
          </div>
          <div className={`bg-gray-800 px-2 max-lg:landscape:px-1 py-1 max-lg:landscape:py-0.5 text-[10px] max-lg:text-xs max-lg:landscape:text-[9px] text-green-400 transition-opacity ${p2Dim ? 'opacity-40' : ''}`}>
            {path2?.pathStatus || '---- ---- ---- ---'}
          </div>
        </div>

      </div>
      {/* ↑ NC 데이터 영역 끝 */}

      {/* LIST / MDI 입력 바 — shrink-0으로 항상 하단 고정 */}
      <div className="shrink-0 border-t border-gray-700 bg-gray-800 px-2 max-lg:landscape:px-1 py-1.5 max-lg:landscape:py-0.5">
        <div className="flex items-center">
          <div className="flex items-center gap-2 flex-1">
            <button
              disabled={!listEnabled}
              onClick={() => setShowList(true)}
              title={!isOwner ? '제어권 필요' : !isEdit ? 'EDIT 모드에서 사용 가능' : 'CNC 프로그램 목록'}
              className={`px-2.5 py-0.5 text-[10px] max-lg:text-xs font-semibold rounded transition-colors ${
                listEnabled
                  ? 'bg-cyan-700 text-white hover:bg-cyan-600'
                  : 'bg-gray-700 text-gray-500 opacity-30 cursor-not-allowed'
              }`}
            >
              LIST
            </button>
          </div>
          <div className="flex items-center gap-1.5 w-1/2">
            <input
              type="text"
              value={mdiInput}
              onChange={(e) => setMdiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputEnabled && mdiInput.trim()) setMdiConfirm(true);
              }}
              disabled={!inputEnabled}
              placeholder=""
              className="flex-1 min-w-0 bg-gray-700 border border-gray-600 focus:border-blue-500 text-white placeholder:text-gray-600 text-[11px] max-lg:text-xs font-mono px-2 py-0.5 rounded outline-none disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <button
              disabled={!inputEnabled || mdiSending}
              onClick={() => { if (mdiInput.trim()) setMdiConfirm(true); }}
              title={!isOwner ? '제어권 필요' : !isMdi ? 'MDI 모드에서 사용 가능' : !mdiInput.trim() ? 'MDI 내용을 입력하세요' : 'MDI 버퍼에 기록'}
              className={`shrink-0 px-2.5 py-0.5 text-[10px] max-lg:text-xs font-semibold rounded transition-colors ${
                !inputEnabled || mdiSending
                  ? 'bg-gray-700 text-gray-500 opacity-30 cursor-not-allowed'
                  : 'bg-blue-700 text-white hover:bg-blue-600'
              }`}
            >
              {mdiSending ? '...' : 'INPUT'}
            </button>
          </div>
        </div>
      </div>

      {/* LIST 팝업 */}
      {showList && machineId && (
        <ProgramListModal
          machineId={machineId}
          activePath={activePath}
          onClose={() => setShowList(false)}
        />
      )}

      {/* MDI 확인 다이얼로그 */}
      {mdiConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 border border-yellow-600 rounded-lg p-5 w-80 shadow-2xl">
            <div className="text-yellow-400 font-bold text-sm max-lg:text-xs mb-2">MDI 지령 확인</div>
            <div className="text-gray-300 text-xs mb-1">다음 내용을 MDI 버퍼에 기록합니다:</div>
            <pre className="bg-gray-800 rounded p-2 text-green-300 text-xs font-mono mb-4 whitespace-pre-wrap break-all">
              {mdiInput.trim().replace(/;/g, '\n')}
            </pre>
            <div className="text-gray-500 text-[10px] max-lg:text-xs mb-4">
              ※ 사이클 스타트는 별도 조작반에서 실행하세요.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setMdiConfirm(false)}
                className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
              >
                취소
              </button>
              <button
                onClick={() => void sendMdi()}
                className="px-3 py-1 text-xs bg-yellow-600 text-white rounded hover:bg-yellow-500 font-bold"
              >
                기록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Placeholder 뷰
// ============================================================
function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500">
      <div className="text-lg font-bold text-gray-400 mb-2">{title}</div>
      <div className="text-sm max-lg:text-xs text-gray-600">{description}</div>
    </div>
  );
}
