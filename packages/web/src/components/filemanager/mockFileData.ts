// Mock 데이터 제거됨 — 실장비 연동으로 전환
import type { FileEntry } from '../../stores/fileStore';

export const MOCK_SHARE_FILES: FileEntry[] = [];
export const MOCK_CNC_FILES: Record<string, FileEntry[]> = {};
export const MOCK_REPO_FILES: Record<string, FileEntry[]> = {};
export const MOCK_GCODE_CONTENT: Record<string, string> = {};
