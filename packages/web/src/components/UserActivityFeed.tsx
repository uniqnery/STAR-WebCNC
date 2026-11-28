// 사용자 기록 피드 — 스케줄러/조작반 페이지 공용

import { memo, useEffect, useMemo } from 'react';
import { useMachineStore, useUserActivities, UserActivityPage, UserActivity } from '../stores/machineStore';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: '관리자',
  HQ_ENGINEER: '본사 엔지니어',
  USER: '일반 사용자',
};

const timeFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function getRowStyle(activity: UserActivity): string {
  const a = activity.action;
  if (a.includes('오류') || a.includes('거부')) return 'text-red-400 bg-red-950/30';
  if (a.includes('일시정지') || a.includes('인터록')) return 'text-yellow-300 bg-yellow-950/20';
  return 'text-gray-300';
}

interface UserActivityFeedProps {
  machineId: string;
  page: UserActivityPage;
}

export const UserActivityFeed = memo(function UserActivityFeed({ machineId, page }: UserActivityFeedProps) {
  const activities = useUserActivities(machineId, page);
  const loadUserActivities = useMachineStore((state) => state.loadUserActivities);
  const rows = useMemo(() => activities.map(activity => {
    const date = new Date(activity.timestamp);
    return { activity, time: Number.isFinite(date.getTime()) ? timeFormatter.format(date) : '—' };
  }), [activities]);

  useEffect(() => {
    if (machineId) void loadUserActivities(machineId, page);
  }, [machineId, page, loadUserActivities]);

  if (activities.length === 0) {
    return (
      <div className="text-center text-gray-500 py-4 font-mono text-xs">기록 없음</div>
    );
  }

  return (
    <>
      {rows.map(({ activity: a, time }) => (
        <div
          key={a.id}
          className={`flex items-start gap-2 px-1.5 py-0.5 min-h-[24px] shrink-0 font-mono text-xs ${getRowStyle(a)}`}
        >
          <span className="text-gray-500 tabular-nums w-[72px] shrink-0">
            {time}
          </span>
          <span className="w-[72px] shrink-0 truncate">
            {a.actor ? (ROLE_LABEL[a.actor.role] ?? a.actor.role) : '—'}
          </span>
          <span className="w-[64px] shrink-0 truncate">
            {a.actor?.displayName || a.actor?.username || '—'}
          </span>
          <span className="flex-1 truncate">
            {a.action}
            {a.detail && <span className="text-gray-500 ml-1">({a.detail})</span>}
          </span>
        </div>
      ))}
    </>
  );
});
