// InterlockEditor - 탑바 인터록 pills 편집기 (/admin/interlocks)
// 페이지별 인터록 항목(PMC 주소 기반) 및 전체 활성화/비활성화 관리

import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import {
  useTemplateStore,
  type TopBarInterlockConfig,
  type TopBarInterlockPageConfig,
  type TopBarInterlockField,
} from '../stores/templateStore';

type TabId = 'remote' | 'scheduler' | 'transfer' | 'backup';

const TABS: { id: TabId; label: string; desc: string }[] = [
  { id: 'remote',    label: '원격 조작반', desc: '원격 조작반 탑바 우측 인터록 pills' },
  { id: 'scheduler', label: '스케줄러',    desc: '스케줄러 탑바 우측 인터록 pills' },
  { id: 'transfer',  label: '파일 전송',   desc: '파일 전송 탑바 우측 인터록 pills' },
  { id: 'backup',    label: '백업',        desc: '백업 탑바 우측 인터록 pills' },
];

const EMPTY_PAGE: TopBarInterlockPageConfig = { interlockEnabled: true, fields: [] };

const EMPTY_CONFIG: TopBarInterlockConfig = {
  remote:    { ...EMPTY_PAGE },
  scheduler: { ...EMPTY_PAGE },
  transfer:  { ...EMPTY_PAGE },
  backup:    { ...EMPTY_PAGE },
};

