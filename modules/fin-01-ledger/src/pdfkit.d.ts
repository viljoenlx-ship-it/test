declare module 'pdfkit' {
  import { Readable } from 'node:stream';

  type TextOptions = {
    width?: number;
    align?: 'left' | 'center' | 'right';
    lineBreak?: boolean;
  };

  class PDFDocument extends Readable {
    constructor(options?: { size?: string; margin?: number; layout?: 'portrait' | 'landscape' });
    page: { width: number; height: number };
    y: number;
    fillColor(color: string): this;
    fontSize(size: number): this;
    text(text: string, x?: number, y?: number, options?: TextOptions): this;
    text(text: string, options?: TextOptions): this;
    moveDown(lines?: number): this;
    addPage(): this;
    end(): void;
  }

  export default PDFDocument;
}
