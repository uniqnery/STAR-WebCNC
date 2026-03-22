// PanelEditor - 조작반 레이아웃 편집기 (/admin/panel-editor)
// 그룹/키를 자유롭게 구성하고 CncTemplate.panelLayout에 저장

import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  useTemplateStore,
  PanelGroup,
  PanelKey,
  PanelKeyColor,
  PanelKeySize,
  GroupNameAlign,
  GroupNameSize,
  GroupNameWeight,
  GroupNameColor,
} from '../stores/templateStore';
import { DEFAULT_PANEL_GROUPS } from '../config/pmcTemplate';

// ── 유틸 ────────────────────────────────────────────────
function uid() {
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function createDefaultKey(): PanelKey {
  return {
    id: uid(),
    label: '새 키',
    hasLamp: false,
    color: 'gray',
    size: 'normal',
    reqAddr: '',
    lampAddr: '',
    timing: { longPressMs: 1500, holdMs: 500, timeoutMs: 3000 },
  };
}

function createDefaultGroup(): PanelGroup {
  return {
    id: `grp-${Date.now()}`,
    name: '새 그룹',
    keys: [],
    sameRowAsPrev: false,
  };
}

const SIZE_OPTIONS: { value: PanelKeySize; label: string; desc: string }[] = [
  { value: 'small', label: 'S', desc: '56×70' },
  { value: 'normal', label: 'M', desc: '70×86' },
  { value: 'wide', label: 'W', desc: '110×86' },
  { value: 'large', label: 'L', desc: '80×96' },
];

const COLOR_OPTIONS: { value: PanelKeyColor; label: string; cls: string }[] = [
  { value: 'gray', label: 'Gray', cls: 'bg-gray-500' },
  { value: 'green', label: 'Green', cls: 'bg-green-500' },
  { value: 'yellow', label: 'Yellow', cls: 'bg-yellow-500' },
  { value: 'red', label: 'Red', cls: 'bg-red-500' },
  { value: 'blue', label: 'Blue', cls: 'bg-blue-500' },
];

// ── 그룹명 스타일 매핑 ─────────────────────────────────
const GN_SIZE_CLS: Record<GroupNameSize, string> = {
  xs: 'text-[10px]', sm: 'text-xs', base: 'text-sm',
};
const GN_WEIGHT_CLS: Record<GroupNameWeight, string> = {
  normal: 'font-normal', semibold: 'font-semibold', bold: 'font-bold',
};
const GN_COLOR_CLS: Record<GroupNameColor, string> = {
  gray: 'text-gray-500', white: 'text-white', blue: 'text-blue-400',
  green: 'text-green-400', yellow: 'text-yellow-400', red: 'text-red-400',
};
const GN_ALIGN_CLS: Record<GroupNameAlign, string> = {
  left: 'text-left', center: 'text-center', right: 'text-right',
};
const GN_KEYS_JUSTIFY_CLS: Record<GroupNameAlign, string> = {
  left: '', center: 'justify-center', right: 'justify-end',
};

const NAME_ALIGN_OPTIONS: { value: GroupNameAlign; icon: string }[] = [
  { value: 'left', icon: '◧' },
  { value: 'center', icon: '◫' },
  { value: 'right', icon: '◨' },
];

const NAME_SIZE_OPTIONS: { value: GroupNameSize; label: string }[] = [
  { value: 'xs', label: 'XS' },
  { value: 'sm', label: 'SM' },
  { value: 'base', label: 'MD' },
];

const NAME_WEIGHT_OPTIONS: { value: GroupNameWeight; label: string }[] = [
  { value: 'normal', label: '가늘게' },
  { value: 'semibold', label: '보통' },
  { value: 'bold', label: '굵게' },
];

const NAME_COLOR_OPTIONS: { value: GroupNameColor; label: string; cls: string }[] = [
  { value: 'gray', label: 'Gray', cls: 'bg-gray-500' },
  { value: 'white', label: 'White', cls: 'bg-white' },
  { value: 'blue', label: 'Blue', cls: 'bg-blue-400' },
  { value: 'green', label: 'Green', cls: 'bg-green-400' },
  { value: 'yellow', label: 'Yellow', cls: 'bg-yellow-400' },
  { value: 'red', label: 'Red', cls: 'bg-red-400' },
];

// ── Main Component ──────────────────────────────────────
export function PanelEditor() {
  const user = useAuthStore((s) => s.user);
  const {
    templates,
    selectedTemplateId,
    loadTemplates,
    selectTemplate,
    updateTemplate,
    importFromJsonc,
  } = useTemplateStore();

  const [groups, setGroups] = useState<PanelGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';

  // 초기 로드
  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // 템플릿 전환 시 panelLayout 로드
  useEffect(() => {
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (tpl) {
      setGroups(structuredClone(tpl.panelLayout || []));
      setDirty(false);
      setSelectedGroupId(null);
      setSelectedKeyId(null);
    }
  }, [selectedTemplateId, templates]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const selectedKey = selectedGroup?.keys.find((k) => k.id === selectedKeyId);
  const selectedTpl = templates.find((t) => t.id === selectedTemplateId);

  // ── Group actions ──
  const addGroup = () => {
    const g = createDefaultGroup();
    setGroups((prev) => [...prev, g]);
    setSelectedGroupId(g.id);
    setSelectedKeyId(null);
    setDirty(true);
  };

  const deleteGroup = (gid: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== gid));
    if (selectedGroupId === gid) { setSelectedGroupId(null); setSelectedKeyId(null); }
    setDirty(true);
  };

  const moveGroup = (gid: string, dir: -1 | 1) => {
    setGroups((prev) => {
      const idx = prev.findIndex((g) => g.id === gid);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
    setDirty(true);
  };

  const updateGroupName = (gid: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, name } : g)));
    setDirty(true);
  };

  const updateGroupSameRow = (gid: string, sameRowAsPrev: boolean) => {
    setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, sameRowAsPrev } : g)));
    setDirty(true);
  };

  const updateGroupStyle = (gid: string, updates: Partial<PanelGroup>) => {
    setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, ...updates } : g)));
    setDirty(true);
  };

  // ── Key actions ──
  const addKey = (gid: string) => {
    const k = createDefaultKey();
    setGroups((prev) =>
      prev.map((g) => (g.id === gid ? { ...g, keys: [...g.keys, k] } : g))
    );
    setSelectedGroupId(gid);
    setSelectedKeyId(k.id);
    setDirty(true);
  };

  const deleteKey = (gid: string, kid: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === gid ? { ...g, keys: g.keys.filter((k) => k.id !== kid) } : g))
    );
    if (selectedKeyId === kid) setSelectedKeyId(null);
    setDirty(true);
  };

  const moveKey = (gid: string, kid: string, dir: -1 | 1) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== gid) return g;
        const idx = g.keys.findIndex((k) => k.id === kid);
        if (idx < 0) return g;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= g.keys.length) return g;
        const keys = [...g.keys];
        [keys[idx], keys[newIdx]] = [keys[newIdx], keys[idx]];
        return { ...g, keys };
      })
    );
    setDirty(true);
  };

  const updateKey = useCallback((gid: string, kid: string, updates: Partial<PanelKey>) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === gid
          ? { ...g, keys: g.keys.map((k) => (k.id === kid ? { ...k, ...updates } : k)) }
          : g
      )
    );
    setDirty(true);
  }, []);

  // ── Save ──
  const handleSave = () => {
    if (!selectedTemplateId) return;
    updateTemplate(selectedTemplateId, { panelLayout: groups });
    setDirty(false);
  };

  // ── 기본 조작반 불러오기 ──
  const loadDefaults = () => {
    setGroups(structuredClone(DEFAULT_PANEL_GROUPS));
    setSelectedGroupId(null);
    setSelectedKeyId(null);
    setDirty(true);
  };

  // ── Export / Import ──
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(groups, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panel-layout-${selectedTemplateId || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as PanelGroup[];
        if (Array.isArray(parsed)) {
          setGroups(parsed);
          setSelectedGroupId(null);
          setSelectedKeyId(null);
          setDirty(true);
        }
      } catch { /* invalid JSON */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 비인가 접근
  if (!canEdit) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-6 rounded-lg">
          관리자 또는 HQ 엔지니어만 접근할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-gray-900 text-white">
      {/* ── Left Sidebar: Template List ── */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-700">
          <h2 className="text-sm font-bold text-gray-200">패널 디자인</h2>
          <p className="text-[10px] text-gray-500 mt-0.5">템플릿별 조작반 레이아웃</p>
        </div>

        {/* Template list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => {
                if (dirty && !confirm('저장하지 않은 변경사항이 있습니다. 전환하시겠습니까?')) return;
                selectTemplate(tpl.id);
              }}
              className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${
                tpl.id === selectedTemplateId
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="font-semibold truncate">{tpl.name || '(이름 없음)'}</div>
              <div className="text-[10px] opacity-70 font-mono truncate">{tpl.templateId || '(ID 미설정)'}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-1.5 h-1.5 rounded-full ${tpl.isActive ? 'bg-green-400' : 'bg-gray-500'}`} />
                <span className="text-[10px] opacity-60">키 {(tpl.panelLayout || []).reduce((s, g) => s + g.keys.length, 0)}개</span>
              </div>
            </button>
          ))}
          {templates.length === 0 && (
            <div className="p-3 text-center text-gray-600 text-xs">템플릿 없음</div>
          )}
        </div>

        {/* Import template */}
        <div className="p-2 border-t border-gray-700">
          <label className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 cursor-pointer">
            <span>↑</span> 템플릿 불러오기
            <input
              type="file"
              accept=".jsonc,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try { importFromJsonc(reader.result as string); }
                  catch (err) { alert('파싱 실패: ' + (err instanceof Error ? err.message : String(err))); }
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {/* ── Right: Editor ── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold truncate text-gray-200">
              {selectedTpl?.name || '(템플릿 선택)'}
            </span>
            {dirty && <span className="text-xs text-yellow-400 shrink-0">* 변경사항 있음</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={loadDefaults}
              className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded hover:text-white hover:border-gray-500"
            >
              기본값 불러오기
            </button>
            <label className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded hover:text-white hover:border-gray-500 cursor-pointer">
              Import
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>
            <button
              onClick={handleExport}
              className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded hover:text-white hover:border-gray-500"
            >
              Export
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              저장
            </button>
          </div>
        </div>

        {/* Preview + Editor body */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Preview */}
          <div className="border-b border-gray-700 p-4 flex-shrink-0 overflow-x-auto">
            <div className="text-xs text-gray-500 mb-2">미리보기 (클릭하여 선택)</div>
            <PanelPreview
              groups={groups}
              selectedKeyId={selectedKeyId}
              onSelectKey={(gid, kid) => { setSelectedGroupId(gid); setSelectedKeyId(kid); }}
              onSelectGroup={(gid) => { setSelectedGroupId(gid); setSelectedKeyId(null); }}
            />
          </div>

          {/* Editor panels */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Left: Group list */}
            <div className="w-64 border-r border-gray-700 flex flex-col overflow-y-auto flex-shrink-0">
              <div className="p-3 border-b border-gray-700 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-300">그룹</span>
                <button onClick={addGroup} className="text-xs text-blue-400 hover:text-blue-300">+ 추가</button>
              </div>
              {groups.map((g, gi) => (
                <div
                  key={g.id}
                  className={`border-b border-gray-800 ${selectedGroupId === g.id ? 'bg-gray-800' : ''}`}
                >
                  <div
                    className="flex items-center gap-1 px-3 py-2 cursor-pointer hover:bg-gray-800"
                    onClick={() => { setSelectedGroupId(g.id); setSelectedKeyId(null); }}
                  >
                    {g.sameRowAsPrev && (
                      <span className="text-[9px] text-yellow-500 mr-0.5" title="이전 그룹과 같은 줄">↔</span>
                    )}
                    <span className="flex-1 text-sm truncate">{g.name}</span>
                    <span className="text-xs text-gray-500">{g.keys.length}</span>
                    <button onClick={(e) => { e.stopPropagation(); moveGroup(g.id, -1); }}
                      disabled={gi === 0} className="text-gray-500 hover:text-white disabled:opacity-30 text-xs px-0.5">▲</button>
                    <button onClick={(e) => { e.stopPropagation(); moveGroup(g.id, 1); }}
                      disabled={gi === groups.length - 1} className="text-gray-500 hover:text-white disabled:opacity-30 text-xs px-0.5">▼</button>
                    <button onClick={(e) => { e.stopPropagation(); deleteGroup(g.id); }}
                      className="text-red-500 hover:text-red-400 text-xs px-0.5">✕</button>
                  </div>
                  {/* Keys in this group */}
                  {selectedGroupId === g.id && (
                    <div className="pb-2">
                      {g.keys.map((k, ki) => (
                        <div
                          key={k.id}
                          className={`flex items-center gap-1 px-4 py-1 text-xs cursor-pointer hover:bg-gray-750 ${
                            selectedKeyId === k.id ? 'bg-blue-900/30 text-blue-300' : 'text-gray-400'
                          }`}
                          onClick={() => setSelectedKeyId(k.id)}
                        >
                          <span className={`w-2 h-2 rounded-full ${COLOR_OPTIONS.find((c) => c.value === k.color)?.cls || 'bg-gray-500'}`} />
                          <span className="flex-1 truncate">{k.label}</span>
                          <span className="text-gray-600 font-mono text-[10px]">{k.reqAddr || '-'}</span>
                          <button onClick={(e) => { e.stopPropagation(); moveKey(g.id, k.id, -1); }}
                            disabled={ki === 0} className="text-gray-600 hover:text-white disabled:opacity-30 px-0.5">▲</button>
                          <button onClick={(e) => { e.stopPropagation(); moveKey(g.id, k.id, 1); }}
                            disabled={ki === g.keys.length - 1} className="text-gray-600 hover:text-white disabled:opacity-30 px-0.5">▼</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteKey(g.id, k.id); }}
                            className="text-red-500/60 hover:text-red-400 px-0.5">✕</button>
                        </div>
                      ))}
                      <button
                        onClick={() => addKey(g.id)}
                        className="w-full text-center text-xs text-gray-600 hover:text-blue-400 py-1"
                      >
                        + 키 추가
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {groups.length === 0 && (
                <div className="p-4 text-center text-gray-600 text-sm">
                  그룹이 없습니다.<br />
                  [+ 추가] 또는 [기본값 불러오기]
                </div>
              )}
            </div>

            {/* Right: Key property editor */}
            <div className="flex-1 overflow-y-auto p-4">
              {selectedKey && selectedGroupId ? (
                <KeyPropertyEditor
                  panelKey={selectedKey}
                  groupName={selectedGroup!.name}
                  onUpdateGroup={(name) => updateGroupName(selectedGroupId, name)}
                  onUpdate={(updates) => updateKey(selectedGroupId, selectedKey.id, updates)}
                />
              ) : selectedGroup ? (
                <GroupPropertyEditor
                  group={selectedGroup}
                  isFirst={groups.indexOf(selectedGroup) === 0}
                  onUpdateName={(name) => updateGroupName(selectedGroup.id, name)}
                  onUpdateSameRow={(v) => updateGroupSameRow(selectedGroup.id, v)}
                  onUpdateStyle={(updates) => updateGroupStyle(selectedGroup.id, updates)}
                />
              ) : (
                <div className="text-gray-600 text-sm text-center mt-20">
                  좌측 그룹/키를 선택하거나 미리보기에서 버튼을 클릭하세요
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Preview Component ────────────────────────────────────

function PanelPreview({
  groups,
  selectedKeyId,
  onSelectKey,
  onSelectGroup,
}: {
  groups: PanelGroup[];
  selectedKeyId: string | null;
  onSelectKey: (gid: string, kid: string) => void;
  onSelectGroup: (gid: string) => void;
}) {
  if (groups.length === 0) {
    return <div className="text-gray-600 text-sm text-center py-6">조작반이 비어 있습니다</div>;
  }

  // 같은 줄 그룹 묶기
  const rows: PanelGroup[][] = [];
  for (const group of groups) {
    if (group.sameRowAsPrev && rows.length > 0) {
      rows[rows.length - 1].push(group);
    } else {
      rows.push([group]);
    }
  }

  const renderGroupContent = (group: PanelGroup) => {
    const sizeCls = GN_SIZE_CLS[group.nameFontSize || 'xs'];
    const weightCls = GN_WEIGHT_CLS[group.nameFontWeight || 'semibold'];
    const colorCls = GN_COLOR_CLS[group.nameColor || 'gray'];
    const alignCls = GN_ALIGN_CLS[group.nameAlign || 'left'];
    const justifyCls = GN_KEYS_JUSTIFY_CLS[group.nameAlign || 'left'];

    return (
    <div key={group.id}>
      <div
        className={`${sizeCls} ${weightCls} ${colorCls} ${alignCls} mb-1.5 tracking-widest uppercase cursor-pointer hover:brightness-125`}
        onClick={() => onSelectGroup(group.id)}
      >
        {group.name}
      </div>
      <div className={`flex flex-wrap gap-2 ${justifyCls}`}>
        {group.keys.map((k) => (
          <PreviewButton
            key={k.id}
            panelKey={k}
            selected={selectedKeyId === k.id}
            onClick={() => onSelectKey(group.id, k.id)}
          />
        ))}
      </div>
    </div>
  );
  };

  return (
    <div className="space-y-3">
      {rows.map((row, ri) => (
        <div key={row[0].id}>
          {ri > 0 && <div className="border-t border-gray-700 mb-3" />}
          {row.length === 1 ? (
            renderGroupContent(row[0])
          ) : (
            <div className="flex items-start gap-4">
              {row.map((group, gi) => (
                <div key={group.id} className="flex items-start gap-4">
                  {gi > 0 && <div className="self-stretch w-px bg-gray-700" />}
                  {renderGroupContent(group)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PreviewButton({
  panelKey: k,
  selected,
  onClick,
}: {
  panelKey: PanelKey;
  selected: boolean;
  onClick: () => void;
}) {
  const colorConfig: Record<PanelKeyColor, { bg: string; border: string; text: string }> = {
    green: { bg: 'from-green-600 to-green-700', border: 'border-green-500/60', text: 'text-green-50' },
    yellow: { bg: 'from-yellow-600 to-yellow-700', border: 'border-yellow-500/60', text: 'text-yellow-50' },
    red: { bg: 'from-red-600 to-red-700', border: 'border-red-500/60', text: 'text-red-50' },
    blue: { bg: 'from-blue-600 to-blue-700', border: 'border-blue-500/60', text: 'text-blue-50' },
    gray: { bg: 'from-gray-600 to-gray-700', border: 'border-gray-500/60', text: 'text-gray-100' },
  };

  const c = colorConfig[k.color];

  const sizeConfig: Record<string, { w: string; h: string; font: string }> = {
    small:  { w: 'w-[56px]', h: 'h-[70px]', font: 'text-[9px]' },
    normal: { w: 'w-[70px]', h: 'h-[86px]', font: 'text-[10px]' },
    wide:   { w: 'w-[110px]', h: 'h-[86px]', font: 'text-[10px]' },
    large:  { w: 'w-[80px]', h: 'h-[96px]', font: 'text-[11px]' },
  };
  const sz = sizeConfig[k.size] || sizeConfig.normal;

  return (
    <button
      onClick={onClick}
      className={`relative ${sz.w} ${sz.h} rounded-lg border bg-gradient-to-b ${c.bg} ${c.border}
        flex flex-col items-center justify-center shrink-0 transition-all
        shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_2px_4px_rgba(0,0,0,0.4)]
        ${selected ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-gray-900' : ''}`}
    >
      {k.hasLamp && (
        <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full border bg-gray-800 border-gray-600" />
      )}
      <span className={`${c.text} ${sz.font} font-semibold leading-tight text-center drop-shadow-sm px-1`}>
        {k.label}
      </span>
    </button>
  );
}

// ── Group Property Editor ────────────────────────────────

function GroupPropertyEditor({
  group,
  isFirst,
  onUpdateName,
  onUpdateSameRow,
  onUpdateStyle,
}: {
  group: PanelGroup;
  isFirst: boolean;
  onUpdateName: (name: string) => void;
  onUpdateSameRow: (v: boolean) => void;
  onUpdateStyle: (updates: Partial<PanelGroup>) => void;
}) {
  const curAlign = group.nameAlign || 'left';
  const curSize = group.nameFontSize || 'xs';
  const curWeight = group.nameFontWeight || 'semibold';
  const curColor = group.nameColor || 'gray';

  return (
    <div className="max-w-md space-y-5">
      <h3 className="text-sm font-semibold text-gray-300">그룹 설정</h3>

      {/* 그룹명 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">그룹명</label>
        <input
          type="text"
          value={group.name}
          onChange={(e) => onUpdateName(e.target.value)}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white"
        />
      </div>

      {/* 그룹명 미리보기 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">그룹명 미리보기</label>
        <div className={`px-3 py-2 bg-gray-800 border border-gray-700 rounded ${GN_ALIGN_CLS[curAlign]}`}>
          <span className={`${GN_SIZE_CLS[curSize]} ${GN_WEIGHT_CLS[curWeight]} ${GN_COLOR_CLS[curColor]} tracking-widest uppercase`}>
            {group.name || '(빈 이름)'}
          </span>
        </div>
      </div>

      {/* 정렬 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">정렬</label>
        <div className="flex gap-1">
          {NAME_ALIGN_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onUpdateStyle({ nameAlign: opt.value })}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                curAlign === opt.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
              }`}
              title={opt.value}
            >
              {opt.icon}
            </button>
          ))}
        </div>
      </div>

      {/* 글씨 크기 + 굵기 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">글씨 크기</label>
          <div className="flex gap-1">
            {NAME_SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onUpdateStyle({ nameFontSize: opt.value })}
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  curSize === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">굵기</label>
          <div className="flex gap-1">
            {NAME_WEIGHT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onUpdateStyle({ nameFontWeight: opt.value })}
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  curWeight === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 글씨 색상 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">글씨 색상</label>
        <div className="flex gap-2">
          {NAME_COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onUpdateStyle({ nameColor: opt.value })}
              className={`w-7 h-7 rounded-full ${opt.cls} border-2 transition-all ${
                curColor === opt.value ? 'border-blue-400 scale-110' : 'border-transparent opacity-60 hover:opacity-100'
              }`}
              title={opt.label}
            />
          ))}
        </div>
      </div>

      {/* 같은 줄 배치 토글 */}
      {!isFirst && (
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={group.sameRowAsPrev ?? false}
              onChange={(e) => onUpdateSameRow(e.target.checked)}
              className="accent-blue-600 w-4 h-4"
            />
            <span className="text-sm text-gray-300">이전 그룹과 같은 줄에 배치</span>
          </label>
          <p className="text-[10px] text-gray-600 mt-1 ml-6">
            활성화하면 위 그룹 옆에 세로 구분선과 함께 나란히 표시됩니다
          </p>
        </div>
      )}

      <div className="text-xs text-gray-500">
        키 {group.keys.length}개
      </div>
    </div>
  );
}

// ── Key Property Editor ──────────────────────────────────

function KeyPropertyEditor({
  panelKey: k,
  groupName,
  onUpdateGroup,
  onUpdate,
}: {
  panelKey: PanelKey;
  groupName: string;
  onUpdateGroup: (name: string) => void;
  onUpdate: (updates: Partial<PanelKey>) => void;
}) {
  return (
    <div className="max-w-lg space-y-5">
      <h3 className="text-sm font-semibold text-gray-300">키 속성 편집</h3>

      {/* 소속 그룹 */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">소속 그룹</label>
          <input
            type="text"
            value={groupName}
            onChange={(e) => onUpdateGroup(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white"
          />
        </div>
      </div>

      {/* 명칭 */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">명칭</label>
        <input
          type="text"
          value={k.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white"
        />
      </div>

      {/* 색상 + 크기 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">색상</label>
          <div className="flex gap-2">
            {COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onUpdate({ color: opt.value })}
                className={`w-7 h-7 rounded-full ${opt.cls} border-2 transition-all ${
                  k.color === opt.value ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'
                }`}
                title={opt.label}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">크기</label>
          <div className="flex gap-1.5">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onUpdate({ size: opt.value })}
                className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                  k.size === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
                }`}
                title={opt.desc}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 mt-1">
            S: 소형 / M: 기본 / W: 넓은 / L: 대형
          </p>
        </div>
      </div>

      {/* 램프 */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={k.hasLamp}
            onChange={(e) => onUpdate({ hasLamp: e.target.checked })}
            className="accent-blue-600 w-4 h-4"
          />
          <span className="text-sm text-gray-300">램프 표시</span>
        </label>
      </div>

      {/* PMC 주소 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">PMC Out (Write)</label>
          <input
            type="text"
            value={k.reqAddr}
            onChange={(e) => onUpdate({ reqAddr: e.target.value })}
            placeholder="Y0030.0"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">PMC Lamp (Read)</label>
          <input
            type="text"
            value={k.lampAddr}
            onChange={(e) => onUpdate({ lampAddr: e.target.value })}
            placeholder="R6004.0"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm text-white font-mono"
          />
        </div>
      </div>

      {/* 타이밍 */}
      <div>
        <label className="block text-xs text-gray-500 mb-2">타이밍</label>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] text-gray-600 mb-0.5">롱프레스 (ms)</label>
            <input
              type="number"
              value={k.timing.longPressMs}
              onChange={(e) => onUpdate({ timing: { ...k.timing, longPressMs: parseInt(e.target.value) || 0 } })}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white font-mono text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-0.5">홀드 (ms)</label>
            <input
              type="number"
              value={k.timing.holdMs}
              onChange={(e) => onUpdate({ timing: { ...k.timing, holdMs: parseInt(e.target.value) || 0 } })}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white font-mono text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-0.5">타임아웃 (ms)</label>
            <input
              type="number"
              value={k.timing.timeoutMs}
              onChange={(e) => onUpdate({ timing: { ...k.timing, timeoutMs: parseInt(e.target.value) || 0 } })}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-white font-mono text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
