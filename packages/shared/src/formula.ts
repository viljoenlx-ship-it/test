/**
 * Safe formulas for calculated fields.
 * A recursive-descent parser builds a tree and walks it. Nothing is passed to eval,
 * Function, or the shell. Money inputs and money results are whole cents.
 * Other numbers use four decimal places, the same scale as catalog quantities.
 */

import { formatZar, money, zarFromDecimal } from './money';

const SCALE = 10_000n;
const MAX_ABS = 10n ** 18n;

export type FormulaDisplay = 'number' | 'money';

export type FormulaNumberKind = 'number' | 'decimal' | 'money';

/** A value a formula may read. Money `text` is integer cents, never rands. Null means blank. */
export type FormulaNumber = {
  kind: FormulaNumberKind;
  text: string | null;
};

export type FormulaSpec = {
  formula: string;
  places: number;
  display: FormulaDisplay;
  unit: string;
};

export type FormulaToken =
  | { kind: 'field'; key: string }
  | { kind: 'number'; value: string }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' }
  | { kind: 'paren'; side: '(' | ')' }
  | { kind: 'fn'; name: 'ROUND' | 'MIN' | 'MAX' | 'IF' }
  | { kind: 'comma' }
  | { kind: 'cmp'; op: '=' | '<>' | '>' | '>=' | '<' | '<=' };

type FormulaAst =
  | { type: 'number'; text: string }
  | { type: 'field'; key: string }
  | { type: 'unary'; value: FormulaAst }
  | { type: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaAst; right: FormulaAst }
  | { type: 'round'; value: FormulaAst; places: FormulaAst }
  | { type: 'min'; args: FormulaAst[] }
  | { type: 'max'; args: FormulaAst[] }
  | { type: 'if'; condition: FormulaCondition; then: FormulaAst; else: FormulaAst };

type FormulaCondition = {
  type: 'compare';
  op: '=' | '<>' | '>' | '>=' | '<' | '<=';
  left: FormulaAst;
  right: FormulaAst;
};

export type FormulaOutcome =
  | { ok: true; scaled: bigint }
  | {
      ok: false;
      code: 'missing' | 'divide_by_zero' | 'overflow' | 'syntax' | 'round';
      message: string;
    };

type Token =
  | { kind: 'number'; text: string }
  | { kind: 'ident'; text: string }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' }
  | { kind: 'cmp'; op: FormulaCondition['op'] }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' };

const NUMBER = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

export function parseFormula(
  source: string,
  allowed: ReadonlySet<string>,
): { ok: true; ast: FormulaAst } | { ok: false; message: string } {
  const trimmed = source.trim();
  if (trimmed.length < 1) {
    return { ok: false, message: 'Add a formula.' };
  }
  if (trimmed.length > 500) {
    return { ok: false, message: 'That formula is too long.' };
  }
  let tokens: Token[];
  try {
    tokens = tokenize(trimmed);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Check the formula.' };
  }
  if (tokens.length > 80) {
    return { ok: false, message: 'That formula has too many parts.' };
  }
  try {
    const parser = new Parser(tokens, allowed);
    const ast = parser.parseExpression();
    parser.end();
    return { ok: true, ast };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Check the formula.' };
  }
}

export function evaluateFormula(
  source: string,
  allowed: ReadonlySet<string>,
  values: Readonly<Record<string, FormulaNumber>>,
): FormulaOutcome {
  const parsed = parseFormula(source, allowed);
  if (!parsed.ok) {
    return { ok: false, code: 'syntax', message: parsed.message };
  }
  return evalAst(parsed.ast, values);
}

export function formulaReferences(source: string, allowed: ReadonlySet<string>): string[] {
  const parsed = parseFormula(source, allowed);
  if (!parsed.ok) {
    return [];
  }
  const keys: string[] = [];
  walk(parsed.ast, (key) => {
    if (!keys.includes(key)) {
      keys.push(key);
    }
  });
  return keys;
}

