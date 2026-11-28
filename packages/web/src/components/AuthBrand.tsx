export function AuthBrand({ compact = false }: { compact?: boolean }) {
  return <div className={`text-center ${compact ? 'mb-16' : 'mb-8'}`}><div className={`mx-auto inline-grid max-w-full ${compact ? 'gap-2 text-base leading-6 sm:text-xl sm:leading-6' : 'gap-3 text-2xl sm:text-3xl'}`}>
    <div className="relative aspect-[817/287] w-full"><img src="/star.png" alt="Star" className="absolute inset-0 h-full w-full object-contain brightness-0 invert" /></div>
    <h1 className="font-bold text-gray-900 dark:text-white whitespace-nowrap">Smart Thinking Pro V2.0</h1>
  </div></div>;
}
