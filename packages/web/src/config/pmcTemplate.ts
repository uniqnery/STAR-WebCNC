// PMC Button Template - 리모트 오퍼레이션 패널 버튼 정의
// 각 키는 FOCAS PMC Address 1:1 매핑

export type ButtonCategory = 'HEAD' | 'CHUCKING' | 'MODE' | 'OPERATION' | 'CYCLE';

export interface PmcButtonDef {
  id: string;
  label: string;
  category: ButtonCategory;
  hasLamp: boolean;
  reqAddr: string;       // PMC OUT 주소 (Write)
  lampAddr: string;      // PMC-R IN 주소 (Read), 램프 없으면 ''
  enabled: boolean;      // 기본 활성화 여부 (장비별 override 가능)
  timing: {
    longPressMs: number; // 롱프레스 완료까지 시간
    holdMs: number;      // PMC bit HIGH 유지 시간
    timeoutMs: number;   // 타임아웃
  };
  color?: 'green' | 'yellow' | 'red' | 'blue' | 'gray';
}

export interface TowerLightConfig {
  redAddr: string;
  yellowAddr: string;
  greenAddr: string;
}

const DEFAULT_TIMING = { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 };

export const DEFAULT_PMC_TEMPLATE: PmcButtonDef[] = [
  // HEAD (PATH1/PATH2 참조, SB-20R2 확정 주소)
  { id: 'HEAD1', label: 'HEAD 1', category: 'HEAD', hasLamp: true,
    reqAddr: 'R6104.0', lampAddr: 'R6004.0', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'HEAD2', label: 'HEAD 2', category: 'HEAD', hasLamp: true,
    reqAddr: 'R6104.1', lampAddr: 'R6004.1', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'HEAD_CHANGE', label: 'HEAD CHANGE', category: 'HEAD', hasLamp: false,
    reqAddr: 'R6103.7', lampAddr: '', enabled: true, timing: { longPressMs: 1500, holdMs: 300, timeoutMs: 2000 } },

  // CHUCKING (메인/서브 콜렛 참조)
  { id: 'MAIN_CHUCKING', label: 'MAIN CHUCKING', category: 'CHUCKING', hasLamp: true,
    reqAddr: 'R6100.1', lampAddr: 'R6000.1', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'SUB_CHUCKING', label: 'SUB CHUCKING', category: 'CHUCKING', hasLamp: true,
    reqAddr: 'R6100.3', lampAddr: 'R6000.3', enabled: true, timing: { ...DEFAULT_TIMING } },

  // MODE
  { id: 'EDIT', label: 'EDIT', category: 'MODE', hasLamp: true,
    reqAddr: 'R6104.4', lampAddr: 'R6004.4', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },
  { id: 'MEMORY', label: 'MEMORY', category: 'MODE', hasLamp: true,
    reqAddr: 'R6104.5', lampAddr: 'R6004.5', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },
  { id: 'MDI', label: 'MDI', category: 'MODE', hasLamp: true,
    reqAddr: 'R6104.6', lampAddr: 'R6004.6', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },
  { id: 'HANDLE', label: 'HANDLE', category: 'MODE', hasLamp: true,
    reqAddr: 'R6105.0', lampAddr: 'R6005.0', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },
  { id: 'DNC', label: 'DNC', category: 'MODE', hasLamp: true,
    reqAddr: 'R6105.1', lampAddr: 'R6005.1', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },

  // OPERATION
  { id: 'SINGLE_BLOCK', label: 'SINGLE BLOCK', category: 'OPERATION', hasLamp: true,
    reqAddr: 'R6106.1', lampAddr: 'R6006.1', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'OPTIONAL_STOP', label: 'OPTIONAL STOP', category: 'OPERATION', hasLamp: true,
    reqAddr: 'R6105.7', lampAddr: 'R6005.7', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'ONE_CYCLE', label: 'ONE CYCLE', category: 'OPERATION', hasLamp: true,
    reqAddr: 'R6106.0', lampAddr: 'R6006.0', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'AIR_CUT', label: 'AIR CUT', category: 'OPERATION', hasLamp: true,
    reqAddr: 'R6105.6', lampAddr: 'R6005.6', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'AUTO_POWER_OFF', label: 'AUTO POWER OFF', category: 'OPERATION', hasLamp: true,
    reqAddr: 'R6105.5', lampAddr: 'R6005.5', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'WORK_LIGHT', label: 'WORK LIGHT', category: 'OPERATION', hasLamp: true,
    reqAddr: 'R6106.2', lampAddr: 'R6006.2', enabled: true, timing: { ...DEFAULT_TIMING } },

  // CYCLE
  { id: 'CYCLE_START', label: 'CYCLE START', category: 'CYCLE', hasLamp: true,
    reqAddr: 'R6105.4', lampAddr: 'R6005.4', enabled: true,
    timing: { longPressMs: 2000, holdMs: 500, timeoutMs: 3000 }, color: 'green' },
  { id: 'FEED_HOLD', label: 'FEED HOLD', category: 'CYCLE', hasLamp: true,
    reqAddr: 'R6105.3', lampAddr: 'R6005.3', enabled: true,
    timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 }, color: 'yellow' },
  { id: 'EMERGENCY_STOP', label: 'EMERGENCY STOP', category: 'CYCLE', hasLamp: false,
    reqAddr: '', lampAddr: '', enabled: true,
    timing: { longPressMs: 3000, holdMs: 1000, timeoutMs: 5000 }, color: 'red' },
  { id: 'RESET', label: 'RESET', category: 'CYCLE', hasLamp: false,
    reqAddr: 'R6103.0', lampAddr: '', enabled: true,
    timing: { longPressMs: 1500, holdMs: 500, timeoutMs: 3000 }, color: 'gray' },
];

