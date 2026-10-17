import { useRef } from "react";

type Props = {
  label: string;
  width: number;
  min: number;
  max: number;
  /** Width to return to on double-click. */
  initial: number;
  /** Called on every move; `commit` is true once the drag or key press ends. */
  onWidth: (width: number, commit: boolean) => void;
};

const KEY_STEP = 16;

/** Sits on a pane's left edge: dragging left widens the pane. Invisible until
 *  pointed at, so the panes stay separated by tone rather than a line. */
export function PaneResizer({ label, width, min, max, initial, onWidth }: Props) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title="拖动调整宽度，双击恢复默认"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onWidth(clamp(drag.current.width + drag.current.x - event.clientX), false);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        onWidth(clamp(drag.current.width + drag.current.x - event.clientX), true);
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => onWidth(initial, true)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onWidth(clamp(width + KEY_STEP), true);
        else if (event.key === "ArrowRight") onWidth(clamp(width - KEY_STEP), true);
        else return;
        event.preventDefault();
      }}
      className="group absolute inset-y-0 -left-1 z-10 flex w-2 cursor-col-resize touch-none justify-center outline-none select-none"
    >
      <span className="h-full w-px bg-transparent transition-colors group-hover:bg-border group-focus-visible:bg-ring group-active:bg-ring" />
    </div>
  );
}
