// MachineAdmin.tsx - 설비 등록/삭제 관리 (HQ_ENGINEER 전용)

import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMachineStore, Machine } from '../stores/machineStore';
import { useTemplateStore } from '../stores/templateStore';
import { machineApi } from '../lib/api';

// ── 등록 폼 초기값 ─────────────────────────────────────────
const EMPTY_FORM = {
  machineId: '',
  name: '',
  ipAddress: '',
  port: '8193',
  serialNumber: '',
  location: '',
  templateId: '',
};

type FormData = typeof EMPTY_FORM;

// ── 유효성 검사 ────────────────────────────────────────────
function validate(form: FormData, machines: Machine[]): string | null {
  if (!form.name.trim()) return '설비명을 입력하세요.';
  if (!form.machineId.trim()) return '설비 번호를 입력하세요.';
  if (machines.some((m) => m.machineId === form.machineId.trim()))
    return '이미 사용 중인 설비 번호입니다.';
  if (!form.ipAddress.trim()) return 'IP 주소를 입력하세요.';
  const port = parseInt(form.port);
  if (!form.port || isNaN(port) || port < 1 || port > 65535)
    return '유효한 포트 번호를 입력하세요 (1~65535).';
  if (!form.serialNumber.trim()) return 'CNC 시리얼번호를 입력하세요.';
  if (!form.templateId) return '템플릿을 선택하세요.';
  return null;
}

