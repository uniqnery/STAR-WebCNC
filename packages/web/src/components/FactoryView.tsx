// FactoryView Component - 공장 평면도 레이아웃

import { useState, useRef } from 'react';
import { Machine } from '../stores/machineStore';
import { useLayoutStore, LayoutItem, LayoutItemType, ITEM_DEFAULTS } from '../stores/layoutStore';
import { useAuthStore } from '../stores/authStore';
import { getStatusFromTelemetry, getStatusColorHex } from '../lib/machineUtils';
import { ZOOM } from '../lib/constants';
import { MachineStatusCard } from './CardView';

interface FactoryViewProps {
  machines: Machine[];
  onSelectMachine: (machineId: string) => void;
  selectedMachineId: string | null;
}

export function FactoryView({ machines, onSelectMachine }: FactoryViewProps) {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'ADMIN';

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
  } = useLayoutStore();

  // 팝업 모달 상태
  const [popupMachine, setPopupMachine] = useState<Machine | null>(null);

  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Zoom & Pan state for mobile
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState({ x: 0, y: 0 });
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);

  // 장비 상태 색상
  const getMachineColor = (machineId?: string) => {
    if (!machineId) return '#6B7280';
    const machine = machines.find((m) => m.machineId === machineId);
    if (!machine) return '#6B7280';

    const telemetry = machine.realtime?.telemetry;
    const isOnline = machine.realtime?.status === 'online';
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
    e.stopPropagation();
    const item = layout.items.find((i) => i.id === itemId);
    if (!item) return;

    const coords = getSVGCoords(e);
    setDragOffset({ x: coords.x - item.x, y: coords.y - item.y });
    setDraggedItem(itemId);
    selectItem(itemId);
  };

  // 드래그 중
  const handleDrag = (e: React.MouseEvent) => {
    if (!draggedItem || !isEditMode) return;
    const coords = getSVGCoords(e);
    moveItem(draggedItem, Math.round(coords.x - dragOffset.x), Math.round(coords.y - dragOffset.y));
  };

  // 드래그 종료
  const handleDragEnd = () => {
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
    addItem({
      type,
      label: defaults.label,
      x: 400,
      y: 200,
      width: defaults.width,
      height: defaults.height,
      rotation: 0,
      color: defaults.color,
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
            // 장비 클릭 시 팝업 모달 표시
            const machine = machines.find((m) => m.machineId === item.machineId);
            if (machine) {
              setPopupMachine(machine);
            }
            onSelectMachine(item.machineId);
          }
        }}
        onMouseDown={(e) => handleDragStart(e, item.id)}
        className={isEditMode ? 'cursor-move' : (item.machineId ? 'cursor-pointer' : '')}
      >
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
        {item.type === 'corridor' ? (
          // 통로 - 노란색 줄무늬 패턴
          <>
            <rect
              x="0"
              y="0"
              width={item.width}
              height={item.height}
              fill="#FEF3C7"
              fillOpacity="0.5"
              stroke="#F59E0B"
              strokeWidth="1"
              strokeDasharray="5,5"
              rx="2"
            />
          </>
        ) : item.type === 'door' ? (
          // 출입구 - 문 스타일
          <>
            <rect
              x="0"
              y="0"
              width={item.width}
              height={item.height}
              fill={item.color || '#E5E7EB'}
              stroke="#9CA3AF"
              strokeWidth="2"
              rx="2"
            />
            {/* 문 표시선 */}
            <line
              x1={item.width * 0.3}
              y1="0"
              x2={item.width * 0.3}
              y2={item.height}
              stroke="#6B7280"
              strokeWidth="1"
            />
          </>
        ) : (
          <rect
            x="0"
            y="0"
            width={item.width}
            height={item.height}
            fill={color}
            rx={item.type === 'machine' ? 4 : 2}
            className="transition-colors duration-300"
          />
        )}

        {/* 라벨 */}
        <text
          x={item.width / 2}
          y={item.height / 2 + 4}
          textAnchor="middle"
          fontSize={item.type === 'machine' ? 12 : 10}
          fill="white"
          fontWeight={item.type === 'machine' ? 'bold' : 'normal'}
        >
          {item.label}
        </text>

        {/* 장비 추가 디테일 */}
        {item.type === 'machine' && (
          <>
            <rect
              x={item.width * 0.1}
              y={item.height * 0.15}
              width={item.width * 0.8}
              height={item.height * 0.5}
              fill="rgba(255,255,255,0.15)"
              rx="2"
            />
            <circle
              cx={item.width / 2}
              cy={item.height * 0.4}
              r={Math.min(item.width, item.height) * 0.15}
              fill="rgba(0,0,0,0.3)"
            />
          </>
        )}
      </g>
    );
  };

  return (
    <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4">
      {/* 범례 */}
      <div className="flex items-center justify-between mb-4">
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

        {/* 관리자 편집 버튼 */}
        {isAdmin && (
          <button
            onClick={() => setEditMode(!isEditMode)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              isEditMode
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {isEditMode ? '편집 완료' : '레이아웃 편집'}
          </button>
        )}
      </div>

      {/* 공장 평면도 */}
      <div
        ref={containerRef}
        className="relative overflow-hidden touch-none"
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
          className="w-full bg-white dark:bg-gray-800 rounded-lg shadow-inner"
          style={{
            minHeight: '350px',
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

        {/* 편집 패널 - 오른쪽 하단 */}
        {isEditMode && (
          <div className="absolute bottom-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 w-64 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">레이아웃 편집</h3>

            {/* 레이아웃 크기 설정 */}
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-2">레이아웃 크기</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400">너비</label>
                  <input
                    type="number"
                    value={layout.width}
                    onChange={(e) => resizeLayout(parseInt(e.target.value) || 400, layout.height)}
                    className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    step="50"
                    min="400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">높이</label>
                  <input
                    type="number"
                    value={layout.height}
                    onChange={(e) => resizeLayout(layout.width, parseInt(e.target.value) || 300)}
                    className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    step="50"
                    min="300"
                  />
                </div>
              </div>
            </div>

            {/* 아이템 추가 */}
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-2">요소 추가</p>
              <div className="grid grid-cols-3 gap-1">
                {(['corridor', 'door', 'conveyor', 'robot', 'table', 'pillar', 'wall', 'custom'] as LayoutItemType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => handleAddItem(type)}
                    className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    {ITEM_DEFAULTS[type].label}
                  </button>
                ))}
              </div>
            </div>

            {/* 선택된 아이템 속성 */}
            {selectedItemId && (() => {
              const item = layout.items.find((i) => i.id === selectedItemId);
              if (!item) return null;

              return (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                  <p className="text-xs text-gray-500 mb-2">선택된 요소: {item.label}</p>

                  {/* 라벨 수정 */}
                  <div className="mb-2">
                    <label className="text-xs text-gray-500">라벨</label>
                    <input
                      type="text"
                      value={item.label}
                      onChange={(e) => updateItem(item.id, { label: e.target.value })}
                      className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>

                  {/* 크기 조절 */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-xs text-gray-500">너비</label>
                      <input
                        type="number"
                        value={item.width}
                        onChange={(e) => updateItem(item.id, { width: parseInt(e.target.value) || 50 })}
                        className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">높이</label>
                      <input
                        type="number"
                        value={item.height}
                        onChange={(e) => updateItem(item.id, { height: parseInt(e.target.value) || 50 })}
                        className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                      />
                    </div>
                  </div>

                  {/* 회전 */}
                  <div className="mb-2">
                    <label className="text-xs text-gray-500">회전 (도)</label>
                    <input
                      type="number"
                      value={item.rotation}
                      onChange={(e) => updateItem(item.id, { rotation: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                      step="15"
                    />
                  </div>

                  {/* 색상 (장비 외) */}
                  {item.type !== 'machine' && (
                    <div className="mb-2">
                      <label className="text-xs text-gray-500">색상</label>
                      <input
                        type="color"
                        value={item.color || ITEM_DEFAULTS[item.type].color}
                        onChange={(e) => updateItem(item.id, { color: e.target.value })}
                        className="w-full h-8 border rounded cursor-pointer"
                      />
                    </div>
                  )}

                  {/* 삭제 버튼 (장비 외) */}
                  {item.type !== 'machine' && (
                    <button
                      onClick={() => removeItem(item.id)}
                      className="w-full mt-2 px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      삭제
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* 장비 상세 팝업 모달 */}
      {popupMachine && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setPopupMachine(null)}
        >
          <div
            className="relative max-w-sm w-full mx-4 animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 닫기 버튼 */}
            <button
              onClick={() => setPopupMachine(null)}
              className="absolute -top-3 -right-3 z-10 w-8 h-8 bg-white dark:bg-gray-700 rounded-full shadow-lg
                       flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* MachineStatusCard 팝업 */}
            <MachineStatusCard machine={popupMachine} />
          </div>
        </div>
      )}
    </div>
  );
}
