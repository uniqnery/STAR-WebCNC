import { expect, it } from 'vitest';
import { websocketUrl } from '../../web/src/lib/websocketUrl';
it('uses public WSS on the HTTPS host without exposing port 3000', () => {
  expect(websocketUrl({protocol:'https:',host:'cnc.example.com',hostname:'cnc.example.com'})).toBe('wss://cnc.example.com/ws');
});
it('keeps local and LAN HTTP connections on the direct API port', () => {
  expect(websocketUrl({protocol:'http:',host:'192.168.0.99:5173',hostname:'192.168.0.99'})).toBe('ws://192.168.0.99:3000/ws');
});
it('supports an explicit separate HTTPS API', () => {
  expect(websocketUrl({protocol:'https:',host:'web.example.com',hostname:'web.example.com'},'https://api.example.com')).toBe('wss://api.example.com/ws');
});
it('honors explicit WS endpoints and never selects mixed-content WS for HTTPS', () => {
  expect(websocketUrl({protocol:'https:',host:'cnc.example.com',hostname:'cnc.example.com'},'','ws://cnc.example.com/ws')).toBe('wss://cnc.example.com/ws');
});
