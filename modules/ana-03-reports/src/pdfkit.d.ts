declare module 'pdfkit' {
  import { Readable } from 'node:stream';

  type TextOptions = {
    width?: number;
    lineBreak?: boolean;
    ellipsis?: boolean;
    align?: 'left' | 'center' | 'right';
  };

  class PDFDocument extends Readable {
    constructor(options?: {
      size?: string;
      margin?: number;
      layout?: 'portrait' | 'landscape';
      compress?: boolean;
    });
    page: { width: number; height: number };
    x: number;
    y: number;
    fillColor(color: string): this;
    fontSize(size: number): this;
    text(text: string, x?: number, y?: number, options?: TextOptions): this;
    text(text: string, options?: TextOptions): this;
    rect(x: number, y: number, width: number, height: number): this;
    fill(color?: string): this;
    image(
      src: Buffer,
      x: number,
      y: number,
      options?: { height?: number; fit?: [number, number] },
    ): this;
    addPage(): this;
    end(): void;
  }

  export default PDFDocument;
}
