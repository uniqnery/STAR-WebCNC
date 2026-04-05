// Layout Store - 공장 레이아웃 관리

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { layoutApi } from '../lib/api';

// 배치 가능한 요소 타입
export type LayoutItemType = 'machine' | 'barfeeder' | 'rect' | 'circle';

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
  opacity?: number;   // 0~100
  fontSize?: number;
  labelAlign?: 'start' | 'middle' | 'end';
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

// 타입별 마지막 설정값 (위치/id/type 제외한 스타일 필드)
type ItemStyleFields = Pick<LayoutItem, 'width' | 'height' | 'rotation' | 'color' | 'opacity' | 'fontSize' | 'labelAlign'>;

interface LayoutState {
  layout: FactoryLayout;
  isEditMode: boolean;
  selectedItemId: string | null;
  lastSettings: Partial<Record<LayoutItemType, Partial<ItemStyleFields>>>;

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
  bringForward: (itemId: string) => void;
  sendBackward: (itemId: string) => void;
  duplicateItem: (itemId: string) => void;
  // Server sync
  loadFromServer: () => Promise<void>;
  saveToServer: () => Promise<void>;
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
  machine:   { width: 100, height: 80,  color: '#6B7280', label: '장비' },
  barfeeder: { width: 100, height: 25,  color: '#4B5563', label: '바피더' },
  rect:      { width: 80,  height: 50,  color: '#3B82F6', label: '' },
  circle:    { width: 50,  height: 50,  color: '#10B981', label: '' },
};

// updateItem 시 lastSettings에 저장할 필드 목록
const STYLE_FIELDS: (keyof ItemStyleFields)[] = ['width', 'height', 'rotation', 'color', 'opacity', 'fontSize', 'labelAlign'];

let itemCounter = 100;

// 저장된 아이템 ID에서 최대값을 추출하여 중복 방지
function extractMaxCounter(items: LayoutItem[]): number {
  let max = 100;
  for (const item of items) {
    const m = item.id.match(/^item-(\d+)$/);
    if (m) {
      const n = parseInt(m[1]);
      if (n > max) max = n;
    }
  }
  return max;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_LAYOUT,
      isEditMode: false,
      selectedItemId: null,
      lastSettings: {},

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
        set((state) => {
          const item = state.layout.items.find((i) => i.id === itemId);
          const newLastSettings = { ...state.lastSettings };
          if (item) {
            // 스타일 관련 필드가 포함된 경우 lastSettings 업데이트
            const styleUpdates: Partial<ItemStyleFields> = {};
            for (const field of STYLE_FIELDS) {
              if (field in updates) {
                (styleUpdates as Record<string, unknown>)[field] = (updates as Record<string, unknown>)[field];
              }
            }
            if (Object.keys(styleUpdates).length > 0) {
              newLastSettings[item.type] = { ...newLastSettings[item.type], ...styleUpdates };
            }
          }
          return {
            lastSettings: newLastSettings,
            layout: {
              ...state.layout,
              items: state.layout.items.map((i) => i.id === itemId ? { ...i, ...updates } : i),
              updatedAt: new Date().toISOString(),
            },
          };
        });
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
        // moveItem은 lastSettings 갱신 불필요 — updateItem 우회
        set((state) => ({
          layout: {
            ...state.layout,
            items: state.layout.items.map((i) => i.id === itemId ? { ...i, x, y } : i),
            updatedAt: new Date().toISOString(),
          },
        }));
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
            width,
            height,
            updatedAt: new Date().toISOString(),
          },
        }));
      },

      setLayout: (layout) => set({ layout }),

      resetLayout: () => set({ layout: DEFAULT_LAYOUT, selectedItemId: null }),

      bringForward: (itemId) => {
        set((state) => {
          const items = [...state.layout.items];
          const idx = items.findIndex((i) => i.id === itemId);
          if (idx < items.length - 1) {
            [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
          }
          return { layout: { ...state.layout, items, updatedAt: new Date().toISOString() } };
        });
      },

      sendBackward: (itemId) => {
        set((state) => {
          const items = [...state.layout.items];
          const idx = items.findIndex((i) => i.id === itemId);
          if (idx > 0) {
            [items[idx], items[idx - 1]] = [items[idx - 1], items[idx]];
          }
          return { layout: { ...state.layout, items, updatedAt: new Date().toISOString() } };
        });
      },

      loadFromServer: async () => {
        try {
          const res = await layoutApi.getFactoryLayout();
          if (res.success && res.data) {
            const serverLayout = res.data as FactoryLayout;
            set({ layout: serverLayout });
            itemCounter = extractMaxCounter(serverLayout.items);
          }
        } catch {
          // 서버 없으면 localStorage 유지
        }
      },

      saveToServer: async () => {
        try {
          await layoutApi.saveFactoryLayout(get().layout);
        } catch {
          // 저장 실패 시 조용히 무시 (localStorage는 이미 저장됨)
        }
      },

      duplicateItem: (itemId) => {
        set((state) => {
          const original = state.layout.items.find((i) => i.id === itemId);
          if (!original) return state;
          // machine 타입 복사 시 machineId 제거 → rect로 변환 (독립 도형)
          const { machineId: _m, ...rest } = original;
          const newType: LayoutItemType = original.type === 'machine' ? 'rect' : original.type;
          const newItem: LayoutItem = {
            ...rest,
            type: newType,
            id: `item-${++itemCounter}`,
            x: original.x + 30,
            y: original.y + 30,
          };
          const idx = state.layout.items.findIndex((i) => i.id === itemId);
          const items = [...state.layout.items];
          items.splice(idx + 1, 0, newItem);
          return {
            layout: { ...state.layout, items, updatedAt: new Date().toISOString() },
            selectedItemId: newItem.id,
          };
        });
      },
    }),
    {
      name: 'factory-layout',
      onRehydrateStorage: () => (state) => {
        if (state) {
          itemCounter = extractMaxCounter(state.layout.items);
        }
      },
    }
  )
);
