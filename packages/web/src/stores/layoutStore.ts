// Layout Store - 공장 레이아웃 관리

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 배치 가능한 요소 타입
export type LayoutItemType = 'machine' | 'barfeeder' | 'conveyor' | 'robot' | 'table' | 'pillar' | 'wall' | 'door' | 'corridor' | 'custom';

export interface LayoutItem {
  id: string;
  type: LayoutItemType;
  machineId?: string; // machine 타입일 경우 연결된 장비 ID
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color?: string;
}

export interface FactoryLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  items: LayoutItem[];
  createdAt: string;
  updatedAt: string;
}

interface LayoutState {
  layout: FactoryLayout;
  isEditMode: boolean;
  selectedItemId: string | null;

  // Actions
  setEditMode: (enabled: boolean) => void;
  selectItem: (itemId: string | null) => void;
  addItem: (item: Omit<LayoutItem, 'id'>) => void;
  updateItem: (itemId: string, updates: Partial<LayoutItem>) => void;
  removeItem: (itemId: string) => void;
  moveItem: (itemId: string, x: number, y: number) => void;
  resizeItem: (itemId: string, width: number, height: number) => void;
  rotateItem: (itemId: string, rotation: number) => void;
  resizeLayout: (width: number, height: number) => void;
  setLayout: (layout: FactoryLayout) => void;
  resetLayout: () => void;
}

// 기본 레이아웃
const DEFAULT_LAYOUT: FactoryLayout = {
  id: 'default',
  name: '기본 공장 레이아웃',
  width: 900,
  height: 400,
  items: [
    // 장비들
    { id: 'machine-1', type: 'machine', machineId: 'MC-001', label: '1호기', x: 80, y: 120, width: 100, height: 80, rotation: 0 },
    { id: 'machine-2', type: 'machine', machineId: 'MC-002', label: '2호기', x: 280, y: 120, width: 100, height: 80, rotation: 0 },
    { id: 'machine-3', type: 'machine', machineId: 'MC-003', label: '3호기', x: 480, y: 120, width: 100, height: 80, rotation: 0 },
    { id: 'machine-4', type: 'machine', machineId: 'MC-004', label: '4호기', x: 680, y: 120, width: 100, height: 80, rotation: 0 },
    // 바피더들
    { id: 'barfeeder-1', type: 'barfeeder', label: 'BF-1', x: 80, y: 90, width: 100, height: 25, rotation: 0 },
    { id: 'barfeeder-2', type: 'barfeeder', label: 'BF-2', x: 280, y: 90, width: 100, height: 25, rotation: 0 },
    { id: 'barfeeder-3', type: 'barfeeder', label: 'BF-3', x: 480, y: 90, width: 100, height: 25, rotation: 0 },
    { id: 'barfeeder-4', type: 'barfeeder', label: 'BF-4', x: 680, y: 90, width: 100, height: 25, rotation: 0 },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// 아이템 타입별 기본 속성
export const ITEM_DEFAULTS: Record<LayoutItemType, { width: number; height: number; color: string; label: string }> = {
  machine: { width: 100, height: 80, color: '#6B7280', label: '장비' },
  barfeeder: { width: 100, height: 25, color: '#4B5563', label: '바피더' },
  conveyor: { width: 200, height: 30, color: '#F59E0B', label: '컨베이어' },
  robot: { width: 60, height: 60, color: '#8B5CF6', label: '로봇' },
  table: { width: 80, height: 60, color: '#78716C', label: '작업대' },
  pillar: { width: 30, height: 30, color: '#374151', label: '기둥' },
  wall: { width: 200, height: 10, color: '#1F2937', label: '벽' },
  door: { width: 80, height: 20, color: '#3B82F6', label: '출입구' },
  corridor: { width: 200, height: 50, color: '#FCD34D', label: '통로' },
  custom: { width: 50, height: 50, color: '#06B6D4', label: '사용자 정의' },
};

let itemCounter = 100;

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_LAYOUT,
      isEditMode: false,
      selectedItemId: null,

      setEditMode: (enabled) => set({ isEditMode: enabled, selectedItemId: null }),

      selectItem: (itemId) => set({ selectedItemId: itemId }),

      addItem: (item) => {
        const id = `item-${++itemCounter}`;
        set((state) => ({
          layout: {
            ...state.layout,
            items: [...state.layout.items, { ...item, id }],
            updatedAt: new Date().toISOString(),
          },
        }));
      },

      updateItem: (itemId, updates) => {
        set((state) => ({
          layout: {
            ...state.layout,
            items: state.layout.items.map((item) =>
              item.id === itemId ? { ...item, ...updates } : item
            ),
            updatedAt: new Date().toISOString(),
          },
        }));
      },

      removeItem: (itemId) => {
        set((state) => ({
          layout: {
            ...state.layout,
            items: state.layout.items.filter((item) => item.id !== itemId),
            updatedAt: new Date().toISOString(),
          },
          selectedItemId: state.selectedItemId === itemId ? null : state.selectedItemId,
        }));
      },

      moveItem: (itemId, x, y) => {
        get().updateItem(itemId, { x, y });
      },

      resizeItem: (itemId, width, height) => {
        get().updateItem(itemId, { width, height });
      },

      rotateItem: (itemId, rotation) => {
        get().updateItem(itemId, { rotation });
      },

      resizeLayout: (width, height) => {
        set((state) => ({
          layout: {
            ...state.layout,
            width: Math.max(400, width),
            height: Math.max(300, height),
            updatedAt: new Date().toISOString(),
          },
        }));
      },

      setLayout: (layout) => set({ layout }),

      resetLayout: () => set({ layout: DEFAULT_LAYOUT, selectedItemId: null }),
    }),
    {
      name: 'factory-layout',
    }
  )
);
