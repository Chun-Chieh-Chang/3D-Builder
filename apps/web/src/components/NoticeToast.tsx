import { useEffect } from 'react';
import { useStore, store } from '../state/store';

/**
 * Notices (success or failure of an import/export, refused operations) also appear as a toast above the status bar, because the
 * status-bar line alone went unnoticed. Failures stay until clicked; successes disappear after a few seconds. The status bar keeps
 * showing the same text.
 */
export function NoticeToast() {
  const notice = useStore((s) => s.notice);
  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const timer = window.setTimeout(() => store.dismissNotice(), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className={`notice-toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} onClick={() => store.dismissNotice()}>
      {notice.text}
    </div>
  );
}
