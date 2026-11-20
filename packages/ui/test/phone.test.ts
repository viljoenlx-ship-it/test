import { describe, expect, it } from 'vitest';
import { HANDSET_LAYOUT_CAP, isPhoneLayout, PHONE_MAX_PX, type PhoneSignals } from '../src/phone';

function signals(overrides: Partial<PhoneSignals> = {}): PhoneSignals {
  return {
    innerWidth: 1440,
    clientWidth: 1440,
    visualWidth: 1440,
    screenWidth: 1920,
    screenHeight: 1080,
    coarsePointer: false,
    maxTouchPoints: 0,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ...overrides,
  };
}

const pixel =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

describe('isPhoneLayout', () => {
  it('uses the phone shell at the widths a handset actually reports', () => {
    for (const width of [360, 390, 412, 430, 600, PHONE_MAX_PX]) {
      expect(
        isPhoneLayout(signals({ innerWidth: width, clientWidth: width, visualWidth: width })),
      ).toBe(true);
    }
  });

  it('keeps a wide desk window on the desk shell', () => {
    expect(isPhoneLayout(signals())).toBe(false);
    expect(isPhoneLayout(signals({ innerWidth: 1280, clientWidth: 1280, visualWidth: 1280 }))).toBe(
      false,
    );
  });

  it('still switches when the layout viewport inflated past the media query', () => {
    expect(
      isPhoneLayout(
        signals({
          innerWidth: 980,
          clientWidth: 980,
          visualWidth: 980,
          screenWidth: 412,
          screenHeight: 915,
          coarsePointer: true,
          maxTouchPoints: 5,
          userAgent: pixel,
        }),
      ),
    ).toBe(true);
  });

  it('treats a phone browser in the squeezed band as a phone', () => {
    expect(
      isPhoneLayout(
        signals({
          innerWidth: 820,
          clientWidth: 820,
          visualWidth: 820,
          screenWidth: 820,
          screenHeight: 900,
          userAgent: pixel,
        }),
      ),
    ).toBe(true);
  });

  it('does not treat a wide touch laptop as a phone', () => {
    expect(
      isPhoneLayout(
        signals({
          innerWidth: 1366,
          clientWidth: 1366,
          visualWidth: 1366,
          screenWidth: 1366,
          screenHeight: 768,
          coarsePointer: true,
          maxTouchPoints: 10,
        }),
      ),
    ).toBe(false);
    expect(HANDSET_LAYOUT_CAP).toBeGreaterThan(980);
  });

  it('stays on the desk shell when no viewport has been measured', () => {
    expect(
      isPhoneLayout(
        signals({
          innerWidth: 0,
          clientWidth: 0,
          visualWidth: 0,
          screenWidth: 0,
          screenHeight: 0,
        }),
      ),
    ).toBe(false);
  });
});
