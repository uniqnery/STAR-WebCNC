/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Status Colors
        'status-run': '#22c55e',      // Green - Running
        'status-stop': '#f59e0b',     // Amber - Stopped
        'status-alarm': '#ef4444',    // Red - Alarm
        'status-offline': '#6b7280',  // Gray - Offline
        // Brand Colors
        'primary': '#2563eb',
        'secondary': '#64748b',
      },
    },
  },
  plugins: [],
}
