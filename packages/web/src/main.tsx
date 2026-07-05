import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

const VIEWPORT_ALLOW_ZOOM = 'width=device-width, initial-scale=1.0, viewport-fit=cover';
const VIEWPORT_RESET_ZOOM = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover';

function installOrientationZoomReset() {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
  if (!viewport || !isTouchDevice) return;

  let resetTimer: number | undefined;

  const resetViewportZoom = () => {
    window.clearTimeout(resetTimer);
    viewport.setAttribute('content', VIEWPORT_RESET_ZOOM);
    window.scrollTo(0, 0);
    resetTimer = window.setTimeout(() => {
      viewport.setAttribute('content', VIEWPORT_ALLOW_ZOOM);
    }, 350);
  };

  window.addEventListener('orientationchange', resetViewportZoom, { passive: true });
  window.screen.orientation?.addEventListener?.('change', resetViewportZoom);
}

installOrientationZoomReset();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
