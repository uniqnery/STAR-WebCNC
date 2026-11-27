export function websocketUrl(location: Pick<Location, 'protocol' | 'host' | 'hostname'>, apiUrl = '', wsUrl = ''): string {
  if (wsUrl) {
    const url = new URL(wsUrl);
    if (location.protocol === 'https:' && url.protocol === 'ws:') url.protocol = 'wss:';
    return url.toString();
  }
  if (apiUrl) {
    const url = new URL(apiUrl);
    url.protocol = location.protocol === 'https:' || url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws'; url.search = ''; url.hash = '';
    return url.toString();
  }
  return location.protocol === 'https:' ? `wss://${location.host}/ws` : `ws://${location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname}:3000/ws`;
}
