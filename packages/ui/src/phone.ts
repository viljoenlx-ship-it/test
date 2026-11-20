/**
 * Phone shell detection.
 *
 * `matchMedia('(max-width: 767px)')` follows the layout viewport. On a real
 * phone that viewport is often wider than the screen: Chrome expands it to
 * fit wide content, and "Desktop site" uses about 980px. The desk shell then
 * stays on (hamburger, Ctrl K, breadcrumbs) even though the screen is about
 * 412px wide.
 *
 * A narrow window is the phone layout. A handset is also the phone layout
 * when the browser says it is a phone, or the screen's short side is under
 * the breakpoint, as long as the layout width is still in the band a phone
 * can report.
 */

export const PHONE_MAX_PX = 767;

/** Covers a 980px desktop-site viewport without treating a wide laptop as a phone. */
export const HANDSET_LAYOUT_CAP = 1040;

export type PhoneSignals = {
  innerWidth: number;
  clientWidth: number;
  visualWidth: number;
  screenWidth: number;
  screenHeight: number;
  coarsePointer: boolean;
  maxTouchPoints: number;
  userAgent: string;
};

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
}

export function isPhoneLayout(signals: PhoneSignals): boolean {
  const layout = Math.min(
    positive(signals.innerWidth),
    positive(signals.clientWidth),
    positive(signals.visualWidth),
  );
  if (!Number.isFinite(layout)) {
    return false;
  }
  if (layout <= PHONE_MAX_PX) {
    return true;
  }
  if (layout > HANDSET_LAYOUT_CAP) {
    return false;
  }
  const shortSide = Math.min(positive(signals.screenWidth), positive(signals.screenHeight));
  const uaPhone = /iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile|Opera Mini/i.test(
    signals.userAgent,
  );
  const touch = signals.coarsePointer || signals.maxTouchPoints > 0;
  return uaPhone || (touch && shortSide <= PHONE_MAX_PX);
}

export function readPhoneSignals(): PhoneSignals {
  const coarse =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
  return {
    innerWidth: window.innerWidth || 0,
    clientWidth: document.documentElement?.clientWidth || 0,
    visualWidth: window.visualViewport?.width || 0,
    screenWidth: window.screen?.width || 0,
    screenHeight: window.screen?.height || 0,
    coarsePointer: coarse,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    userAgent: navigator.userAgent || '',
  };
}

function publish(next: boolean): void {
  if (typeof document === 'undefined') {
    return;
  }
  const shell = next ? 'phone' : 'desk';
  if (document.documentElement.dataset.shell !== shell) {
    document.documentElement.dataset.shell = shell;
  }
}

export function getPhoneSnapshot(): boolean {
  const next = isPhoneLayout(readPhoneSignals());
  publish(next);
  return next;
}

export function subscribeToPhone(onChange: () => void): () => void {
  let seen = isPhoneLayout(readPhoneSignals());
  const notify = () => {
    const next = isPhoneLayout(readPhoneSignals());
    publish(next);
    if (next === seen) {
      return;
    }
    seen = next;
    onChange();
  };
  const cleanups: Array<() => void> = [];
  const listen = (target: EventTarget | null | undefined, type: string) => {
    if (!target || typeof target.addEventListener !== 'function') {
      return;
    }
    target.addEventListener(type, notify);
    cleanups.push(() => target.removeEventListener(type, notify));
  };
  listen(window, 'resize');
  listen(window, 'orientationchange');
  listen(window, 'pageshow');
  listen(window.visualViewport ?? null, 'resize');
  if (typeof window.matchMedia === 'function') {
    listen(window.matchMedia(`(max-width: ${PHONE_MAX_PX}px)`), 'change');
  }
  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
