import type { ReactNode } from 'react';
import { AuthBrand } from './AuthBrand';

// Anchor to the initial frame height, so added results grow downward without recentering.
export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="[--auth-card-height:520px] sm:[--auth-card-height:600px] min-h-screen min-h-[100svh] flex items-start justify-center bg-gray-100 dark:bg-gray-900 px-[16px] pb-[32px] dark:text-white"
    style={{ paddingTop: 'max(32px, calc((100svh - var(--auth-card-height) - 3.25rem) / 2))' }}>
    <div className="max-w-[400px] w-full">
      <section aria-label="계정" className="min-h-[var(--auth-card-height)] flex flex-col bg-white dark:bg-gray-800 rounded-xl shadow-lg px-[24px] py-[36px] sm:px-[32px] sm:py-[40px]">
        <div className="shrink-0"><AuthBrand compact /></div>
        <div className="min-w-0 flex-1">{children}</div>
      </section>
      <p className="text-center text-gray-500 text-sm mt-8">&copy; 2026 Star-WebCNC. All rights reserved.</p>
    </div>
  </div>;
}
