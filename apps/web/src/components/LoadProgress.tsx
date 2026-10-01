import { t } from '@3db/i18n';
import { useEffect, useState } from 'react';
import { partNameOf } from '@3db/io';
import { useStore } from '../state/store';
import type { PartStage } from '../worker/protocol';
import { PART_STAGE_LABEL } from '../strings';

/** A part file that is being loaded: what is going on and for how many seconds (2F). */
export interface LoadingPart {
  path: string;
  name: string;
  stage: PartStage;
  seconds: number;
}

/** The part files of the open assembly still loading, longest first; the seconds count up while any is. */
export function useLoadingParts(): LoadingPart[] {
  const files = useStore((s) => s.asm?.files);
  const loading = [...(files ?? [])].flatMap(([path, s]) => (s.status === 'loading' ? [{ path, stage: s.stage, since: s.since }] : []));
  const [now, setNow] = useState(() => Date.now());
  const active = loading.length > 0;
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return loading
    .sort((a, b) => a.since - b.since)
    .map((p) => ({ path: p.path, name: partNameOf(p.path), stage: p.stage, seconds: Math.max(0, Math.floor((now - p.since) / 1000)) }));
}

/** 「正在載入」 with the stage and the seconds, as one line of text. */
export const loadingText = (p: LoadingPart) => `${PART_STAGE_LABEL[p.stage]}${p.seconds >= 1 ? ` ${t('load.seconds', { n: p.seconds })}` : ''}`;

/** The bar that moves while something is going on and its end is not known. */
export function Busy() {
  return <div className="busy-bar" role="progressbar" aria-label={t('load.busy')} />;
}

/** Over the graphics area: the part files being loaded, each with its stage and time. */
export function LoadProgress() {
  const loading = useLoadingParts();
  if (loading.length === 0) return null;
  const shown = loading.slice(0, 3);
  return (
    <div className="load-progress" role="status" aria-live="polite">
      {shown.map((p) => (
        <div key={p.path} className="load-progress-row">
          <span className="load-progress-name">{t('load.name', { name: p.name })}</span>
          <span className="load-progress-stage">{loadingText(p)}</span>
        </div>
      ))}
      {loading.length > shown.length && <div className="load-progress-more">{t('load.more', { n: loading.length - shown.length })}</div>}
      <Busy />
    </div>
  );
}
