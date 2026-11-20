import { Button } from '@omnivate/ui';
import { useEffect, useRef, useState } from 'react';

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue?: string }[]>;
};

type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

function detectorAvailable(): DetectorConstructor | null {
  const candidate = (window as unknown as { BarcodeDetector?: DetectorConstructor })
    .BarcodeDetector;
  return candidate ?? null;
}

/** Phone camera scanning, only when the browser already has BarcodeDetector. */
export function ScanCamera({ onScan }: { onScan: (code: string) => void }) {
  const supported = typeof window !== 'undefined' && detectorAvailable() !== null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const Detector = detectorAvailable();
    const video = videoRef.current;
    if (!Detector || !video) {
      return undefined;
    }
    let stopped = false;
    let stream: MediaStream | null = null;
    const detector = new Detector({ formats: ['ean_13', 'code_128', 'qr_code'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((next) => {
        if (stopped) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        video.srcObject = next;
        return video.play();
      })
      .catch(() => {
        if (!stopped) {
          setError('The camera is not available.');
        }
      });
    const timer = window.setInterval(() => {
      void detector.detect(video).then((codes) => {
        const value = codes.find((code) => code.rawValue)?.rawValue;
        if (value && !stopped) {
          stopped = true;
          onScanRef.current(value);
          setOpen(false);
        }
      });
    }, 400);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open]);

  if (!supported) {
    return null;
  }

  return (
    <div className="scan-camera">
      {open ? (
        <video ref={videoRef} className="scan-video" muted playsInline />
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Use the Camera
        </Button>
      )}
      {error ? <p className="ui-error">{error}</p> : null}
    </div>
  );
}