export const DEFAULT_TOWER_LIGHT: TowerLightConfig = {
  redAddr: 'R6009.0',    // MACHINE READY (경광등 연결 주소 — 실기기 확인 후 수정)
  yellowAddr: 'R6006.3', // POWER DRIVEN TOOLS
  greenAddr: 'R6003.0',  // CYCLE RUNNING
};

export function getButtonsByCategory(template: PmcButtonDef[], category: ButtonCategory): PmcButtonDef[] {
  return template.filter((btn) => btn.category === category);
}

// PanelGroup/PanelKey types for import (avoid circular dep)
import type { PanelGroup, PanelKey } from '../stores/templateStore';

const CATEGORY_NAMES: Record<ButtonCategory, string> = {
  HEAD: 'HEAD', CHUCKING: 'CHUCKING', MODE: 'MODE', OPERATION: 'OPERATION', CYCLE: 'CYCLE',
};

/** Convert legacy PmcButtonDef[] to PanelGroup[] (fallback when template has no panelLayout) */
export function toPanelGroups(buttons: PmcButtonDef[]): PanelGroup[] {
  const categories: ButtonCategory[] = ['HEAD', 'CHUCKING', 'MODE', 'OPERATION', 'CYCLE'];
  const result: PanelGroup[] = [];
  for (const cat of categories) {
    const filtered = buttons.filter((b) => b.category === cat && b.enabled);
    if (filtered.length === 0) continue;
    result.push({
      id: `grp-${cat.toLowerCase()}`,
      name: CATEGORY_NAMES[cat],
      sameRowAsPrev: cat === 'CHUCKING',  // CHUCKING은 HEAD와 같은 줄
      keys: filtered.map((b): PanelKey => ({
        id: b.id,
        label: b.label,
        hasLamp: b.hasLamp,
        color: b.color || 'gray',
        size: cat === 'CYCLE' ? 'large' : 'normal',
        reqAddr: b.reqAddr,
        lampAddr: b.lampAddr,
        timing: { ...b.timing },
      })),
    });
  }
  return result;
}

/** Default panel groups (converted from DEFAULT_PMC_TEMPLATE) */
export const DEFAULT_PANEL_GROUPS: PanelGroup[] = toPanelGroups(DEFAULT_PMC_TEMPLATE);
