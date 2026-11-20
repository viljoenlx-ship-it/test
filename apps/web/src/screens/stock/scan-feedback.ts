import { pushScanKey, type ScanSample } from '@omnivate/shared';

export function createScanBuffer() {
  let samples: ScanSample[] = [];
  return {
    push(key: string, at = typeof performance === 'undefined' ? Date.now() : performance.now()) {
      const result = pushScanKey(samples, key, at);
      samples = result.samples;
      return result;
    },
  };
}

export function playScanTone(ok: boolean) {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    return;
  }
  const audio = new Ctx();
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  tone.frequency.value = ok ? 880 : 220;
  tone.connect(gain);
  gain.connect(audio.destination);
  gain.gain.setValueAtTime(0.04, audio.currentTime);
  tone.start();
  tone.stop(audio.currentTime + 0.07);
  tone.onended = () => {
    void audio.close();
  };
}
