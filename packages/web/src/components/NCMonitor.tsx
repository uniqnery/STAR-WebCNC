// NCMonitor - 실제 FANUC CNC 화면 레이아웃 공용 컴포넌트
// Scheduler, RemoteControl 좌측에서 동일하게 사용

import { useState } from 'react';
import { PathData } from '../stores/machineStore';
import { useCameraForMachine, useCameraStore } from '../stores/cameraStore';
import { CameraStream } from './CameraStream';

export type MonitorTab = 'monitor' | 'camera' | 'offset' | 'count' | 'tool-life';

interface NCMonitorProps {
  path1?: PathData;
  path2?: PathData;
  machineMode?: string;  // PROGRAM( CHECK ), PROGRAM( MEM ) 등
  machineId?: string;    // 카메라 매핑용
}

const TABS: { id: MonitorTab; label: string }[] = [
  { id: 'monitor', label: '모니터' },
  { id: 'camera', label: '카메라' },
  { id: 'offset', label: 'OFFSET' },
  { id: 'count', label: 'COUNT' },
  { id: 'tool-life', label: 'TOOL-LIFE' },
];

export function NCMonitor({ path1, path2, machineMode, machineId }: NCMonitorProps) {
  const [activeTab, setActiveTab] = useState<MonitorTab>('monitor');
  const cameraEnabled = useCameraStore((s) => s.cameraEnabled);
  const cameraForMachine = useCameraForMachine(machineId || '');

  return (
    <div className="bg-gray-900 rounded-lg shadow overflow-hidden flex flex-col h-full">
      {/* 탭 콘텐츠 */}
      <div className="flex-1 min-h-0">
        {activeTab === 'monitor' && (
          <MonitorView path1={path1} path2={path2} machineMode={machineMode} />
        )}
        {activeTab === 'camera' && (
          cameraEnabled && machineId ? (
            <CameraStream camera={cameraForMachine} className="h-full" />
          ) : (
            <PlaceholderView title="카메라" description="카메라 옵션 추가 시 실시간 화면이 표시됩니다" />
          )
        )}
        {activeTab === 'offset' && (
          <PlaceholderView title="OFFSET" description="Path1 / Path2 Wear Offset (64개) 연동 예정" />
        )}
        {activeTab === 'count' && (
          <PlaceholderView title="COUNT" description="카운트 화면 실제 장비 연동 예정" />
        )}
        {activeTab === 'tool-life' && (
          <PlaceholderView title="TOOL-LIFE" description="공구 수명 카운트 실제 장비 연동 예정" />
        )}
      </div>

      {/* 하단 탭 선택 */}
      <div className="flex border-t border-gray-700">
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
    </div>
  );
}

