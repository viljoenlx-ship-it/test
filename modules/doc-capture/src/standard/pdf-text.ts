import { inflateSync } from 'node:zlib';

/** Pulls the text layer out of a PDF. Scanned pages with no text return an empty string. */
export function extractPdfText(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  const chunks: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streams.exec(raw))) {
    const before = raw.slice(Math.max(0, match.index - 400), match.index);
    let data = Buffer.from(match[1] ?? '', 'latin1');
    if (/FlateDecode/.test(before)) {
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    }
    const text = stringsFromContent(data.toString('latin1'));
    if (text.trim()) {
      chunks.push(text);
    }
  }
  return chunks.join('\n');
}

function stringsFromContent(content: string): string {
  const lines: string[] = [];
  const singles = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = singles.exec(content))) {
    lines.push(unescapePdf(match[1] ?? ''));
  }
  const groups = /\[(.*?)\]\s*TJ/gs;
  while ((match = groups.exec(content))) {
    const parts: string[] = [];
    const inner = /\(((?:\\.|[^\\)])*)\)/g;
    let piece: RegExpExecArray | null;
    while ((piece = inner.exec(match[1] ?? ''))) {
      parts.push(unescapePdf(piece[1] ?? ''));
    }
    if (parts.length > 0) {
      lines.push(parts.join(''));
    }
  }
  return lines.join('\n');
}

function unescapePdf(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_all, code: string) => {
    if (code === 'n') return '\n';
    if (code === 'r') return '\r';
    if (code === 't') return '\t';
    if (code === 'b') return '\b';
    if (code === 'f') return '\f';
    if (code === '(' || code === ')' || code === '\\') return code;
    return String.fromCharCode(parseInt(code, 8));
  });
}
