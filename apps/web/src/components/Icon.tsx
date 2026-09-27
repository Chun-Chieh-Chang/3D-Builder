import type { ReactElement } from 'react';

type IconName = 'part' | 'origin' | 'plane' | 'sketch' | 'extrude' | 'revolve' | 'fillet' | 'chamfer' | 'error' | 'ok' | 'cancel';

const PATHS: Record<IconName, ReactElement> = {
  part: <path d="M3 5l5-3 5 3v6l-5 3-5-3z M3 5l5 3 5-3 M8 8v6" />,
  origin: <path d="M8 2v12 M2 8h12 M8 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0" />,
  plane: <path d="M4 4h10l-2 8H2z" />,
  sketch: <path d="M2 14l3-1 8-8-2-2-8 8z M10 4l2 2" />,
  extrude: <path d="M3 6h7v7H3z M3 6l3-3h7L10 6 M13 3v7l-3 3" />,
  revolve: <path d="M8 1.5v13 M3 6a5 2.5 0 1 0 10 0 M11.5 3.2l1.5 2.8-3 0.4" />,
  fillet: <path d="M3 13V3 M3 13h10 M3 7a6 6 0 0 0 6 6" />,
  chamfer: <path d="M3 13V7l4-4h6 M3 13h10V3" />,
  error: <path d="M8 2l6.5 11h-13z M8 6v3.5 M8 11.5v0.5" />,
  ok: <path d="M3 8.5l3 3 7-7" />,
  cancel: <path d="M4 4l8 8 M12 4l-8 8" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className ?? ''}`} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
