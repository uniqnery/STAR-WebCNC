import { it, expect } from 'vitest';
import { formatCounter, parseCounterInput, formatCountDuration, remainingCountSeconds, formatExpectedFinish } from '../../web/src/lib/countDisplay';
it.each([[2000.0000000000002,'2000'],[1999.9999999999998,'2000'],[12.9,'12'],[null,'—'],[NaN,'—']])('formats counter %s without decimals', (value, expected) => expect(formatCounter(value)).toBe(expected));
it.each(['', '-1','1.5','1e3','NaN','2147483648'])('rejects invalid quantity %s', value=>expect(parseCounterInput(value)).toBeNull());
it('accepts zero and integer input',()=>{expect(parseCounterInput('0')).toBe(0);expect(parseCounterInput('2000')).toBe(2000)});
it.each([[126,'2분 6초'],[10810,'3시간 10초'],[8,'8초'],[0,'0초'],[3600,'1시간'],[60,'1분'],[null,'계산 불가']])('omits zero duration units for %s',(value,expected)=>expect(formatCountDuration(value)).toBe(expected));
it('calculates remaining time using normalized counter readings',()=>expect(remainingCountSeconds(2000.0000000000002,1900,126)).toBe(12600));
it('handles goal reached, exceeded and invalid readings',()=>{
 expect(remainingCountSeconds(100,100,126)).toBe(0);expect(remainingCountSeconds(100,101,126)).toBe(0);
 expect(remainingCountSeconds(100,90,0)).toBeNull();expect(remainingCountSeconds(null,90,126)).toBeNull();expect(remainingCountSeconds(100,null,126)).toBeNull();
});
it('formats the Korean completion date across midnight without seconds',()=>{
 expect(formatExpectedFinish(Date.parse('2026-11-26T14:30:00Z'),3600)).toBe('2026-11-27 00:30');
 expect(formatExpectedFinish(0,0)).toBe('목표 수량 도달');expect(formatExpectedFinish(0,null)).toBe('계산 불가');
});
