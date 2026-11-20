import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** Draws a QR code in the browser from the text. Nothing is sent to a server. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let cancel = false;
    void QRCode.toString(value, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1c1917', light: '#ffffff' },
    }).then((markup) => {
      if (!cancel) {
        setSvg(markup);
      }
    });
    return () => {
      cancel = true;
    };
  }, [value]);

  return (
    <div
      className="ui-qr"
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
