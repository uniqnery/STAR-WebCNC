// FactoryView Component - 공장 평면도 레이아웃

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Machine, useMachineStore } from '../stores/machineStore';
import { useLayoutStore, LayoutItem, LayoutItemType, ITEM_DEFAULTS, FactoryLayout } from '../stores/layoutStore';
import { getStatusFromTelemetry, getStatusColorHex } from '../lib/machineUtils';
import { ZOOM } from '../lib/constants';
import { MachineStatusCard } from './CardView';

interface FactoryViewProps {
  machines: Machine[];
  onSelectMachine: (machineId: string) => void;
  selectedMachineId: string | null;
}

export function FactoryView({ machines, onSelectMachine, selectedMachineId }: FactoryViewProps) {
  const telemetryMap = useMachineStore((s) => s.telemetryMap);

  const {
    layout,
    isEditMode,
    selectedItemId,
    setEditMode,
    selectItem,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    resizeLayout,
    setLayout,
    bringForward,
    sendBackward,
    loadFromServer,
    saveToServer,
  } = useLayoutStore();

  // 마운트 시 서버에서 레이아웃 로드 (모든 기기 공유)
  useEffect(() => {
    loadFromServer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 선택된 장비 (좌측 패널)
  const selectedMachine = machines.find((m) => m.machineId === selectedMachineId) ?? null;

  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Zoom & Pan state for mobile
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);

  // 편집 팝업 상태
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [layoutSnapshot, setLayoutSnapshot] = useState<FactoryLayout | null>(null);
  const [editPanelPos, setEditPanelPos] = useState({ x: 80, y: 80 });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [panelDragOffset, setPanelDragOffset] = useState({ x: 0, y: 0 });

  // 팝업 드래그 마우스 이벤트
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingPanel) return;
      setEditPanelPos({ x: e.clientX - panelDragOffset.x, y: e.clientY - panelDragOffset.y });
    };
    const onUp = () => setIsDraggingPanel(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDraggingPanel, panelDragOffset]);

  // 편집 버튼 클릭
  const handleEditToggle = () => {
    if (!isEditMode) {
      setLayoutSnapshot(JSON.parse(JSON.stringify(layout)));
      setEditMode(true);
    }
    // 팝업 초기 위치: 캔버스 좌측 중앙
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setEditPanelPos({ x: rect.right - 304, y: rect.top + 16 });
    }
    setShowEditPanel(true);
  };

  // 저장
  const handleEditSave = () => {
    setEditMode(false);
    setShowEditPanel(false);
    selectItem(null);
    setLayoutSnapshot(null);
    void saveToServer();
  };

  // 취소
  const handleEditCancel = () => {
    if (layoutSnapshot) setLayout(layoutSnapshot);
    setEditMode(false);
    setShowEditPanel(false);
    selectItem(null);
    setLayoutSnapshot(null);
  };

  // 팝업 타이틀바 드래그 시작
  const handlePanelDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingPanel(true);
    setPanelDragOffset({ x: e.clientX - editPanelPos.x, y: e.clientY - editPanelPos.y });
  };

  // hydration 완료 후 machineId 없는 machine 타입 아이템 정리
  useEffect(() => {
    const unsub = useLayoutStore.persist.onFinishHydration((state) => {
      const broken = state.layout.items.filter((i) => i.type === 'machine' && !i.machineId);
      if (broken.length > 0) {
        setLayout({
          ...state.layout,
          items: state.layout.items.filter((i) => !(i.type === 'machine' && !i.machineId)),
          updatedAt: new Date().toISOString(),
        });
      }
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 장비 상태 색상
  const getMachineColor = (machineId?: string) => {
    if (!machineId) return '#6B7280';
    const machine = machines.find((m) => m.machineId === machineId);
    if (!machine) return '#6B7280';

    const telemetry = telemetryMap[machine.machineId] ?? machine.realtime?.telemetry;
    const isOnline = telemetryMap[machine.machineId] != null || machine.realtime?.status === 'online';
    const status = getStatusFromTelemetry(telemetry, isOnline);
    return getStatusColorHex(status);
  };

  // SVG 좌표 계산
  const getSVGCoords = (e: React.MouseEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: svgP.x, y: svgP.y };
  };

  // 드래그 시작
  const handleDragStart = (e: React.MouseEvent, itemId: string) => {
    if (!isEditMode) return;
    if (draggingRef.current) return; // 이미 드래그 중이면 무시
    e.stopPropagation();
    const item = layout.items.find((i) => i.id === itemId);
    if (!item) return;

    draggingRef.current = true;
    const coords = getSVGCoords(e);
    setDragOffset({ x: coords.x - item.x, y: coords.y - item.y });
    setDraggedItem(itemId);
    selectItem(itemId);
  };

  // 드래그 중
  const handleDrag = (e: React.MouseEvent) => {
    if (!draggedItem || !isEditMode || !draggingRef.current) return;
    const coords = getSVGCoords(e);
    moveItem(draggedItem, Math.round(coords.x - dragOffset.x), Math.round(coords.y - dragOffset.y));
  };

  // 드래그 종료
  const handleDragEnd = () => {
    draggingRef.current = false;
    setDraggedItem(null);
  };

  // 핀치 줌 거리 계산
  const getPinchDistance = (touches: React.TouchList) => {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );
  };

  // 터치 시작
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isEditMode) return;

    if (e.touches.length === 2) {
      // 핀치 줌 시작
      setLastPinchDistance(getPinchDistance(e.touches));
    } else if (e.touches.length === 1) {
      // 팬 시작
      setIsPanning(true);
      setLastPanPoint({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    }
  };

  // 터치 이동
  const handleTouchMove = (e: React.TouchEvent) => {
    if (isEditMode) return;

    if (e.touches.length === 2 && lastPinchDistance !== null) {
      // 핀치 줌
      e.preventDefault();
      const newDistance = getPinchDistance(e.touches);
      const delta = newDistance / lastPinchDistance;
      const newScale = Math.min(Math.max(scale * delta, ZOOM.MIN), ZOOM.MAX);
      setScale(newScale);
      setLastPinchDistance(newDistance);
    } else if (e.touches.length === 1 && isPanning) {
      // 팬
      const deltaX = e.touches[0].clientX - lastPanPoint.x;
      const deltaY = e.touches[0].clientY - lastPanPoint.y;
      setTranslate((prev) => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
      setLastPanPoint({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    }
  };

  // 터치 종료
  const handleTouchEnd = () => {
    setIsPanning(false);
    setLastPinchDistance(null);
  };

  // 줌 리셋
  const handleResetZoom = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  // 줌 인/아웃 버튼
  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev * ZOOM.STEP, ZOOM.MAX));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev / ZOOM.STEP, ZOOM.MIN));
  };

  // 아이템 추가
  const handleAddItem = (type: LayoutItemType) => {
    const defaults = ITEM_DEFAULTS[type];
    const last = useLayoutStore.getState().lastSettings[type] ?? {};
    addItem({
      type,
      label: defaults.label,
      x: 400,
      y: 200,
      width:      last.width      ?? defaults.width,
      height:     last.height     ?? defaults.height,
      rotation:   last.rotation   ?? 0,
      color:      last.color      ?? defaults.color,
      opacity:    last.opacity,
      fontSize:   last.fontSize,
      labelAlign: last.labelAlign,
    });
  };

  // 아이템 렌더링
  const renderItem = (item: LayoutItem) => {
    const isSelected = item.id === selectedItemId;
    const isMachine = item.type === 'machine';
    const color = isMachine ? getMachineColor(item.machineId) : (item.color || ITEM_DEFAULTS[item.type].color);

    return (
      <g
        key={item.id}
        transform={`translate(${item.x}, ${item.y}) rotate(${item.rotation}, ${item.width / 2}, ${item.height / 2})`}
        onClick={(e) => {
          e.stopPropagation();
          if (isEditMode) {
            selectItem(item.id);
          } else if (item.machineId) {
            onSelectMachine(item.machineId);
          }
        }}
        onMouseDown={(e) => handleDragStart(e, item.id)}
        className={isEditMode ? 'cursor-move' : (item.machineId ? 'cursor-pointer' : '')}
        style={draggedItem && draggedItem !== item.id ? { pointerEvents: 'none' } : undefined}
      >
        {/* 클릭/드래그 히트 영역 (항상 전체 영역 커버) */}
        <rect x="0" y="0" width={item.width} height={item.height} fill="transparent" />

        {/* 선택 하이라이트 */}
        {isSelected && isEditMode && (
          <rect
            x="-5"
            y="-5"
            width={item.width + 10}
            height={item.height + 10}
            fill="none"
            stroke="#3B82F6"
            strokeWidth="2"
            strokeDasharray="5,5"
            className="animate-pulse"
          />
        )}

        {/* 아이템 본체 */}
        {item.type === 'machine' ? (() => {
          const W = item.width;
          const H = item.height;
          // ── 도면 비율 그대로 ──
          // 좌: 0~41%  중: 41~58%  우: 58~100%
          const L = W * 0.41;                    // 좌측 끝 x
          const cX = L; const cW = W * 0.17;    // 중앙 세로루버
          const rX = cX + cW;                    // 우측 시작 x
          const rW = W - rX;
          const sw = 1;                          // 기본 선 굵기
          const bd = '#555';                     // 선 기본색
          // 세로 루버 수
          const clN = Math.max(5, Math.round(cW * 0.72 / 5));
          // 우측 단일 패널: 하단 정렬
          const panelH = H * 0.40 * 1.2;        // 기존 하단 높이 × 1.2
          const panelY = H - panelH - 3;         // 하단 정렬
          return (
            <>
              {/* ═══ 메인 몸체 ═══ */}
              <rect x="0" y="0" width={W} height={H}
                fill={color} stroke={bd} strokeWidth={sw + 0.5} rx="3"
                className="transition-colors duration-300" />

              {/* ═══ 좌측 섹션 ═══ */}
              {/* 좌측 내부 테두리 */}
              <rect x="3" y="3" width={L - 5} height={H - 6}
                fill="rgba(255,255,255,0.10)" stroke="rgba(0,0,0,0.30)" strokeWidth={sw} rx="2" />

              {/* 환기구 — 세로 2열 × 가로 5행 (얇은 슬롯) */}
              {(() => {
                const colW = (L - 20) / 2 - 2;
                const colGap = 4;
                const col0X = 8;
                const col1X = col0X + colW + colGap;
                const slotH = H * 0.025;
                const slotGap = H * 0.035;
                const startY = H * 0.06;
                return [0, 1].map((col) => (
                  Array.from({ length: 5 }).map((_, row) => (
                    <rect key={`lv${col}-${row}`}
                      x={col === 0 ? col0X : col1X}
                      y={startY + row * (slotH + slotGap)}
                      width={colW} height={slotH}
                      fill="rgba(0,0,0,0.35)" rx="0.5" />
                  ))
                ));
              })()}

              {/* 좌측 하단 도어 패널 */}
              <rect x="6" y={H * 0.30} width={L - 9} height={H * 0.63}
                fill="rgba(0,0,0,0.08)" stroke="rgba(0,0,0,0.32)" strokeWidth={sw} rx="2" />
              {/* 도어 패널 내부 프레임 */}
              <rect x="10" y={H * 0.34} width={L - 17} height={H * 0.55}
                fill="none" stroke="rgba(0,0,0,0.20)" strokeWidth="0.8" rx="1" />

              {/* 컨트롤 박스 (좌측 패널 내 가운데 정렬) */}
              <rect x={(L - L * 0.78) / 2} y={H * 0.82} width={L * 0.78} height={H * 0.15}
                fill="rgba(0,0,0,0.22)" stroke="rgba(0,0,0,0.40)" strokeWidth={sw} rx="2" />

              {/* ═══ 중앙 세로 루버 ═══ */}
              <rect x={cX} y="0" width={cW} height={H}
                fill="rgba(0,0,0,0.12)" stroke="rgba(0,0,0,0.30)" strokeWidth={sw} />
              {/* 세로 슬롯 */}
              {Array.from({ length: clN }).map((_, i) => {
                const gap = cW / clN;
                return (
                  <rect key={`cl${i}`}
                    x={cX + i * gap + gap * 0.15} y={H * 0.06}
                    width={gap * 0.60} height={H * 0.80}
                    fill="rgba(0,0,0,0.32)" rx="1" />
                );
              })}
              {/* 중앙 하단 소형 디테일 */}
              <rect x={cX + cW * 0.2} y={H * 0.90} width={cW * 0.6} height={H * 0.06}
                fill="rgba(0,0,0,0.30)" rx="1" />

              {/* ═══ 우측 섹션 ═══ */}
              {/* 우측 내부 테두리 */}
              <rect x={rX + 2} y="3" width={rW - 5} height={H - 6}
                fill="rgba(255,255,255,0.08)" stroke="rgba(0,0,0,0.28)" strokeWidth={sw} rx="2" />

              {/* 우측 단일 패널 (상단 제거, 하단을 위로 1.2배 확장) */}
              <rect x={rX + 5} y={panelY} width={rW - 10} height={panelH}
                fill="rgba(0,0,0,0.10)" stroke="rgba(0,0,0,0.30)" strokeWidth={sw} rx="2" />
              <rect x={rX + 10} y={panelY + H * 0.04} width={rW - 20} height={panelH - H * 0.08}
                fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="0.8" rx="1" />

              {/* ═══ 라벨 ═══ */}
              {(() => {
                const align = item.labelAlign ?? 'middle';
                const lx = align === 'start' ? 6 : align === 'end' ? W - 6 : W * 0.5;
                const ty = H * 0.50;
                return (
                  <text x={lx} y={ty}
                    textAnchor={align}
                    fontSize={item.fontSize ?? Math.max(9, Math.min(16, H * 0.20))}
                    fill="white" fontWeight="bold"
                    transform={`rotate(${-item.rotation}, ${W / 2}, ${H / 2})`}
                    style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.8))' }}>
                    {item.label}
                  </text>
                );
              })()}
            </>
          );
        })() : item.type === 'barfeeder' ? (() => {
          const bfColor = item.color || '#374151';
          return (
            <>
              <rect x="0" y="0" width={item.width} height={item.height}
                fill={bfColor} stroke="rgba(0,0,0,0.4)" strokeWidth="1" rx="3" />
              {/* 가이드 채널 (수평 줄무늬) */}
              {Array.from({ length: Math.max(2, Math.round(item.height / 10)) }).map((_, i) => (
                <rect key={`bf-${i}`}
                  x="6" y={3 + i * ((item.height - 5) / Math.max(2, Math.round(item.height / 10)))}
                  width={item.width - 12} height={(item.height - 5) / (Math.max(2, Math.round(item.height / 10)) * 1.4)}
                  fill="rgba(0,0,0,0.20)" rx="1" />
              ))}
              {/* 피더 헤드 (우측, 장비 연결 방향) */}
              <rect x={item.width - 8} y="2" width="6" height={item.height - 4}
                fill="rgba(0,0,0,0.25)" rx="2" />
              {/* 바피더 라벨 */}
              {(() => {
                const align = item.labelAlign ?? 'middle';
                const lx = align === 'start' ? 8 : align === 'end' ? item.width - 12 : item.width * 0.45;
                return (
                  <text x={lx} y={item.height / 2 + 3}
                    textAnchor={align}
                    fontSize={item.fontSize ?? Math.max(7, Math.min(9, item.height * 0.38))}
                    fill="rgba(255,255,255,0.8)"
                    transform={`rotate(${-item.rotation}, ${item.width / 2}, ${item.height / 2})`}>
                    {item.label}
                  </text>
                );
              })()}
            </>
          );
        })() : item.type === 'circle' ? (() => {
          const cx = item.width / 2;
          const cy = item.height / 2;
          const rx = item.width / 2;
          const ry = item.height / 2;
          const fillColor = item.color || '#10B981';
          const fillOpacity = item.opacity !== undefined ? item.opacity / 100 : 1;
          const fs = item.fontSize ?? Math.max(8, Math.min(14, item.width * 0.18));
          return (
            <>
              <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
                fill={fillColor} fillOpacity={fillOpacity}
                stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
              {item.label && (() => {
                const align = item.labelAlign ?? 'middle';
                const lx = align === 'start' ? 4 : align === 'end' ? item.width - 4 : cx;
                return (
                  <text x={lx} y={cy + fs * 0.35}
                    textAnchor={align} fontSize={fs}
                    fill="white" fontWeight="500"
                    transform={`rotate(${-item.rotation}, ${cx}, ${cy})`}
                    style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
                    {item.label}
                  </text>
                );
              })()}
            </>
          );
        })() : (
          // rect (기본 — 사각형)
          (() => {
            const fillColor = item.color || '#3B82F6';
            const fillOpacity = item.opacity !== undefined ? item.opacity / 100 : 1;
            const fs = item.fontSize ?? Math.max(8, Math.min(14, item.width * 0.14));
            return (
              <>
                <rect x="0" y="0" width={item.width} height={item.height}
                  fill={fillColor} fillOpacity={fillOpacity}
                  stroke="rgba(0,0,0,0.20)" strokeWidth="1" rx="3" />
                {item.label && (() => {
                  const align = item.labelAlign ?? 'middle';
                  const lx = align === 'start' ? 6 : align === 'end' ? item.width - 6 : item.width / 2;
                  return (
                    <text x={lx} y={item.height / 2 + fs * 0.35}
                      textAnchor={align} fontSize={fs}
                      fill="white" fontWeight="500"
                      transform={`rotate(${-item.rotation}, ${item.width / 2}, ${item.height / 2})`}
                      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
                      {item.label}
                    </text>
                  );
                })()}
              </>
            );
          })()
        )}
      </g>
    );
  };

  return (
    <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 flex flex-col gap-3 h-full">
      {/* 상단: 범례 + 편집 버튼 */}
      <div className="shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-emerald-500" />
            <span className="text-gray-600 dark:text-gray-400">가동중</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-slate-400" />
            <span className="text-gray-600 dark:text-gray-400">대기</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-rose-500" />
            <span className="text-gray-600 dark:text-gray-400">알람</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded bg-gray-600" />
            <span className="text-gray-600 dark:text-gray-400">오프라인</span>
          </div>
        </div>

        {/* 레이아웃 편집 버튼 */}
        <button
          onClick={handleEditToggle}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            isEditMode
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          레이아웃 편집
        </button>
      </div>

      {/* 본문: 좌측 장비 패널 + 우측 캔버스 */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* 좌측: 선택된 장비 상세 (전체 폭의 1/4) */}
        <div className="basis-1/4 shrink-0 flex flex-col gap-3 overflow-y-auto min-w-0">
          {selectedMachine ? (
            <>
              <MachineStatusCard machine={selectedMachine} />
              <FactoryQuickActions machine={selectedMachine} />
              <div className="flex-1" />
            </>
          ) : (
            <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-400 text-sm text-center">
              레이아웃에서<br />장비를 클릭하세요
            </div>
          )}
        </div>

        {/* 우측: 캔버스 (h-full로 채우고 SVG viewBox가 내부 비율 처리) */}
        <div className="flex-1 min-w-0 h-full">
          <div
            ref={containerRef}
            className="relative overflow-hidden touch-none h-full"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
        {/* 줌 컨트롤 버튼 (모바일 & 데스크톱) */}
        {!isEditMode && (
          <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
            <button
              onClick={handleZoomIn}
              className="w-8 h-8 bg-white dark:bg-gray-700 rounded-lg shadow flex items-center justify-center
                       text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
              title="확대"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
            <button
              onClick={handleZoomOut}
              className="w-8 h-8 bg-white dark:bg-gray-700 rounded-lg shadow flex items-center justify-center
                       text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
              title="축소"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <button
              onClick={handleResetZoom}
              className="w-8 h-8 bg-white dark:bg-gray-700 rounded-lg shadow flex items-center justify-center
                       text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 text-xs font-bold"
              title="초기화"
            >
              1:1
            </button>
          </div>
        )}

        {/* 현재 줌 레벨 표시 */}
        {scale !== 1 && !isEditMode && (
          <div className="absolute top-2 right-2 z-10 px-2 py-1 bg-black/50 text-white text-xs rounded">
            {Math.round(scale * 100)}%
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full bg-white dark:bg-gray-800 rounded-lg shadow-inner"
          style={{
            transform: isEditMode ? 'none' : `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
            transformOrigin: 'center center',
            transition: isPanning || lastPinchDistance ? 'none' : 'transform 0.1s ease-out',
          }}
          onMouseMove={handleDrag}
          onMouseUp={handleDragEnd}
          onMouseLeave={handleDragEnd}
          onClick={() => isEditMode && selectItem(null)}
        >
          {/* 배경 그리드 */}
          <defs>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path
                d="M 50 0 L 0 0 0 50"
                fill="none"
                stroke="#E5E7EB"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* 공장 외벽 */}
          <rect
            x="20"
            y="20"
            width={layout.width - 40}
            height={layout.height - 40}
            fill="none"
            stroke="#9CA3AF"
            strokeWidth="3"
            rx="4"
          />

          {/* 레이아웃 아이템들 */}
          {layout.items.map(renderItem)}
        </svg>

          </div>
        </div>
      </div>

      {/* 레이아웃 편집 팝업 (fixed, 드래그 가능) */}
      {isEditMode && showEditPanel && (
        <div
          className="fixed z-50 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 select-none"
          style={{ left: editPanelPos.x, top: editPanelPos.y }}
        >
          {/* 타이틀 바 (드래그 핸들) */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700 rounded-t-xl border-b border-gray-200 dark:border-gray-600 cursor-move"
            onMouseDown={handlePanelDragStart}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-white">
              <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              레이아웃 편집
            </div>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowEditPanel(false)}
              className="w-6 h-6 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 편집 내용 */}
          <div className="p-4 max-h-[60vh] overflow-y-auto space-y-4">
            {/* 레이아웃 크기 */}
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">레이아웃 크기</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400">너비</label>
                  <input
                    type="number"
                    value={layout.width}
                    onChange={(e) => resizeLayout(parseInt(e.target.value) || layout.width, layout.height)}
                    className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    step="50"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">높이</label>
                  <input
                    type="number"
                    value={layout.height}
                    onChange={(e) => resizeLayout(layout.width, parseInt(e.target.value) || layout.height)}
                    className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    step="50"
                  />
                </div>
              </div>
            </div>

            {/* 요소 추가 */}
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">요소 추가</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleAddItem('rect')}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg>
                  사각형
                </button>
                <button
                  onClick={() => handleAddItem('circle')}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/></svg>
                  원형
                </button>
                <button
                  onClick={() => handleAddItem('machine')}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.5"/><rect x="11" y="5" width="4" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.2"/></svg>
                  본체
                </button>
                <button
                  onClick={() => handleAddItem('barfeeder')}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><rect x="1" y="5" width="14" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/><line x1="4" y1="5" x2="4" y2="11" stroke="currentColor" strokeWidth="1"/><line x1="7" y1="5" x2="7" y2="11" stroke="currentColor" strokeWidth="1"/><line x1="10" y1="5" x2="10" y2="11" stroke="currentColor" strokeWidth="1"/></svg>
                  바피더
                </button>
              </div>
            </div>

            {/* 선택된 아이템 속성 */}
            {selectedItemId && (() => {
              const item = layout.items.find((i) => i.id === selectedItemId);
              if (!item) return null;
              const isCustomShape = item.type === 'rect' || item.type === 'circle';
              const defaultColor = ITEM_DEFAULTS[item.type]?.color ?? '#6B7280';
              return (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    선택: {item.label || `(${item.type})`}
                  </p>

                  {/* 라벨 + 글씨 크기 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className="text-xs text-gray-500">라벨</label>
                      <input type="text" value={item.label}
                        onChange={(e) => updateItem(item.id, { label: e.target.value })}
                        className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">글씨 크기</label>
                      <input type="number"
                        value={item.fontSize ?? Math.round(Math.max(9, Math.min(16, item.height * 0.20)))}
                        onChange={(e) => updateItem(item.id, { fontSize: parseInt(e.target.value) || 12 })}
                        className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">정렬</label>
                      <div className="flex gap-1 mt-0.5">
                        {(['start', 'middle', 'end'] as const).map((a) => (
                          <button key={a}
                            onClick={() => updateItem(item.id, { labelAlign: a })}
                            className={`flex-1 py-1 text-xs rounded border transition-colors ${
                              (item.labelAlign ?? 'middle') === a
                                ? 'bg-blue-500 text-white border-blue-500'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}>
                            {a === 'start' ? '좌' : a === 'middle' ? '중' : '우'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 너비 + 높이 */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500">너비</label>
                      <input type="number" value={item.width}
                        onChange={(e) => updateItem(item.id, { width: parseInt(e.target.value) || item.width })}
                        className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">높이</label>
                      <input type="number" value={item.height}
                        onChange={(e) => updateItem(item.id, { height: parseInt(e.target.value) || item.height })}
                        className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                    </div>
                  </div>

                  {/* 회전 */}
                  <div>
                    <label className="text-xs text-gray-500">회전 (도)</label>
                    <input type="number" value={item.rotation} step="15"
                      onChange={(e) => updateItem(item.id, { rotation: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                  </div>

                  {/* 색상 + 투명도 (사용자 정의 도형만) */}
                  {isCustomShape && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">색상</label>
                        <input type="color" value={item.color || defaultColor}
                          onChange={(e) => updateItem(item.id, { color: e.target.value })}
                          className="w-full h-8 border rounded cursor-pointer" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">투명도 (%)</label>
                        <input type="number" min="0" max="100"
                          value={item.opacity !== undefined ? item.opacity : 100}
                          onChange={(e) => updateItem(item.id, { opacity: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)) })}
                          className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
                      </div>
                    </div>
                  )}

                  {/* 바피더 색상 */}
                  {item.type === 'barfeeder' && (
                    <div>
                      <label className="text-xs text-gray-500">색상</label>
                      <input type="color" value={item.color || defaultColor}
                        onChange={(e) => updateItem(item.id, { color: e.target.value })}
                        className="w-full h-8 border rounded cursor-pointer" />
                    </div>
                  )}

                  {/* 앞으로/뒤로 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => bringForward(item.id)}
                      className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">
                      앞으로
                    </button>
                    <button onClick={() => sendBackward(item.id)}
                      className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300">
                      뒤로
                    </button>
                  </div>

                  <button onClick={() => removeItem(item.id)}
                    className="w-full px-3 py-1.5 text-xs bg-red-500 text-white rounded hover:bg-red-600">
                    삭제
                  </button>
                </div>
              );
            })()}
          </div>

          {/* 저장 / 취소 */}
          <div className="flex gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-600 rounded-b-xl">
            <button
              onClick={handleEditSave}
              className="flex-1 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              저장
            </button>
            <button
              onClick={handleEditCancel}
              className="flex-1 px-3 py-2 text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// 좌측 패널 Quick Action 버튼 (바로가기 3개)
function FactoryQuickActions({ machine }: { machine: Machine }) {
  const navigate = useNavigate();
  const { selectMachine } = useMachineStore();

  const handleAction = (path: string) => {
    selectMachine(machine.machineId);
    navigate(path);
  };

  return (
    <div className="grid grid-cols-3 gap-2">
      <button
        onClick={() => handleAction('/remote')}
        className="flex flex-col items-center gap-1 px-2 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
        </svg>
        원격제어
      </button>
      <button
        onClick={() => handleAction('/scheduler')}
        className="flex flex-col items-center gap-1 px-2 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
        스케줄러
      </button>
      <button
        onClick={() => handleAction('/transfer')}
        className="flex flex-col items-center gap-1 px-2 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        파일전송
      </button>
    </div>
  );
}