/**
 * Returns a sentence when calculated fields refer to each other in a loop.
 * `allowed` is every field key the formulas may name, including ordinary number fields.
 */
export function formulaCycle(
  formulas: readonly { key: string; label: string; formula: string }[],
  allowed: ReadonlySet<string>,
): string | null {
  const byKey = new Map(formulas.map((field) => [field.key, field]));
  const edges = new Map<string, string[]>();
  for (const field of formulas) {
    const parsed = parseFormula(field.formula, allowed);
    if (!parsed.ok) {
      continue;
    }
    const refs: string[] = [];
    walk(parsed.ast, (key) => {
      if (byKey.has(key) && !refs.includes(key)) {
        refs.push(key);
      }
    });
    edges.set(field.key, refs);
  }

  const color = new Map<string, number>();
  const stack: string[] = [];

  function visit(key: string): string[] | null {
    color.set(key, 1);
    stack.push(key);
    for (const next of edges.get(key) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 1) {
        const start = stack.indexOf(next);
        return stack.slice(start);
      }
      if (state === 0) {
        const found = visit(next);
        if (found) {
          return found;
        }
      }
    }
    stack.pop();
    color.set(key, 2);
    return null;
  }

  for (const field of formulas) {
    if ((color.get(field.key) ?? 0) === 0) {
      const cycle = visit(field.key);
      if (cycle) {
        return cycleSentence(cycle, byKey);
      }
    }
  }
  return null;
}

export function formulaToTokens(
  source: string,
  allowed: ReadonlySet<string>,
): { ok: true; tokens: FormulaToken[] } | { ok: false; message: string } {
  const parsed = parseFormula(source, allowed);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, tokens: astToTokens(parsed.ast, 0) };
}

export function tokensToFormula(tokens: readonly FormulaToken[]): string {
  return tokens
    .map((token) => {
      switch (token.kind) {
        case 'field':
          return token.key;
        case 'number':
          return token.value.trim();
        case 'op':
          return token.op;
        case 'paren':
          return token.side;
        case 'fn':
          return token.name;
        case 'comma':
          return ',';
        case 'cmp':
          return token.op;
      }
    })
    .filter((part) => part.length > 0)
    .join(' ');
}

export function presentFormula(
  scaled: bigint,
  spec: { display: FormulaDisplay; places: number; unit: string },
): string {
  if (spec.display === 'money') {
    const cents = wholeUnits(roundScaled(scaled, 0));
    return formatZar(money(cents));
  }
  const text = decimalText(roundScaled(scaled, spec.places), spec.places);
  const unit = spec.unit.trim();
  return unit ? `${text} ${unit}` : text;
}

/**
 * Live example. Sample text for a money field is rands ("12.50").
 * Sample text for a number is a decimal ("4"). The result follows the field's display.
 */
export function previewFormula(
  source: string,
  fields: readonly { key: string; kind: FormulaNumberKind; label: string }[],
  samples: Readonly<Record<string, string>>,
  spec: { display: FormulaDisplay; places: number; unit: string },
): { ok: true; text: string } | { ok: false; message: string } {
  const allowed = new Set(fields.map((field) => field.key));
  const parsed = parseFormula(source, allowed);
  if (!parsed.ok) {
    return parsed;
  }
  const values: Record<string, FormulaNumber> = {};
  const needed = formulaReferences(source, allowed);
  for (const key of needed) {
    const field = fields.find((item) => item.key === key);
    if (!field) {
      return { ok: false, message: 'Choose a field from the list.' };
    }
    const sample = (samples[key] ?? '').trim();
    if (sample.length === 0) {
      return { ok: false, message: `Enter an example for ${field.label}.` };
    }
    if (field.kind === 'money') {
      try {
        values[key] = { kind: 'money', text: zarFromDecimal(sample).amountCents.toString() };
      } catch {
        return { ok: false, message: `Enter an example amount for ${field.label}, such as 12.50.` };
      }
    } else if (!NUMBER.test(sample)) {
      return { ok: false, message: `Enter an example number for ${field.label}.` };
    } else {
      values[key] = { kind: field.kind, text: sample };
    }
  }
  const result = evalAst(parsed.ast, values);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, text: presentFormula(result.scaled, spec) };
}

