import { Notification, nativeImage } from 'electron';
import type { FocusTarget } from '../../shared/types';
import type { Notice } from '../reminders';
import { NOTICE_ICON } from './icon';

/** Shown notifications, held until dismissed so Windows can still deliver their clicks. */
const live = new Set<Notification>();
const LIVE_MAX = 20;

/**
 * Shows a Windows notification; clicking it calls `onClick` with where it should lead.
 * With AXON_QUIET_NOTIFICATIONS=1 (automated checks) it only logs the notice.
 */
export function showNotice(notice: Notice, onClick: (target: FocusTarget) => void): void {
  if (process.env.AXON_QUIET_NOTIFICATIONS === '1') {
    console.log(`NOTICE ${notice.title} — ${notice.body}`);
    return;
  }
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: notice.title,
    body: notice.body,
    icon: nativeImage.createFromDataURL(NOTICE_ICON)
  });
  const forget = () => live.delete(notification);
  notification.on('click', () => {
    forget();
    onClick(notice.target);
  });
  notification.on('close', forget);
  notification.on('failed', forget);
  live.add(notification);
  if (live.size > LIVE_MAX) live.delete(live.values().next().value!);
  notification.show();
}
