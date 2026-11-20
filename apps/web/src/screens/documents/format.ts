const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** 4 Mar 2026. The stored value stays 2026-03-04. */
export function saDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return value;
  }
  const month = MONTHS[Number(match[2]) - 1];
  const day = Number(match[3]);
  if (!month || day < 1 || day > 31) {
    return value;
  }
  return `${day} ${month} ${match[1]}`;
}

export function rands(value: string): string {
  const text = value.trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
    return text || '—';
  }
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negative ? '-' : ''}R${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
