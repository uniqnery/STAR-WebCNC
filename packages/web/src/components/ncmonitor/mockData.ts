// Mock 데이터 제거됨 — 실장비 연동으로 전환
import type { OffsetData, CountData, ToolLifeData } from '../../stores/machineStore';

export const MOCK_OFFSET_DATA: OffsetData = {
  path1Wear: [],
  path2Wear: [],
  path1Geometry: [],
  path2Geometry: [],
};

export const MOCK_COUNT_DATA: CountData = {
  counter: { counterOn: false, preset: 0, count: 0, total: 0 },
  time: { runningTime: '', cycleTime: '', remainingTime: '', completionTime: '' },
  barFeeder: { barLength: 0, remnant: 0, partLength: 0, cutOffWidth: 0, requiredBars: 0, numberOfParts: 0, barChangeTime: '' },
};

export const MOCK_TOOL_LIFE_DATA: ToolLifeData = {
  counterOn: false,
  nonStopTimePeriod: false,
  countUpNotice: false,
  path1Tools: [],
  path2Tools: [],
};