export function formulaDecimal(
  scaled: bigint,
  places: number,
): { ok: true; text: string } | { ok: false; message: string } {
  if (tooLarge(scaled)) {
    return { ok: false, message: 'That result is too large.' };
  }
  return { ok: true, text: decimalText(roundScaled(scaled, places), places) };
}

export function formulaCents(
  scaled: bigint,
): { ok: true; cents: number } | { ok: false; message: string } {
  if (tooLarge(scaled)) {
    return { ok: false, message: 'That result is too large.' };
  }
  const cents = wholeUnits(roundScaled(scaled, 0));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    return { ok: false, message: 'That result is too large.' };
  }
  return { ok: true, cents: Number(cents) };
}

function cycleSentence(
  cycle: readonly string[],
  byKey: ReadonlyMap<string, { key: string; label: string }>,
): string {
  const label = (key: string) => byKey.get(key)?.label ?? key;
  if (cycle.length === 1) {
    return `${label(cycle[0] ?? '')} uses itself. A formula cannot refer to itself.`;
  }
  const parts = cycle.map((key, index) => {
    const next = cycle[(index + 1) % cycle.length] ?? key;
    return `${label(key)} uses ${label(next)}`;
  });
  const last = parts.pop() ?? '';
  return `${parts.join(', ')}, and ${last}. A formula cannot refer to itself.`;
}

