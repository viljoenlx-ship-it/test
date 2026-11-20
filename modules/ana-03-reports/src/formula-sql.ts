import { formulaToTokens } from '@omnivate/shared';
import type { FormulaSlot } from './types';

type Node = { sql: string; kind: 'money' | 'number' };

/**
 * Turns a calculated-field formula into a SQL expression.
 * Only field names from the source and + - * / are accepted. Nothing is evaluated with eval.
 * Returns null when the formula uses a function this report cannot total.
 */
export function formulaToSql(
  formula: string,
  slots: Readonly<Record<string, FormulaSlot>>,
): Node | null {
  const allowed = new Set(Object.keys(slots));
  const parsed = formulaToTokens(formula, allowed);
  if (!parsed.ok) {
    return null;
  }
  const output: Node[] = [];
  const ops: string[] = [];
  const flush = (min: number) => {
    const rank = (op: string) => (op === '*' || op === '/' ? 2 : op === '+' || op === '-' ? 1 : 0);
    while (ops.length > 0) {
      const top = ops[ops.length - 1];
      if (!top || top === '(' || rank(top) < min) {
        break;
      }
      ops.pop();
      const right = output.pop();
      const left = output.pop();
      if (!left || !right) {
        return false;
      }
      const next = apply(top, left, right);
      if (!next) {
        return false;
      }
      output.push(next);
    }
    return true;
  };

  for (const token of parsed.tokens) {
    if (token.kind === 'fn' || token.kind === 'cmp' || token.kind === 'comma') {
      return null;
    }
    if (token.kind === 'field') {
      const slot = slots[token.key];
      if (!slot) {
        return null;
      }
      output.push({ sql: `(${slot.sql})`, kind: slot.kind });
      continue;
    }
    if (token.kind === 'number') {
      if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(token.value)) {
        return null;
      }
      output.push({ sql: token.value, kind: 'number' });
      continue;
    }
    if (token.kind === 'paren' && token.side === '(') {
      ops.push('(');
      continue;
    }
    if (token.kind === 'paren' && token.side === ')') {
      if (!flush(1)) {
        return null;
      }
      if (ops.pop() !== '(') {
        return null;
      }
      continue;
    }
    if (token.kind === 'op') {
      if (!flush(token.op === '*' || token.op === '/' ? 2 : 1)) {
        return null;
      }
      ops.push(token.op);
    }
  }
  if (!flush(1) || ops.length > 0 || output.length !== 1) {
    return null;
  }
  return output[0] ?? null;
}

function apply(op: string, left: Node, right: Node): Node | null {
  if (op === '+' || op === '-') {
    if (left.kind !== right.kind) {
      return null;
    }
    return { sql: `(${left.sql} ${op} ${right.sql})`, kind: left.kind };
  }
  if (op === '*') {
    if (left.kind === 'number' && right.kind === 'number') {
      return { sql: `(${left.sql} * ${right.sql})`, kind: 'number' };
    }
    if (left.kind === 'money' && right.kind === 'number') {
      return { sql: `ROUND((${left.sql}) * (${right.sql}))`, kind: 'money' };
    }
    if (left.kind === 'number' && right.kind === 'money') {
      return { sql: `ROUND((${right.sql}) * (${left.sql}))`, kind: 'money' };
    }
    return null;
  }
  if (op === '/' && right.kind === 'number') {
    if (left.kind === 'number') {
      return { sql: `(${left.sql} / NULLIF(${right.sql}, 0))`, kind: 'number' };
    }
    return { sql: `ROUND((${left.sql}) / NULLIF(${right.sql}, 0))`, kind: 'money' };
  }
  return null;
}
