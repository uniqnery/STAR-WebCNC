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
  // HEAD
  { id: 'HEAD1', label: 'HEAD 1', category: 'HEAD', hasLamp: true,
    reqAddr: 'Y0010.0', lampAddr: 'R0010.0', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'HEAD2', label: 'HEAD 2', category: 'HEAD', hasLamp: true,
    reqAddr: 'Y0010.1', lampAddr: 'R0010.1', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'HEAD3', label: 'HEAD 3', category: 'HEAD', hasLamp: true,
    reqAddr: 'Y0010.2', lampAddr: 'R0010.2', enabled: false, timing: { ...DEFAULT_TIMING } },
  { id: 'HEAD_CHANGE', label: 'HEAD CHANGE', category: 'HEAD', hasLamp: false,
    reqAddr: 'Y0010.3', lampAddr: '', enabled: true, timing: { longPressMs: 1500, holdMs: 300, timeoutMs: 2000 } },

  // CHUCKING
  { id: 'MAIN_CHUCKING', label: 'MAIN CHUCKING', category: 'CHUCKING', hasLamp: true,
    reqAddr: 'Y0011.0', lampAddr: 'R0011.0', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'SUB_CHUCKING', label: 'SUB CHUCKING', category: 'CHUCKING', hasLamp: true,
    reqAddr: 'Y0011.1', lampAddr: 'R0011.1', enabled: true, timing: { ...DEFAULT_TIMING } },

  // MODE
  { id: 'EDIT', label: 'EDIT', category: 'MODE', hasLamp: true,
    reqAddr: 'Y0020.0', lampAddr: 'R0020.0', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },
  { id: 'MEMORY', label: 'MEMORY', category: 'MODE', hasLamp: true,
    reqAddr: 'Y0020.1', lampAddr: 'R0020.1', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },
  { id: 'MDI', label: 'MDI', category: 'MODE', hasLamp: true,
    reqAddr: 'Y0020.2', lampAddr: 'R0020.2', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },
  { id: 'JOG', label: 'JOG', category: 'MODE', hasLamp: true,
    reqAddr: 'Y0020.3', lampAddr: 'R0020.3', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },
  { id: 'DNC', label: 'DNC', category: 'MODE', hasLamp: true,
    reqAddr: 'Y0020.4', lampAddr: 'R0020.4', enabled: true, timing: { ...DEFAULT_TIMING }, color: 'gray' },

  // OPERATION
  { id: 'SINGLE_BLOCK', label: 'SINGLE BLOCK', category: 'OPERATION', hasLamp: true,
    reqAddr: 'Y0021.0', lampAddr: 'R0021.0', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'OPTIONAL_STOP', label: 'OPTIONAL STOP', category: 'OPERATION', hasLamp: true,
    reqAddr: 'Y0021.1', lampAddr: 'R0021.1', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'ONE_CYCLE', label: 'ONE CYCLE', category: 'OPERATION', hasLamp: true,
    reqAddr: 'Y0021.2', lampAddr: 'R0021.2', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'AIR_CUT', label: 'AIR CUT', category: 'OPERATION', hasLamp: true,
    reqAddr: 'Y0021.3', lampAddr: 'R0021.3', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'AUTO_POWER_OFF', label: 'AUTO POWER OFF', category: 'OPERATION', hasLamp: true,
    reqAddr: 'Y0021.4', lampAddr: 'R0021.4', enabled: true, timing: { ...DEFAULT_TIMING } },
  { id: 'WORK_LIGHT', label: 'WORK LIGHT', category: 'OPERATION', hasLamp: true,
    reqAddr: 'Y0021.5', lampAddr: 'R0021.5', enabled: true, timing: { ...DEFAULT_TIMING } },

  // CYCLE
  { id: 'CYCLE_START', label: 'CYCLE START', category: 'CYCLE', hasLamp: true,
    reqAddr: 'Y0030.0', lampAddr: 'R0030.0', enabled: true,
    timing: { longPressMs: 2000, holdMs: 500, timeoutMs: 3000 }, color: 'green' },
  { id: 'FEED_HOLD', label: 'FEED HOLD', category: 'CYCLE', hasLamp: true,
    reqAddr: 'Y0030.1', lampAddr: 'R0030.1', enabled: true,
    timing: { longPressMs: 1000, holdMs: 300, timeoutMs: 2000 }, color: 'yellow' },
  { id: 'EMERGENCY_STOP', label: 'EMERGENCY STOP', category: 'CYCLE', hasLamp: false,
    reqAddr: 'Y0030.2', lampAddr: '', enabled: true,
    timing: { longPressMs: 3000, holdMs: 1000, timeoutMs: 5000 }, color: 'red' },
  { id: 'RESET', label: 'RESET', category: 'CYCLE', hasLamp: false,
    reqAddr: 'Y0030.3', lampAddr: '', enabled: true,
    timing: { longPressMs: 1500, holdMs: 500, timeoutMs: 3000 }, color: 'gray' },
];

export const DEFAULT_TOWER_LIGHT: TowerLightConfig = {
  redAddr: 'R0100.0',
  yellowAddr: 'R0100.1',
  greenAddr: 'R0100.2',
};

export function getButtonsByCategory(template: PmcButtonDef[], category: ButtonCategory): PmcButtonDef[] {
  return template.filter((btn) => btn.category === category);
}
