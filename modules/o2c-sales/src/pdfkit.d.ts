declare module 'pdfkit' {
  import { Readable } from 'node:stream';

  type TextOptions = {
    width?: number;
    align?: 'left' | 'center' | 'right' | 'justify';
    lineBreak?: boolean;
  };

  class PDFDocument extends Readable {
    constructor(options?: { size?: string; margin?: number; compress?: boolean });
    page: { width: number; height: number };
    x: number;
    y: number;
    fillColor(color: string): this;
    fontSize(size: number): this;
    text(text: string, x?: number, y?: number, options?: TextOptions): this;
    text(text: string, options?: TextOptions): this;
    moveDown(lines?: number): this;
    rect(x: number, y: number, width: number, height: number): this;
    fill(color?: string): this;
    image(src: Buffer, x: number, y: number, options?: { height?: number }): this;
    end(): void;
  }

  export default PDFDocument;
}
