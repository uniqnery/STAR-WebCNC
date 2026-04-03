// Template Type Definition — Single Source of Truth
// TemplateDefinition 변경 시 Agent TemplateModel.cs 반드시 동시 수정

export interface TemplateDefinition {
  templateId: string;
  version: string;
  name: string;
  description: string;
  cncType: string;
  seriesName: string;
  systemInfo: unknown;
  axisConfig: unknown;
  pmcMap: unknown;
  interlockConfig: unknown;
  interlockModules: unknown;
  remoteControlInterlock: unknown;
  virtualPanel: unknown;
  panelLayout: unknown;
  topBarInterlock: unknown;
  offsetConfig: unknown;
  counterConfig: unknown;
  toolLifeConfig: unknown;
  schedulerConfig: unknown;
  pmcMessages: unknown;
  capabilities: unknown;
  /** 추가 PMC 모니터링 주소 — 인터락/스페셜 메뉴 전용 (e.g. SIMTOS R6035.0) */
  extraPmcAddrs: string[];
}

/**
 * DB upsert / 파일 동기화에 반드시 포함되어야 하는 필드 목록.
 * 새 필드 추가 시 여기에도 반드시 추가 + Agent TemplateModel.cs 동기 수정.
 */
export const REQUIRED_TEMPLATE_FIELDS: (keyof TemplateDefinition)[] = [
  'templateId',
  'version',
  'name',
  'description',
  'cncType',
  'seriesName',
  'systemInfo',
  'axisConfig',
  'pmcMap',
  'interlockConfig',
  'interlockModules',
  'remoteControlInterlock',
  'virtualPanel',
  'panelLayout',
  'topBarInterlock',
  'offsetConfig',
  'counterConfig',
  'toolLifeConfig',
  'schedulerConfig',
  'pmcMessages',
  'capabilities',
  'extraPmcAddrs',
];

/**
 * PMC 주소 형식 검증: "R6037.0", "G8.4", "A209.5" 등
 */
export function isValidPmcAddr(addr: string): boolean {
  return /^[A-Za-z]\d+\.\d+$/.test(addr);
}

/**
 * extraPmcAddrs 배열 검증
 * - string[] 타입 확인
 * - 각 항목이 유효한 PMC 주소 형식인지 확인
 */
export function validateExtraPmcAddrs(addrs: unknown): string[] {
  if (!Array.isArray(addrs)) {
    throw new Error(`extraPmcAddrs must be an array, got: ${typeof addrs}`);
  }
  for (const addr of addrs) {
    if (typeof addr !== 'string') {
      throw new Error(`extraPmcAddrs contains non-string value: ${JSON.stringify(addr)}`);
    }
    if (!isValidPmcAddr(addr)) {
      throw new Error(`extraPmcAddrs contains invalid PMC address: "${addr}" (expected format: R6037.0)`);
    }
  }
  return addrs as string[];
}

/**
 * 템플릿 데이터 필수 필드 검증
 * 누락 시 즉시 throw — 서버 시작 및 syncTemplate 시 호출
 */
export function validateTemplateFields(data: Record<string, unknown>, source: string): void {
  const missing = REQUIRED_TEMPLATE_FIELDS.filter(
    (f) => f !== 'extraPmcAddrs' && data[f] === undefined
  );
  if (missing.length > 0) {
    throw new Error(`[TemplateValidation] ${source}: missing required fields: ${missing.join(', ')}`);
  }
  // extraPmcAddrs 타입/형식 검증 (없으면 빈 배열로 통과)
  if (data['extraPmcAddrs'] !== undefined) {
    validateExtraPmcAddrs(data['extraPmcAddrs']);
  }
}