// ── 메인 컴포넌트 ──────────────────────────────────────────
export function MachineAdmin() {
  const user = useAuthStore((s) => s.user);
  const { machines, addMachine, deleteMachine } = useMachineStore();
  const { templates, loadTemplates } = useTemplateStore();

  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Machine | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (templates.length === 0) loadTemplates();
  }, [templates.length, loadTemplates]);

  // 권한 확인
  if (user?.role !== 'HQ_ENGINEER') {
    return (
      <div className="p-6">
        <div className="bg-red-900/20 text-red-400 p-4 rounded-lg text-sm">
          HQ 엔지니어 전용 페이지입니다. 접근 권한이 없습니다.
        </div>
      </div>
    );
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate(form, machines);
    if (err) { setFormError(err); return; }

    setIsSubmitting(true);
    try {
      const selectedTemplate = templates.find((t) => t.id === form.templateId);
      const payload = {
        machineId: form.machineId.trim(),
        name: form.name.trim(),
        ipAddress: form.ipAddress.trim(),
        port: parseInt(form.port),
        serialNumber: form.serialNumber.trim(),
        location: form.location.trim() || undefined,
        templateId: form.templateId,
      };

      const res = await machineApi.create(payload);

      if (res.success && res.data) {
        // 서버 응답으로 반영 (ID가 실제 DB id)
        const serverMachine = res.data as Machine;
        addMachine({
          ...serverMachine,
          pathCount: selectedTemplate?.systemInfo.maxPaths ?? 2,
          template: selectedTemplate
            ? {
                templateId: selectedTemplate.templateId,
                name: selectedTemplate.name,
                cncType: selectedTemplate.systemInfo.cncType,
                seriesName: selectedTemplate.systemInfo.seriesName,
              }
            : undefined,
          realtime: { status: 'offline' },
        });
      } else {
        // 서버 에러 메시지 표시, 로컬 폴백
        if (res.error?.message) {
          setFormError(res.error.message);
          return;
        }
        // 서버 미연결 폴백: 로컬에만 추가
        addMachine({
          id: `local-${Date.now()}`,
          machineId: payload.machineId,
          name: payload.name,
          ipAddress: payload.ipAddress,
          port: payload.port,
          serialNumber: payload.serialNumber,
          location: payload.location,
          isActive: true,
          pathCount: selectedTemplate?.systemInfo.maxPaths ?? 2,
          template: selectedTemplate
            ? {
                templateId: selectedTemplate.templateId,
                name: selectedTemplate.name,
                cncType: selectedTemplate.systemInfo.cncType,
                seriesName: selectedTemplate.systemInfo.seriesName,
              }
            : undefined,
          realtime: { status: 'offline' },
        });
      }

      setForm(EMPTY_FORM);
      setShowForm(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await machineApi.delete(deleteTarget.id).catch(() => null);
    if (res && !res.success && res.error?.message) {
      alert(res.error.message);
      return;
    }
    deleteMachine(deleteTarget.machineId);
    setDeleteTarget(null);
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg ' +
    'bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-500';

  const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">설비 관리</h1>
          <p className="text-sm text-gray-500 mt-1">설비 등록 및 삭제 (HQ 엔지니어 전용)</p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setFormError(''); setForm(EMPTY_FORM); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700
                     text-white text-sm font-medium rounded-lg transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          설비 등록
        </button>
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">신규 설비 등록</h2>

          {formError && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700
                            text-red-700 dark:text-red-400 text-sm rounded">
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-4">
              {/* 템플릿 */}
              <div className="col-span-2">
                <label className={labelCls}>
                  템플릿 <span className="text-red-500">*</span>
                </label>
                <select
                  name="templateId"
                  value={form.templateId}
                  onChange={handleChange}
                  className={inputCls}
                  required
                >
                  <option value="">템플릿 선택...</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.systemInfo.cncType} {t.systemInfo.seriesName}
                      {' '}(경로 수: {t.systemInfo.maxPaths})
                    </option>
                  ))}
                </select>
                {form.templateId && (() => {
                  const t = templates.find((t) => t.id === form.templateId);
                  return t ? (
                    <p className="mt-1 text-xs text-gray-400">
                      CNC 모델: {t.systemInfo.modelName} · 최대 경로: {t.systemInfo.maxPaths}
                    </p>
                  ) : null;
                })()}
              </div>

              {/* 설비명 */}
              <div>
                <label className={labelCls}>
                  설비명 <span className="text-red-500">*</span>
                </label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="예: 1호기 자동선반"
                  required
                />
              </div>

              {/* 설비 번호 */}
              <div>
                <label className={labelCls}>
                  설비 번호 <span className="text-red-500">*</span>
                </label>
                <input
                  name="machineId"
                  value={form.machineId}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="예: MC-005"
                  required
                />
              </div>

              {/* IP 주소 */}
              <div>
                <label className={labelCls}>
                  IP 주소 <span className="text-red-500">*</span>
                </label>
                <input
                  name="ipAddress"
                  value={form.ipAddress}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="예: 192.168.1.105"
                  required
                />
              </div>

              {/* 포트 */}
              <div>
                <label className={labelCls}>
                  포트 번호 <span className="text-red-500">*</span>
                </label>
                <input
                  name="port"
                  type="number"
                  value={form.port}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="8193"
                  min={1}
                  max={65535}
                  required
                />
              </div>

              {/* 시리얼번호 */}
              <div>
                <label className={labelCls}>
                  CNC 시리얼번호 <span className="text-red-500">*</span>
                </label>
                <input
                  name="serialNumber"
                  value={form.serialNumber}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="예: F0T-12345"
                  required
                />
              </div>

              {/* 위치/라인명 */}
              <div>
                <label className={labelCls}>설비 위치/라인명</label>
                <input
                  name="location"
                  value={form.location}
                  onChange={handleChange}
                  className={inputCls}
                  placeholder="예: A라인 3번"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 mt-5">
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400
                           text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isSubmitting ? '등록 중...' : '등록 완료'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(''); setForm(EMPTY_FORM); }}
                className="px-5 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600
                           text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
              >
                취소
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 설비 목록 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">설비 번호</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">설비명</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">IP / 포트</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">템플릿</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">CNC 모델</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">시리얼</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">위치</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">상태</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {machines.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">
                  등록된 설비가 없습니다.
                </td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">{m.machineId}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white">{m.name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono">
                    {m.ipAddress}:{m.port}
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                    {(() => {
                      const tpl = templates.find((t) => t.templateId === m.template?.templateId);
                      const displayName = tpl?.name ?? m.template?.name;
                      return displayName
                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded-full font-medium">{displayName}</span>
                        : <span className="text-gray-300 dark:text-gray-600">—</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {(() => {
                      const tpl = templates.find((t) => t.templateId === m.template?.templateId);
                      const cncType = tpl?.systemInfo.cncType ?? m.template?.cncType;
                      const seriesName = tpl?.systemInfo.seriesName ?? m.template?.seriesName;
                      return cncType
                        ? `${cncType} ${seriesName}`
                        : <span className="text-gray-300 dark:text-gray-600">—</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                    {m.serialNumber || <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {m.location || <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                      m.realtime?.status === 'online'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        m.realtime?.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                      }`} />
                      {m.realtime?.status === 'online' ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDeleteTarget(m)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                                 rounded transition-colors"
                      title="설비 삭제"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">설비 삭제 확인</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              아래 설비를 삭제하시겠습니까?
            </p>
            <div className="bg-gray-50 dark:bg-gray-700 rounded p-3 mb-4 text-sm">
              <p className="font-medium text-gray-900 dark:text-white">{deleteTarget.name}</p>
              <p className="text-gray-500">{deleteTarget.machineId} · {deleteTarget.ipAddress}</p>
            </div>
            <p className="text-xs text-red-500 mb-4">이 작업은 되돌릴 수 없습니다.</p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium
                           rounded-lg transition-colors"
              >
                삭제
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600
                           text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Icons
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