function walk(ast: FormulaAst, visit: (key: string) => void): void {
  switch (ast.type) {
    case 'number':
      return;
    case 'field':
      visit(ast.key);
      return;
    case 'unary':
      walk(ast.value, visit);
      return;
    case 'binary':
      walk(ast.left, visit);
      walk(ast.right, visit);
      return;
    case 'round':
      walk(ast.value, visit);
      walk(ast.places, visit);
      return;
    case 'min':
    case 'max':
      for (const arg of ast.args) {
        walk(arg, visit);
      }
      return;
    case 'if':
      walk(ast.condition.left, visit);
      walk(ast.condition.right, visit);
      walk(ast.then, visit);
      walk(ast.else, visit);
      return;
  }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? '';
    if (char === ' ' || char === '\n' || char === '\t') {
      index += 1;
      continue;
    }
    if (char === '×') {
      tokens.push({ kind: 'op', op: '*' });
      index += 1;
      continue;
    }
    if (char === '÷') {
      tokens.push({ kind: 'op', op: '/' });
      index += 1;
      continue;
    }
    const rest = source.slice(index);
    const number = NUMBER.exec(rest);
    if (number && (index === 0 || !/[A-Za-z0-9_]/.test(source[index - 1] ?? ''))) {
      tokens.push({ kind: 'number', text: number[0] });
      index += number[0].length;
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      tokens.push({ kind: 'ident', text: ident[0] });
      index += ident[0].length;
      continue;
    }
    if (rest.startsWith('>=')) {
      tokens.push({ kind: 'cmp', op: '>=' });
      index += 2;
      continue;
    }
    if (rest.startsWith('<=')) {
      tokens.push({ kind: 'cmp', op: '<=' });
      index += 2;
      continue;
    }
    if (rest.startsWith('<>') || rest.startsWith('!=')) {
      tokens.push({ kind: 'cmp', op: '<>' });
      index += 2;
      continue;
    }
    if (char === '>') {
      tokens.push({ kind: 'cmp', op: '>' });
      index += 1;
      continue;
    }
    if (char === '<') {
      tokens.push({ kind: 'cmp', op: '<' });
      index += 1;
      continue;
    }
    if (char === '=') {
      tokens.push({ kind: 'cmp', op: '=' });
      index += 1;
      continue;
    }
    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ kind: 'op', op: char });
      index += 1;
      continue;
    }
    if (char === '(') {
      tokens.push({ kind: 'lparen' });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rparen' });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma' });
      index += 1;
      continue;
    }
    throw new Error('Check the formula. Use fields, numbers, + − × ÷, and brackets.');
  }
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly allowed: ReadonlySet<string>,
  ) {}

  parseExpression(): FormulaAst {
    return this.parseAdd();
  }

  end(): void {
    if (this.index < this.tokens.length) {
      throw new Error('Check the formula. Something is left over at the end.');
    }
  }

  private parseAdd(): FormulaAst {
    let left = this.parseMul();
    while (this.peekOp('+') || this.peekOp('-')) {
      const token = this.tokens[this.index];
      const op = token?.kind === 'op' && (token.op === '+' || token.op === '-') ? token.op : '+';
      this.index += 1;
      const right = this.parseMul();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseMul(): FormulaAst {
    let left = this.parseUnary();
    while (this.peekOp('*') || this.peekOp('/')) {
      const token = this.tokens[this.index];
      const op = token?.kind === 'op' && (token.op === '*' || token.op === '/') ? token.op : '*';
      this.index += 1;
      const right = this.parseUnary();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): FormulaAst {
    if (this.peekOp('-')) {
      this.index += 1;
      return { type: 'unary', value: this.parseUnary() };
    }
    if (this.peekOp('+')) {
      this.index += 1;
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaAst {
    const token = this.tokens[this.index];
    if (!token) {
      throw new Error('The formula ends too soon.');
    }
    if (token.kind === 'number') {
      this.index += 1;
      return { type: 'number', text: token.text };
    }
    if (token.kind === 'lparen') {
      this.index += 1;
      const inner = this.parseAdd();
      this.expectRParen();
      return inner;
    }
    if (token.kind === 'ident') {
      const name = token.text;
      const next = this.tokens[this.index + 1];
      if (
        next?.kind === 'lparen' &&
        (name === 'ROUND' || name === 'MIN' || name === 'MAX' || name === 'IF')
      ) {
        return this.parseCall(name);
      }
      if (!this.allowed.has(name)) {
        throw new Error('Choose a field from the list.');
      }
      this.index += 1;
      return { type: 'field', key: name };
    }
    throw new Error('Check the formula. Use fields, numbers, + − × ÷, and brackets.');
  }

  private parseCall(name: 'ROUND' | 'MIN' | 'MAX' | 'IF'): FormulaAst {
    this.index += 2;
    if (name === 'IF') {
      const left = this.parseAdd();
      const cmp = this.tokens[this.index];
      this.index += 1;
      if (!cmp || cmp.kind !== 'cmp') {
        throw new Error('IF needs a comparison, such as IF(on_hand < reorder_level, 1, 0).');
      }
      const right = this.parseAdd();
      this.expectComma();
      const then = this.parseAdd();
      this.expectComma();
      const otherwise = this.parseAdd();
      this.expectRParen();
      return {
        type: 'if',
        condition: { type: 'compare', op: cmp.op, left, right },
        then,
        else: otherwise,
      };
    }
    if (name === 'ROUND') {
      const value = this.parseAdd();
      this.expectComma();
      const places = this.parseAdd();
      this.expectRParen();
      return { type: 'round', value, places };
    }
    const args = [this.parseAdd()];
    while (this.tokens[this.index]?.kind === 'comma') {
      this.index += 1;
      args.push(this.parseAdd());
      if (args.length > 8) {
        throw new Error('Use at most 8 values in MIN or MAX.');
      }
    }
    if (args.length < 2) {
      throw new Error(`${name} needs at least two values.`);
    }
    this.expectRParen();
    return name === 'MIN' ? { type: 'min', args } : { type: 'max', args };
  }

  private peekOp(op: '+' | '-' | '*' | '/'): boolean {
    const token = this.tokens[this.index];
    return token?.kind === 'op' && token.op === op;
  }

  private expectComma(): void {
    const token = this.tokens[this.index];
    if (token?.kind !== 'comma') {
      throw new Error('A comma is missing in the formula.');
    }
    this.index += 1;
  }

  private expectRParen(): void {
    const token = this.tokens[this.index];
    if (token?.kind !== 'rparen') {
      throw new Error('A closing bracket is missing.');
    }
    this.index += 1;
  }
}

function evalAst(ast: FormulaAst, values: Readonly<Record<string, FormulaNumber>>): FormulaOutcome {
  switch (ast.type) {
    case 'number': {
      const scaled = scaleDecimal(ast.text);
      return scaled === null
        ? { ok: false, code: 'syntax', message: 'Enter a number, such as 12 or 12.5.' }
        : { ok: true, scaled };
    }
    case 'field': {
      const value = values[ast.key];
      if (!value || value.text === null || value.text.trim() === '') {
        return { ok: false, code: 'missing', message: 'A field in the formula is blank.' };
      }
      const scaled = scaleDecimal(value.text.trim());
      if (scaled === null) {
        return { ok: false, code: 'syntax', message: 'A field in the formula is not a number.' };
      }
      return guard(scaled);
    }
    case 'unary': {
      const inner = evalAst(ast.value, values);
      if (!inner.ok) {
        return inner;
      }
      return guard(-inner.scaled);
    }
    case 'binary': {
      const left = evalAst(ast.left, values);
      if (!left.ok) {
        return left;
      }
      const right = evalAst(ast.right, values);
      if (!right.ok) {
        return right;
      }
      if (ast.op === '+') {
        return guard(left.scaled + right.scaled);
      }
      if (ast.op === '-') {
        return guard(left.scaled - right.scaled);
      }
      if (ast.op === '*') {
        return guard(divRound(left.scaled * right.scaled, SCALE));
      }
      if (right.scaled === 0n) {
        return { ok: false, code: 'divide_by_zero', message: 'Cannot divide by zero.' };
      }
      return guard(divRound(left.scaled * SCALE, right.scaled));
    }
    case 'round': {
      const value = evalAst(ast.value, values);
      if (!value.ok) {
        return value;
      }
      const places = evalAst(ast.places, values);
      if (!places.ok) {
        return places;
      }
      if (places.scaled % SCALE !== 0n) {
        return { ok: false, code: 'round', message: 'Round to a whole number of decimal places.' };
      }
      const digits = places.scaled / SCALE;
      if (digits < 0n || digits > 4n) {
        return { ok: false, code: 'round', message: 'Round to between 0 and 4 decimal places.' };
      }
      return { ok: true, scaled: roundScaled(value.scaled, Number(digits)) };
    }
    case 'min':
    case 'max': {
      let best: bigint | null = null;
      for (const arg of ast.args) {
        const value = evalAst(arg, values);
        if (!value.ok) {
          return value;
        }
        if (best === null || (ast.type === 'min' ? value.scaled < best : value.scaled > best)) {
          best = value.scaled;
        }
      }
      return best === null
        ? { ok: false, code: 'syntax', message: 'MIN and MAX need values.' }
        : { ok: true, scaled: best };
    }
    case 'if': {
      const left = evalAst(ast.condition.left, values);
      if (!left.ok) {
        return left;
      }
      const right = evalAst(ast.condition.right, values);
      if (!right.ok) {
        return right;
      }
      const pass = compare(left.scaled, right.scaled, ast.condition.op);
      return evalAst(pass ? ast.then : ast.else, values);
    }
  }
}

function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const rounded = (absoluteNumerator + absoluteDenominator / 2n) / absoluteDenominator;
  return negative ? -rounded : rounded;
}

function compare(left: bigint, right: bigint, op: FormulaCondition['op']): boolean {
  if (op === '=') return left === right;
  if (op === '<>') return left !== right;
  if (op === '>') return left > right;
  if (op === '>=') return left >= right;
  if (op === '<') return left < right;
  return left <= right;
}

function guard(scaled: bigint): FormulaOutcome {
  if (tooLarge(scaled)) {
    return { ok: false, code: 'overflow', message: 'That result is too large.' };
  }
  return { ok: true, scaled };
}

function tooLarge(scaled: bigint): boolean {
  const absolute = scaled < 0n ? -scaled : scaled;
  return absolute > MAX_ABS;
}

function scaleDecimal(value: string): bigint | null {
  if (!NUMBER.test(value)) {
    return null;
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}

function roundScaled(value: bigint, places: number): bigint {
  const drop = 4 - places;
  if (drop <= 0) {
    return value;
  }
  const factor = 10n ** BigInt(drop);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const rounded = ((absolute + factor / 2n) / factor) * factor;
  return negative ? -rounded : rounded;
}

function wholeUnits(scaled: bigint): bigint {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const units = absolute / SCALE;
  return negative ? -units : units;
}

function decimalText(scaled: bigint, places: number): string {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = (absolute / SCALE).toString();
  if (places <= 0) {
    return negative ? `-${whole}` : whole;
  }
  const fraction = (absolute % SCALE).toString().padStart(4, '0').slice(0, places);
  const text = `${whole}.${fraction}`;
  return negative ? `-${text}` : text;
}

const BINARY_PREC: Record<'+' | '-' | '*' | '/', number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

function astToTokens(ast: FormulaAst, parentPrec: number): FormulaToken[] {
  switch (ast.type) {
    case 'number':
      return [{ kind: 'number', value: ast.text }];
    case 'field':
      return [{ kind: 'field', key: ast.key }];
    case 'unary':
      return [{ kind: 'op', op: '-' }, ...astToTokens(ast.value, 3)];
    case 'binary': {
      const prec = BINARY_PREC[ast.op];
      const tokens: FormulaToken[] = [
        ...astToTokens(ast.left, prec),
        { kind: 'op', op: ast.op },
        ...astToTokens(ast.right, prec + 1),
      ];
      return prec < parentPrec ? wrap(tokens) : tokens;
    }
    case 'round':
      return [
        { kind: 'fn', name: 'ROUND' },
        { kind: 'paren', side: '(' },
        ...astToTokens(ast.value, 0),
        { kind: 'comma' },
        ...astToTokens(ast.places, 0),
        { kind: 'paren', side: ')' },
      ];
    case 'min':
    case 'max': {
      const tokens: FormulaToken[] = [
        { kind: 'fn', name: ast.type === 'min' ? 'MIN' : 'MAX' },
        { kind: 'paren', side: '(' },
      ];
      ast.args.forEach((arg, index) => {
        if (index > 0) {
          tokens.push({ kind: 'comma' });
        }
        tokens.push(...astToTokens(arg, 0));
      });
      tokens.push({ kind: 'paren', side: ')' });
      return tokens;
    }
    case 'if':
      return [
        { kind: 'fn', name: 'IF' },
        { kind: 'paren', side: '(' },
        ...astToTokens(ast.condition.left, 0),
        { kind: 'cmp', op: ast.condition.op },
        ...astToTokens(ast.condition.right, 0),
        { kind: 'comma' },
        ...astToTokens(ast.then, 0),
        { kind: 'comma' },
        ...astToTokens(ast.else, 0),
        { kind: 'paren', side: ')' },
      ];
  }
}

function wrap(tokens: FormulaToken[]): FormulaToken[] {
  return [{ kind: 'paren', side: '(' }, ...tokens, { kind: 'paren', side: ')' }];
}