function uid() {
  return `tbi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── Main Component ──────────────────────────────────────
export function InterlockEditor() {
  const user = useAuthStore((s) => s.user);
  const {
    templates,
    selectedTemplateId,
    loadTemplates,
    selectTemplate,
    updateTemplate,
    importFromJsonc,
  } = useTemplateStore();

  const [activeTab, setActiveTab] = useState<TabId>('remote');
  const [dirty, setDirty] = useState(false);
  const [config, setConfig] = useState<TopBarInterlockConfig>(EMPTY_CONFIG);

  const canEdit = user?.role === 'ADMIN' || user?.role === 'HQ_ENGINEER';

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  useEffect(() => {
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (tpl) {
      const tbi = tpl.topBarInterlock;
      setConfig(structuredClone({
        remote:    tbi?.remote    ?? { ...EMPTY_PAGE },
        scheduler: tbi?.scheduler ?? { ...EMPTY_PAGE },
        transfer:  tbi?.transfer  ?? { ...EMPTY_PAGE },
        backup:    tbi?.backup    ?? { ...EMPTY_PAGE },
      }));
      setDirty(false);
    }
  }, [selectedTemplateId, templates]);

  const handleSave = () => {
    if (!selectedTemplateId) return;
    updateTemplate(selectedTemplateId, { topBarInterlock: config });
    setDirty(false);
  };

  const updatePage = (tab: TabId, page: TopBarInterlockPageConfig) => {
    setConfig((prev) => ({ ...prev, [tab]: page }));
    setDirty(true);
  };

  const selectedTpl = templates.find((t) => t.id === selectedTemplateId);

  if (!canEdit) {
    return (
      <div className="p-6">
        <div className="bg-red-900/20 text-red-400 p-6 rounded-lg">
          관리자 또는 HQ 엔지니어만 접근할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-gray-900 text-white">
      {/* ── Left Sidebar ── */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-700">
          <h2 className="text-sm font-bold text-gray-200">인터록 편집기</h2>
          <p className="text-[10px] text-gray-500 mt-0.5">탑바 인터록 pills 설정</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {templates.map((tpl) => {
            const tbi = tpl.topBarInterlock;
            const totalFields =
              (tbi?.remote?.fields?.length ?? 0) +
              (tbi?.scheduler?.fields?.length ?? 0) +
              (tbi?.transfer?.fields?.length ?? 0) +
              (tbi?.backup?.fields?.length ?? 0);
            return (
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
                  <span className="text-[10px] opacity-60">총 {totalFields}개 pills</span>
                </div>
              </button>
            );
          })}
          {templates.length === 0 && (
            <div className="p-3 text-center text-gray-600 text-xs">템플릿 없음</div>
          )}
        </div>

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
          <div>
            <span className="text-sm font-semibold text-gray-200">
              {selectedTpl?.name || '(템플릿 선택)'}
            </span>
            <p className="text-[10px] text-gray-500 mt-0.5">
              PMC 주소 기반 인터록 조건 — 각 페이지 탑바 우측 pills로 표시됩니다
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {dirty && <span className="text-xs text-yellow-400">* 변경사항 있음</span>}
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              저장
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 flex-shrink-0 px-4">
          {TABS.map((tab) => {
            const page = config[tab.id];
            const fieldCount = page?.fields?.length ?? 0;
            const enabled = page?.interlockEnabled ?? true;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.desc}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab.label}
                {!enabled && (
                  <span className="text-[10px] bg-gray-700 text-gray-400 rounded px-1.5 py-0.5">OFF</span>
                )}
                {enabled && fieldCount > 0 && (
                  <span className="text-[10px] bg-blue-600/30 text-blue-400 rounded px-1.5 py-0.5">
                    {fieldCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedTpl ? (
            <InterlockPageTab
              key={activeTab}
              tabLabel={TABS.find((t) => t.id === activeTab)!.label}
              page={config[activeTab] ?? { ...EMPTY_PAGE }}
              onChange={(page) => updatePage(activeTab, page)}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              좌측에서 템플릿을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 페이지별 인터록 편집 탭 ────────────────────────────

function InterlockPageTab({
  tabLabel,
  page,
  onChange,
}: {
  tabLabel: string;
  page: TopBarInterlockPageConfig;
  onChange: (page: TopBarInterlockPageConfig) => void;
}) {
  const setEnabled = (interlockEnabled: boolean) => onChange({ ...page, interlockEnabled });
  const setFields = (fields: TopBarInterlockField[]) => onChange({ ...page, fields });

  const updateField = (idx: number, patch: Partial<TopBarInterlockField>) =>
    setFields(page.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const removeField = (idx: number) => setFields(page.fields.filter((_, i) => i !== idx));

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...page.fields];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setFields(next);
  };

  const moveDown = (idx: number) => {
    if (idx === page.fields.length - 1) return;
    const next = [...page.fields];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setFields(next);
  };

  const addField = () =>
    setFields([...page.fields, { id: uid(), label: '새 항목', pmcAddr: '', contact: 'A', enabled: true }]);

  return (
    <div className="max-w-4xl space-y-5">
      {/* ── 전체 인터록 활성화/비활성화 ── */}
      <div className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
        page.interlockEnabled
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-800/50 border-gray-700/50'
      }`}>
        <div
          onClick={() => setEnabled(!page.interlockEnabled)}
          className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 ${
            page.interlockEnabled ? 'bg-blue-600' : 'bg-gray-600'
          }`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow ${
            page.interlockEnabled ? 'translate-x-5' : 'translate-x-1'
          }`} />
        </div>
        <div>
          <div className="text-sm font-medium">
            {tabLabel} 인터록{' '}
            <span className={page.interlockEnabled ? 'text-blue-400' : 'text-gray-500'}>
              {page.interlockEnabled ? '활성화' : '비활성화'}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {page.interlockEnabled
              ? '아래 조건을 모두(AND) 만족해야 실행이 허용됩니다. 탑바에 상태 pills를 표시합니다.'
              : '비활성화 시 인터록 검사 없이 항상 실행이 허용됩니다. 탑바에는 「인터록 OFF」와 현재 신호 상태가 표시됩니다.'}
          </div>
        </div>
      </div>

      {/* ── 인터록 항목 테이블 ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">인터록 항목 (PMC 주소 기반)</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              A접 = 신호 1(ON)이면 정상 🟢 &nbsp;·&nbsp; B접 = 신호 0(OFF)이면 정상 🟢
            </p>
          </div>
          <button
            onClick={addField}
            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + 항목 추가
          </button>
        </div>

        {page.fields.length === 0 ? (
          <div className="border border-dashed border-gray-700 rounded-lg p-10 text-center text-gray-600 text-sm">
            인터록 항목이 없습니다.
            <br />
            <button onClick={addField} className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline">
              + 첫 번째 항목 추가
            </button>
          </div>
        ) : (
          <div className="border border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 border-b border-gray-700 text-xs text-gray-400">
                  <th className="px-3 py-2.5 text-left w-8">#</th>
                  <th className="px-3 py-2.5 text-left">명칭</th>
                  <th className="px-3 py-2.5 text-left w-36">PMC 주소</th>
                  <th className="px-3 py-2.5 text-center w-20">접점</th>
                  <th className="px-3 py-2.5 text-center w-16">표시</th>
                  <th className="px-3 py-2.5 text-center w-20">순서</th>
                  <th className="px-3 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {page.fields.map((field, idx) => (
                  <tr key={field.id} className={`border-b border-gray-800 last:border-0 ${
                    field.enabled ? 'hover:bg-gray-800/40' : 'opacity-40 hover:bg-gray-800/20'
                  }`}>
                    <td className="px-3 py-2 text-xs text-gray-600">{idx + 1}</td>

                    {/* 명칭 */}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => updateField(idx, { label: e.target.value })}
                        placeholder="예: 안전도어"
                        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:border-blue-500 focus:outline-none"
                      />
                    </td>

                    {/* PMC 주소 */}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={field.pmcAddr}
                        onChange={(e) => updateField(idx, { pmcAddr: e.target.value })}
                        placeholder="R6001.3"
                        className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white font-mono focus:border-blue-500 focus:outline-none"
                      />
                    </td>

                    {/* 접점 A/B */}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => updateField(idx, { contact: field.contact === 'A' ? 'B' : 'A' })}
                        className={`px-3 py-1 rounded text-xs font-bold border transition-colors ${
                          field.contact === 'A'
                            ? 'bg-green-600/20 text-green-400 border-green-700 hover:bg-green-600/30'
                            : 'bg-orange-600/20 text-orange-400 border-orange-700 hover:bg-orange-600/30'
                        }`}
                        title={field.contact === 'A' ? 'A접: 신호 ON이면 정상' : 'B접: 신호 OFF이면 정상'}
                      >
                        {field.contact}접
                      </button>
                    </td>

                    {/* 표시 여부 */}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => updateField(idx, { enabled: !field.enabled })}
                        className={`relative w-9 h-5 rounded-full transition-colors ${
                          field.enabled ? 'bg-blue-600' : 'bg-gray-600'
                        }`}
                        title={field.enabled ? '표시 중' : '숨김'}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow ${
                          field.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        }`} />
                      </button>
                    </td>

                    {/* 순서 */}
                    <td className="px-2 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white disabled:opacity-30"
                          title="위로"
                        >▲</button>
                        <button
                          onClick={() => moveDown(idx)}
                          disabled={idx === page.fields.length - 1}
                          className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white disabled:opacity-30"
                          title="아래로"
                        >▼</button>
                      </div>
                    </td>

                    {/* 삭제 */}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => removeField(idx)}
                        className="text-red-500/60 hover:text-red-400 text-xs px-1"
                        title="삭제"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 bg-gray-800/50 border-t border-gray-700 flex items-center justify-between">
              <button onClick={addField} className="text-xs text-blue-400 hover:text-blue-300">
                + 항목 추가
              </button>
              <span className="text-[10px] text-gray-600">
                ※ A접: 신호 1(ON)=정상 · B접: 신호 0(OFF)=정상 · 통신 단절 시 0으로 처리
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── 미리보기 ── */}
      {page.fields.some((f) => f.enabled) && (
        <div className="p-3 bg-gray-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs text-gray-500 font-semibold">탑바 미리보기</p>
            {!page.interlockEnabled && (
              <span className="text-[10px] bg-yellow-600/20 text-yellow-400 border border-yellow-700/50 rounded px-1.5 py-0.5">
                인터록 OFF
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {page.fields.filter((f) => f.enabled).map((f) => (
              <div
                key={f.id}
                className="px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1 bg-gray-700 text-gray-400"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                {f.label || '(명칭 없음)'}
                <span className="text-[9px] text-gray-600 ml-0.5">{f.contact}접</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
