/**
 * Code 128, set B. Widths are the ISO/IEC 15417 run lengths.
 * The stop symbol is seven runs (2331112).
 */

const WIDTHS = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
] as const;

const START_B = 104;

export function code128Values(value: string): number[] {
  if (value.length === 0 || value.length > 40) {
    throw new Error('A barcode needs between 1 and 40 characters.');
  }
  const codes: number[] = [START_B];
  for (const char of value) {
    const code = char.charCodeAt(0) - 32;
    if (code < 0 || code > 94) {
      throw new Error('This barcode uses letters, numbers, and basic symbols only.');
    }
    codes.push(code);
  }
  let total = START_B;
  for (let index = 1; index < codes.length; index += 1) {
    total += index * (codes[index] ?? 0);
  }
  codes.push(total % 103);
  codes.push(106);
  return codes;
}

/** Module widths, including a quiet zone of 10 modules on each side. 1 = bar. */
export function code128Modules(value: string): number[] {
  const modules: number[] = Array.from({ length: 10 }, () => 0);
  for (const code of code128Values(value)) {
    const pattern = WIDTHS[code];
    if (!pattern) {
      throw new Error('Barcode pattern is missing.');
    }
    let bar = true;
    for (const digit of pattern) {
      const width = Number(digit);
      for (let step = 0; step < width; step += 1) {
        modules.push(bar ? 1 : 0);
      }
      bar = !bar;
    }
  }
  for (let quiet = 0; quiet < 10; quiet += 1) {
    modules.push(0);
  }
  return modules;
}

export function modulesToSvg(modules: readonly number[], value: string): string {
  const bars: string[] = [];
  let index = 0;
  while (index < modules.length) {
    if (modules[index] !== 1) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < modules.length && modules[index] === 1) {
      index += 1;
    }
    bars.push(`<rect x="${start}" y="0" width="${index - start}" height="40"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules.length} 40" preserveAspectRatio="none" role="img" aria-label="Barcode ${value}">${bars.join('')}</svg>`;
}

export function code128Svg(value: string): string {
  return modulesToSvg(code128Modules(value), value);
}
