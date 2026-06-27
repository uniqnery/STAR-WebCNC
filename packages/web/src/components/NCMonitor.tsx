// NCMonitor - 실제 FANUC CNC 화면 레이아웃 공용 컴포넌트
// Scheduler, RemoteControl 좌측에서 동일하게 사용

import { useState } from 'react';
import { PathData, useMachineTelemetry, useControlLock } from '../stores/machineStore';
import { useTemplateStore } from '../stores/templateStore';
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
  machineMode?: string;  // PROGRAM( CHECK ), PROGRAM( MEM ) 등
  mode?: string;         // 원시 CNC 모드 문자열 (EDIT, MDI, MEM 등)
  machineId?: string;    // 카메라 매핑용
  /** 외부에서 탭 상태를 제어할 때 사용. 없으면 내부 상태로 동작 */
  activeTab?: MonitorTab;
  onTabChange?: (tab: MonitorTab) => void;
  /** true 시 하단 탭 바 숨김 (탭 바를 외부에서 별도 렌더링할 때) */
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
    <div className="bg-gray-900 rounded-lg shadow overflow-hidden flex flex-col h-full">
      {/* 탭 콘텐츠 — h-full 컨테이너 내에서 flex-1, 자식 뷰가 자체 스크롤 관리 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'monitor' && (
          <MonitorView path1={path1} path2={path2} machineMode={machineMode} mode={mode} machineId={machineId} />
        )}
        {activeTab === 'camera' && (
          cameraEnabled && camerasForMachine.length > 0 ? (
            <CameraMultiView cameras={camerasForMachine} className="h-full" />
          ) : (
            <PlaceholderView title="카메라" description="카메라 옵션 추가 시 실시간 화면이 표시됩니다" />
          )
        )}
        {activeTab === 'offset' && (
          <OffsetView machineId={machineId} />
        )}
        {activeTab === 'count' && (
          <CountView machineId={machineId} />
        )}
        {activeTab === 'tool-life' && (
          <ToolLifeView machineId={machineId} />
        )}
      </div>

      {/* 하단 탭 선택 (hideTabs=true 시 숨김) */}
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
// 모니터 뷰 (실제 NC 화면 레이아웃)
// ============================================================
const DEFAULT_AXES = ['X', 'Y', 'Z', 'C'];

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

  // 제어권 + PMC
  const controlLock = useControlLock(machineId ?? '');
  const telemetry   = useMachineTelemetry(machineId ?? '');
  const pmcBits     = telemetry?.pmcBits ?? {};

  // panelLayout에서 HEAD1/HEAD2 lampAddr 조회
  const selectedTemplate = useTemplateStore(
    (s) => s.templates.find((t) => t.id === s.selectedTemplateId) ?? null
  );
  const allKeys  = selectedTemplate?.panelLayout?.flatMap((g) => g.keys) ?? [];
  const head1Addr = allKeys.find((k) => k.id === 'HEAD1')?.lampAddr ?? '';
  const head2Addr = allKeys.find((k) => k.id === 'HEAD2')?.lampAddr ?? '';

  // HEAD2 lamp ON이고 HEAD1 lamp OFF이면 PATH2, 아니면 PATH1
  const head2On = head2Addr !== '' && pmcBits[head2Addr] === 1;
  const head1On = head1Addr !== '' && pmcBits[head1Addr] === 1;
  const activePath: 1 | 2 = (head2On && !head1On) ? 2 : 1;

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
      await commandApi.sendAndWait(machineId, 'WRITE_MDI', { program: mdiInput.trim() }, 10_000);
      setMdiInput('');
    } finally {
      setMdiSending(false);
    }
  };

  // decimalPlaces: IS-B=3→/1000, IS-C=4→/10000. 0이면 기본값 3
  const formatPos = (val?: number, decimalPlaces?: number) => {
    if (val === undefined) return '0.000';
    const dp = (decimalPlaces && decimalPlaces > 0) ? decimalPlaces : 3;
    return (val / Math.pow(10, dp)).toFixed(dp);
  };

  const axes1 = (path1?.axisNames && path1.axisNames.length > 0) ? path1.axisNames : DEFAULT_AXES;
  const axes2 = (path2?.axisNames && path2.axisNames.length > 0) ? path2.axisNames : DEFAULT_AXES;

  return (
    <>
      <div className="text-green-400 font-mono text-xs p-2 space-y-0">

        {/* 상단 헤더 3분할: 좌=모드 | 중=PATH1 프로그램 | 우=PATH2 프로그램 */}
        <div className="flex items-center justify-between text-cyan-300 mb-1 gap-1">
          <span className="text-[10px] max-lg:text-xs flex-1 min-w-0 truncate">
            {machineMode || 'PROGRAM( CHECK )'}
          </span>
          <span className="text-white text-sm font-bold flex-none tabular-nums">
            {path1?.programNo || 'O0000'} {path1?.blockNo || 'N00000'}
          </span>
          <span className="text-yellow-300 text-sm font-bold flex-none tabular-nums">
            {path2?.programNo || 'O0000'} {path2?.blockNo || 'N00000'}
          </span>
        </div>

        {/* PATH1 / PATH2 프로그램 표시 */}
        <div className="grid grid-cols-2 gap-0 border border-gray-700">
          {/* PATH1 */}
          <div className="border-r border-gray-700">
            <div className="bg-gray-800 px-2 py-0.5 flex justify-between max-lg:text-xs">
              <span className={activePath === 1 ? 'text-cyan-300 font-bold' : 'text-gray-400'}>
                PATH1{activePath === 1 ? ' ▶' : ''}
              </span>
              <span className="text-white">{path1?.programNo || '-'} {path1?.blockNo || ''}</span>
            </div>
            <div className="px-2 py-1 h-40 overflow-hidden max-lg:text-sm">
              {path1?.programContent?.map((line, i) => (
                <div key={i} className={line.startsWith('>') ? 'text-cyan-300 font-bold' : 'text-green-400'}>
                  {line || ' '}
                </div>
              )) || <div className="text-gray-600">-</div>}
            </div>
          </div>
          {/* PATH2 */}
          <div>
            <div className="bg-gray-800 px-2 py-0.5 flex justify-between max-lg:text-xs">
              <span className={activePath === 2 ? 'text-yellow-300 font-bold' : 'text-gray-400'}>
                PATH2{activePath === 2 ? ' ▶' : ''}
              </span>
              <span className="text-white">{path2?.programNo || '-'} {path2?.blockNo || ''}</span>
            </div>
            <div className="px-2 py-1 h-40 overflow-hidden max-lg:text-sm">
              {path2?.programContent?.map((line, i) => (
                <div key={i} className={line.startsWith('>') ? 'text-yellow-300 font-bold' : 'text-green-400'}>
                  {line || ' '}
                </div>
              )) || <div className="text-gray-600">-</div>}
            </div>
          </div>
        </div>

        {/* 좌표 표시: ABSOLUTE / DISTANCE TO GO (Path1 | Path2) */}
        <div className="grid grid-cols-2 gap-0 border border-gray-700 border-t-0">
          {/* PATH1 좌표 */}
          <div className="border-r border-gray-700">
            <div className="grid grid-cols-2">
              <div className="border-r border-gray-700">
                <div className="bg-gray-800 px-2 h-6 flex items-center justify-center text-[10px] max-lg:text-xs text-cyan-300">ABSOLUTE</div>
                {axes1.map((axis, i) => (
                  <div key={`p1a-${axis}`} className="flex justify-between items-center px-2 h-6 max-lg:text-xs">
                    <span className="text-cyan-300">{axis}</span>
                    <span className="text-white">{formatPos(path1?.coordinates?.absolute[i], path1?.coordinates?.decimalPlaces?.[i])}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="bg-gray-800 px-2 h-6 flex items-center justify-center text-[10px] max-lg:text-xs text-cyan-300">DIST TO GO</div>
                {axes1.map((axis, i) => (
                  <div key={`p1d-${axis}`} className="flex justify-between items-center px-2 h-6 max-lg:text-xs">
                    <span className="text-cyan-300">{axis}</span>
                    <span className="text-yellow-300">{formatPos(path1?.coordinates?.distanceToGo[i], path1?.coordinates?.decimalPlaces?.[i])}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* PATH2 좌표 */}
          <div>
            <div className="grid grid-cols-2">
              <div className="border-r border-gray-700">
                <div className="bg-gray-800 px-2 h-6 flex items-center justify-center text-[10px] max-lg:text-xs text-cyan-300">ABSOLUTE</div>
                {axes2.map((axis, i) => (
                  <div key={`p2a-${axis}`} className="flex justify-between items-center px-2 h-6 max-lg:text-xs">
                    <span className="text-cyan-300">{axis}</span>
                    <span className="text-white">{formatPos(path2?.coordinates?.absolute[i], path2?.coordinates?.decimalPlaces?.[i])}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="bg-gray-800 px-2 h-6 flex items-center justify-center text-[10px] max-lg:text-xs text-cyan-300">DIST TO GO</div>
                {axes2.map((axis, i) => (
                  <div key={`p2d-${axis}`} className="flex justify-between items-center px-2 h-6 max-lg:text-xs">
                    <span className="text-cyan-300">{axis}</span>
                    <span className="text-yellow-300">{formatPos(path2?.coordinates?.distanceToGo[i], path2?.coordinates?.decimalPlaces?.[i])}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Feed / Spindle 실속도 */}
        <div className="grid grid-cols-2 gap-0 border border-gray-700 border-t-0">
          <div className="px-2 py-1 text-[10px] border-r border-gray-700 space-y-0.5">
            <div className="flex justify-between text-gray-400">
              <span>F</span>
              <span>{path1?.modal?.feedActual ?? 0} MM/MIN</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>S1</span>
              <span className="text-white">{path1?.modal?.spindleActual ?? 0} /MIN</span>
            </div>
          </div>
          <div className="px-2 py-1 text-[10px] space-y-0.5">
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
          <div className="bg-gray-800 px-2 py-1 text-[10px] text-green-400 border-r border-gray-700">
            {path1?.pathStatus || '---- ---- ---- ---'}
          </div>
          <div className="bg-gray-800 px-2 py-1 text-[10px] text-green-400">
            {path2?.pathStatus || '---- ---- ---- ---'}
          </div>
        </div>

        {/* LIST / MDI 입력 행 */}
        <div className="flex items-center gap-1 border border-gray-700 border-t-0 px-1 py-1 min-h-[28px]">
          {/* [LIST] 좌측 끝 — EDIT 모드 + 제어권 시에만 활성 */}
          <button
            disabled={!listEnabled}
            onClick={() => setShowList(true)}
            title={!isOwner ? '제어권 필요' : !isEdit ? 'EDIT 모드에서 사용 가능' : 'CNC 프로그램 목록'}
            className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded border transition-colors ${
              listEnabled
                ? 'border-cyan-600 text-cyan-300 hover:bg-cyan-900/40 cursor-pointer'
                : 'border-gray-700 text-gray-600 cursor-not-allowed'
            }`}
          >
            LIST
          </button>

          {/* 우측 절반: MDI 입력창 + [INPUT] — 화면 50% 지점부터 시작 */}
          <div className="ml-auto flex items-center gap-1 w-1/2">
            <input
              type="text"
              value={mdiInput}
              onChange={(e) => setMdiInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inputEnabled && mdiInput.trim()) setMdiConfirm(true);
              }}
              disabled={!inputEnabled}
              placeholder={inputEnabled ? 'G0 X40.0 ; G0 X20.0' : 'MDI + 제어권 필요'}
              className={`flex-1 min-w-0 px-2 py-0.5 text-[10px] font-mono rounded border bg-gray-900 transition-colors ${
                inputEnabled
                  ? 'border-gray-500 text-green-300 placeholder:text-gray-600'
                  : 'border-gray-800 text-gray-700 placeholder:text-gray-800 cursor-not-allowed'
              }`}
            />
            <button
              disabled={!inputEnabled || !mdiInput.trim() || mdiSending}
              onClick={() => setMdiConfirm(true)}
              title={!isOwner ? '제어권 필요' : !isMdi ? 'MDI 모드에서 사용 가능' : 'MDI 버퍼에 기록'}
              className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded border transition-colors ${
                inputEnabled && mdiInput.trim() && !mdiSending
                  ? 'border-green-600 text-green-300 hover:bg-green-900/40 cursor-pointer'
                  : 'border-gray-700 text-gray-600 cursor-not-allowed'
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
            <div className="text-yellow-400 font-bold text-sm mb-2">MDI 지령 확인</div>
            <div className="text-gray-300 text-xs mb-1">다음 내용을 MDI 버퍼에 기록합니다:</div>
            <pre className="bg-gray-800 rounded p-2 text-green-300 text-xs font-mono mb-4 whitespace-pre-wrap break-all">
              {mdiInput.trim().replace(/;/g, '\n')}
            </pre>
            <div className="text-gray-500 text-[10px] mb-4">
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
    </>
  );
}


// ============================================================
// Placeholder 뷰 (카메라, OFFSET, COUNT, TOOL-LIFE)
// ============================================================
function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-500">
      <div className="text-lg font-bold text-gray-400 mb-2">{title}</div>
      <div className="text-sm text-gray-600">{description}</div>
    </div>
  );
}
