import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface ContextMenuProps {
  x: number;
  y: number;
  children: ReactNode;
  onPointerDown?: (e: React.PointerEvent) => void;
  className?: string;
  style?: CSSProperties;
  [key: string]: any;
}

/**
 * Context menu positioned with viewport boundary clamping and smart flipping (Horizontal-First).
 * Prevents menu items from extending off-screen at window edges or bottom toolbars.
 */
export function ContextMenu({ x, y, children, onPointerDown, className, style, ...rest }: ContextMenuProps) {
  const ref = useRef<HTMLUListElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const PADDING = 8;

    let newLeft = x;
    let newTop = y;

    // Vertical boundary: if overflowing bottom of viewport
    if (newTop + rect.height > vh - PADDING) {
      if (y - rect.height >= PADDING) {
        newTop = y - rect.height; // flip above cursor
      } else {
        newTop = Math.max(PADDING, vh - rect.height - PADDING); // clamp inside viewport
      }
    }

    // Horizontal boundary: if overflowing right edge of viewport
    if (newLeft + rect.width > vw - PADDING) {
      if (x - rect.width >= PADDING) {
        newLeft = x - rect.width; // flip left of cursor
      } else {
        newLeft = Math.max(PADDING, vw - rect.width - PADDING); // clamp inside viewport
      }
    }

    // Ensure not off top or left
    if (newTop < PADDING) newTop = PADDING;
    if (newLeft < PADDING) newLeft = PADDING;

    setCoords({ left: newLeft, top: newTop });
  }, [x, y]);

  return (
    <ul
      ref={ref}
      className={`context-menu ${className ?? ''}`}
      style={{ ...style, left: coords.left, top: coords.top }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown?.(e);
      }}
      {...rest}
    >
      {children}
    </ul>
  );
}
