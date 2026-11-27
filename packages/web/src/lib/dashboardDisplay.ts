import type { TelemetryData } from '../stores/machineStore';

export function dashboardPrograms(telemetry?: TelemetryData) {
  const first = telemetry?.programNo || telemetry?.path1?.programNo || '';
  const second = telemetry?.path2?.programNo || '';
  const comment = (path: TelemetryData['path1'], number: string) =>
    number && path?.programNo === number ? path.programComment?.trim() ?? '' : '';
  return [
    { label: 'Path1', number: first, comment: comment(telemetry?.path1, first) },
    { label: 'Path2', number: second, comment: comment(telemetry?.path2, second) },
  ];
}