// ============================================================
// 모니터 뷰 (실제 NC 화면 레이아웃)
// ============================================================
function MonitorView({ path1, path2, machineMode }: { path1?: PathData; path2?: PathData; machineMode?: string }) {
  const formatPos = (val?: number) => {
    if (val === undefined) return '0.000';
    return (val / 1000).toFixed(3);
  };

  const axes = ['X', 'Y', 'Z', 'C'];

  return (
    <div className="text-green-400 font-mono text-xs p-2 space-y-0">
      {/* 상단 모드 + 프로그램 번호 */}
      <div className="flex justify-between items-center text-cyan-300 mb-1">
        <span className="text-[10px]">{machineMode || 'PROGRAM( CHECK )'}</span>
        <span className="text-white text-sm font-bold">
          {path1?.programNo || 'O0000'} {path1?.blockNo || 'N00000'}
        </span>
      </div>

      {/* PATH1 / PATH2 프로그램 표시 */}
      <div className="grid grid-cols-2 gap-0 border border-gray-700">
        {/* PATH1 */}
        <div className="border-r border-gray-700">
          <div className="bg-gray-800 px-2 py-0.5 flex justify-between">
            <span className="text-cyan-300">PATH1</span>
            <span className="text-white">{path1?.programNo || '-'} {path1?.blockNo || ''}</span>
          </div>
          <div className="px-2 py-1 h-24 overflow-hidden">
            {path1?.programContent?.map((line, i) => (
              <div key={i} className={line.startsWith('>') ? 'text-cyan-300 font-bold' : 'text-green-400'}>
                {line || '\u00A0'}
              </div>
            )) || <div className="text-gray-600">-</div>}
          </div>
        </div>
        {/* PATH2 */}
        <div>
          <div className="bg-gray-800 px-2 py-0.5 flex justify-between">
            <span className="text-cyan-300">PATH2</span>
            <span className="text-white">{path2?.programNo || '-'} {path2?.blockNo || ''}</span>
          </div>
          <div className="px-2 py-1 h-24 overflow-hidden">
            {path2?.programContent?.map((line, i) => (
              <div key={i} className={line.startsWith('>') ? 'text-cyan-300 font-bold' : 'text-green-400'}>
                {line || '\u00A0'}
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
              <div className="bg-gray-800 px-2 py-0.5 text-center text-[10px] text-cyan-300">ABSOLUTE</div>
              {axes.map((axis, i) => (
                <div key={`p1a-${axis}`} className="flex justify-between px-2 py-0.5">
                  <span className="text-cyan-300">{axis}1</span>
                  <span className="text-white">{formatPos(path1?.coordinates?.absolute[i])}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="bg-gray-800 px-2 py-0.5 text-center text-[10px] text-cyan-300">DISTANCE TO GO</div>
              {axes.map((axis, i) => (
                <div key={`p1d-${axis}`} className="flex justify-between px-2 py-0.5">
                  <span className="text-cyan-300">{axis}1</span>
                  <span className="text-yellow-300">{formatPos(path1?.coordinates?.distanceToGo[i])}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* PATH2 좌표 */}
        <div>
          <div className="grid grid-cols-2">
            <div className="border-r border-gray-700">
              <div className="bg-gray-800 px-2 py-0.5 text-center text-[10px] text-cyan-300">ABSOLUTE</div>
              {axes.map((axis, i) => (
                <div key={`p2a-${axis}`} className="flex justify-between px-2 py-0.5">
                  <span className="text-cyan-300">{axis}2</span>
                  <span className="text-white">{formatPos(path2?.coordinates?.absolute[i])}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="bg-gray-800 px-2 py-0.5 text-center text-[10px] text-cyan-300">DISTANCE TO GO</div>
              {axes.map((axis, i) => (
                <div key={`p2d-${axis}`} className="flex justify-between px-2 py-0.5">
                  <span className="text-cyan-300">{axis}2</span>
                  <span className="text-yellow-300">{formatPos(path2?.coordinates?.distanceToGo[i])}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 모달 G코드 그리드 (Path1 | Path2) */}
      <div className="grid grid-cols-2 gap-0 border border-gray-700 border-t-0">
        <ModalGCodeGrid modal={path1?.modal} pathLabel="S1" />
        <ModalGCodeGrid modal={path2?.modal} pathLabel="S2" isRight />
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
    </div>
  );
}

// ============================================================
// 모달 G코드 그리드
// ============================================================
function ModalGCodeGrid({ modal, pathLabel, isRight }: {
  modal?: PathData['modal'];
  pathLabel: string;
  isRight?: boolean;
}) {
  const grid = modal?.gCodeGrid || [['','',''],['','',''],['','',''],['','',''],['','','']];

  return (
    <div className={`px-1 py-1 text-[10px] ${isRight ? '' : 'border-r border-gray-700'}`}>
      {grid.map((row, i) => (
        <div key={i} className="flex gap-1">
          <span className="w-8 text-green-400">{row[0]}</span>
          <span className="w-8 text-green-400">{row[1]}</span>
          <span className="w-10 text-green-400">{row[2]}</span>
          <span className="flex-1 text-right text-white">
            {i === 0 && <>F <span className="text-yellow-300">{modal?.fProgrammed ?? 0}</span> M <span className="text-white">{modal?.mCode ?? 0}</span></>}
            {i === 1 && <span className="text-gray-500">H</span>}
            {i === 2 && <span className="text-gray-500">D</span>}
            {i === 3 && <>T <span className="text-yellow-300">{modal?.tTool ?? 0}</span></>}
            {i === 4 && <>S <span className="text-yellow-300">{modal?.sProgrammed ?? 0}</span></>}
          </span>
        </div>
      ))}
      {/* Feed Actual + Repeat */}
      <div className="flex justify-between mt-0.5 text-gray-400">
        <span>F</span>
        <span>{modal?.feedActual ?? 0}MM/MIN</span>
        <span>REPEAT{modal?.repeatCurrent ?? 0}/{modal?.repeatTotal ?? 0}</span>
      </div>
      {/* Spindle Actual */}
      <div className="flex justify-between text-gray-400">
        <span>{pathLabel}</span>
        <span className="text-white">{modal?.spindleActual ?? 0}/MIN</span>
      </div>
    </div>
  );
}

// ============================================================
// Placeholder 뷰 (카메라, OFFSET, COUNT, TOOL-LIFE)
// ============================================================
function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-gray-500">
      <div className="text-lg font-bold text-gray-400 mb-2">{title}</div>
      <div className="text-sm text-gray-600">{description}</div>
    </div>
  );
}
