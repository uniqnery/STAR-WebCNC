import { expect, it } from 'vitest';
import { dashboardPrograms } from '../../web/src/lib/dashboardDisplay';
import type { TelemetryData } from '../../web/src/stores/machineStore';
it('provides both path rows and empty comment spaces without data', () => {
  expect(dashboardPrograms()).toEqual([{label:'Path1',number:'',comment:''},{label:'Path2',number:'',comment:''}]);
});
it('pairs each comment with its own program and does not use generic product names', () => {
  const rows = dashboardPrograms({programNo:'O1001',productName:'MES product',path1:{programNo:'O1001',programComment:' A '},path2:{programNo:'O2001',programComment:'B'}} as TelemetryData);
  expect(rows.map(r=>[r.number,r.comment])).toEqual([['O1001','A'],['O2001','B']]);
});
it('clears a previous path1 comment when basic telemetry changes the program number', () => {
  expect(dashboardPrograms({programNo:'O1002',path1:{programNo:'O1001',programComment:'old'}} as TelemetryData)[0]).toMatchObject({number:'O1002',comment:''});
});
