// TransferArrows - 중앙 전송 화살표 버튼
// 좌측=CNC, 우측=PC 기준
// → (오른쪽): CNC → PC
// ← (왼쪽): PC → CNC

interface TransferArrowsProps {
  canTransferRight: boolean;  // CNC → PC
  canTransferLeft: boolean;   // PC → CNC
  onTransferRight: () => void;
  onTransferLeft: () => void;
  disabled?: boolean;
}

export function TransferArrows({
  canTransferRight,
  canTransferLeft,
  onTransferRight,
  onTransferLeft,
  disabled,
}: TransferArrowsProps) {
  return (
    <div className="flex flex-col items-center justify-center px-3 gap-3">
      {/* CNC → PC (오른쪽 화살표) */}
      <button
        onClick={onTransferRight}
        disabled={disabled || !canTransferRight}
        className="w-10 h-10 flex items-center justify-center rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors shadow"
        title="CNC → PC 전송"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </button>

      {/* PC → CNC (왼쪽 화살표) */}
      <button
        onClick={onTransferLeft}
        disabled={disabled || !canTransferLeft}
        className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors shadow"
        title="PC → CNC 전송"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
        </svg>
      </button>
    </div>
  );
}
