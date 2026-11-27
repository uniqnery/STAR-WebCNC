import { useEffect, useState } from 'react';
import { useMachineStore, useMachineTelemetry } from '../stores/machineStore';
import { useTemplateStore } from '../stores/templateStore';

export function useRemoteInterlock(machineId: string): string | null {
  const machine = useMachineStore(s => s.machines.find(m => m.machineId === machineId));
  const templates = useTemplateStore(s => s.templates);
  const telemetry = useMachineTelemetry(machineId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const page = templates.find(t => t.templateId === machine?.template?.templateId)?.topBarInterlock?.remote;
  if (!page) return '인터록 설정 확인 중';
  if (page.interlockEnabled === false) return null;
  if (!telemetry?.pmcReceivedAt || now - telemetry.pmcReceivedAt > 3500) return '인터록 신호 미수신 또는 만료';
  const fields = page.fields.filter(f => f.enabled);
  const signature = ['1', ...fields.map(f => `${f.pmcAddr.toUpperCase()}:${f.contact.toUpperCase()}`).sort()].join('|');
  if (telemetry.remoteInterlockSignature !== signature) return 'Agent 최신 인터록 설정 적용 대기';
  for (const field of fields) {
    const value = telemetry.pmcBits?.[field.pmcAddr.toUpperCase()];
    if (value !== 0 && value !== 1) return `${field.label}: 신호 확인 불가`;
    if (value !== (field.contact === 'B' ? 0 : 1)) return `${field.label}: 인터록 조건 불만족`;
  }
  return null;
}
