import {
  formulaCycle,
  formulaToTokens,
  previewFormula,
  tokensToFormula,
  type FormulaDisplay,
  type FormulaNumberKind,
  type FormulaToken,
} from '@omnivate/shared';
import { Button, SelectField, TextField } from '@omnivate/ui';
import { useEffect, useMemo, useState } from 'react';

export type FormulaInput = {
  key: string;
  label: string;
  kind: FormulaNumberKind;
};

const OPS = [
  { op: '+', label: '+' },
  { op: '-', label: '−' },
  { op: '*', label: '×' },
  { op: '/', label: '÷' },
] as const;

const COMPARES = [
  { op: '=', label: 'Is' },
  { op: '<>', label: 'Is Not' },
  { op: '>', label: 'Is Greater Than' },
  { op: '>=', label: 'Is At Least' },
  { op: '<', label: 'Is Less Than' },
  { op: '<=', label: 'Is At Most' },
] as const;

export function FormulaEditor({
  inputs,
  formula,
  places,
  display,
  unit,
  selfKey,
  selfLabel,
  others,
  onChange,
}: {
  inputs: readonly FormulaInput[];
  formula: string;
  places: number;
  display: FormulaDisplay;
  unit: string;
  selfKey: string;
  selfLabel: string;
  others: readonly { key: string; label: string; formula: string }[];
  onChange: (next: {
    formula: string;
    places: number;
    display: FormulaDisplay;
    unit: string;
  }) => void;
}) {
  const allowed = useMemo(() => new Set(inputs.map((field) => field.key)), [inputs]);
  const [tokens, setTokens] = useState<FormulaToken[]>(() => {
    const parsed = formulaToTokens(formula, allowed);
    if (parsed.ok && parsed.tokens.length > 0) {
      return parsed.tokens;
    }
    const first = inputs[0]?.key ?? '';
    const second = inputs[1]?.key ?? first;
    if (!first) {
      return [];
    }
    return [
      { kind: 'field', key: first },
      { kind: 'op', op: '*' },
      { kind: 'field', key: second },
    ];
  });
  const [samples, setSamples] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const field of inputs) {
      next[field.key] = field.kind === 'money' ? '12.50' : '4';
    }
    return next;
  });

  function commit(
    nextTokens: FormulaToken[],
    next: Partial<{ places: number; display: FormulaDisplay; unit: string }> = {},
  ) {
    setTokens(nextTokens);
    const nextDisplay = next.display ?? display;
    onChange({
      formula: tokensToFormula(nextTokens),
      places: nextDisplay === 'money' ? 0 : (next.places ?? places),
      display: nextDisplay,
      unit: nextDisplay === 'money' ? '' : (next.unit ?? unit),
    });
  }

  useEffect(() => {
    onChange({
      formula: tokensToFormula(tokens),
      places: display === 'money' ? 0 : places,
      display,
      unit: display === 'money' ? '' : unit,
    });
  }, []);

  const source = tokensToFormula(tokens);
  const cycle = formulaCycle(
    [...others, { key: selfKey, label: selfLabel || 'This field', formula: source }],
    allowed,
  );
  const preview = previewFormula(source, inputs, samples, {
    display,
    places: display === 'money' ? 0 : places,
    unit: display === 'money' ? '' : unit,
  });
  const used = tokens.flatMap((token) => (token.kind === 'field' ? [token.key] : []));

  const readout = readableFormula(selfLabel, tokens, inputs);

  return (
    <div className="formula-builder">
      {readout ? <p className="formula-readout">{readout}</p> : null}
      <div className="formula-row" aria-label="Formula">
        {tokens.length === 0 ? <span className="ui-hint">Pick a field to start.</span> : null}
        {tokens.map((token, index) => (
          <span className="formula-chip" key={`${token.kind}-${index}`}>
            <TokenControl
              token={token}
              inputs={inputs}
              onChange={(next) => {
                const copy = tokens.slice();
                copy[index] = next;
                commit(copy);
              }}
            />
            <button
              type="button"
              className="ui-drag"
              aria-label="Remove"
              onClick={() => commit(tokens.filter((_, item) => item !== index))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="formula-actions">
        <Button
          variant="secondary"
          onClick={() => commit([...tokens, { kind: 'field', key: inputs[0]?.key ?? '' }])}
          disabled={inputs.length === 0}
        >
          Add Field
        </Button>
        <Button
          variant="secondary"
          onClick={() => commit([...tokens, { kind: 'number', value: '1' }])}
        >
          Add Number
        </Button>
        {OPS.map((item) => (
          <Button
            key={item.op}
            variant="secondary"
            onClick={() => commit([...tokens, { kind: 'op', op: item.op }])}
          >
            {item.label}
          </Button>
        ))}
        <Button
          variant="secondary"
          onClick={() => commit([...tokens, { kind: 'paren', side: '(' }])}
        >
          (
        </Button>
        <Button
          variant="secondary"
          onClick={() => commit([...tokens, { kind: 'paren', side: ')' }])}
        >
          )
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            commit([
              ...tokens,
              { kind: 'fn', name: 'ROUND' },
              { kind: 'paren', side: '(' },
              { kind: 'field', key: inputs[0]?.key ?? '' },
              { kind: 'comma' },
              { kind: 'number', value: '2' },
              { kind: 'paren', side: ')' },
            ])
          }
        >
          Round
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            commit([
              ...tokens,
              { kind: 'fn', name: 'MIN' },
              { kind: 'paren', side: '(' },
              { kind: 'field', key: inputs[0]?.key ?? '' },
              { kind: 'comma' },
              { kind: 'field', key: inputs[1]?.key ?? inputs[0]?.key ?? '' },
              { kind: 'paren', side: ')' },
            ])
          }
        >
          Min
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            commit([
              ...tokens,
              { kind: 'fn', name: 'MAX' },
              { kind: 'paren', side: '(' },
              { kind: 'field', key: inputs[0]?.key ?? '' },
              { kind: 'comma' },
              { kind: 'field', key: inputs[1]?.key ?? inputs[0]?.key ?? '' },
              { kind: 'paren', side: ')' },
            ])
          }
        >
          Max
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            commit([
              ...tokens,
              { kind: 'fn', name: 'IF' },
              { kind: 'paren', side: '(' },
              { kind: 'field', key: inputs[0]?.key ?? '' },
              { kind: 'cmp', op: '<' },
              { kind: 'field', key: inputs[1]?.key ?? inputs[0]?.key ?? '' },
              { kind: 'comma' },
              { kind: 'number', value: '1' },
              { kind: 'comma' },
              { kind: 'number', value: '0' },
              { kind: 'paren', side: ')' },
            ])
          }
        >
          If
        </Button>
      </div>
      <SelectField
        label="Rounding"
        value={display === 'money' ? '0' : String(places)}
        onChange={(value) => commit(tokens, { places: Number(value) })}
        disabled={display === 'money'}
      >
        <option value="0">{display === 'money' ? 'Nearest Cent' : 'Whole Number'}</option>
        <option value="1">1 Decimal Place</option>
        <option value="2">2 Decimal Places</option>
        <option value="4">4 Decimal Places</option>
      </SelectField>
      <SelectField
        label="Display As"
        value={display}
        onChange={(value) => commit(tokens, { display: value as FormulaDisplay })}
      >
        <option value="number">Number</option>
        <option value="money">Money</option>
      </SelectField>
      {display === 'number' ? (
        <TextField
          label="Unit"
          hint="Optional, such as m²"
          value={unit}
          onChange={(value) => commit(tokens, { unit: value })}
        />
      ) : (
        <p className="ui-hint">Money is stored in cents and shown in rand.</p>
      )}
      {used.map((key) => {
        const field = inputs.find((item) => item.key === key);
        if (!field) {
          return null;
        }
        return (
          <TextField
            key={key}
            label={`Example ${field.label}`}
            value={samples[key] ?? ''}
            onChange={(value) => setSamples((current) => ({ ...current, [key]: value }))}
          />
        );
      })}
      <p className="example-result" role="status">
        Example Result: {cycle ? cycle : preview.ok ? preview.text : preview.message}
      </p>
    </div>
  );
}

function TokenControl({
  token,
  inputs,
  onChange,
}: {
  token: FormulaToken;
  inputs: readonly FormulaInput[];
  onChange: (token: FormulaToken) => void;
}) {
  if (token.kind === 'field') {
    return (
      <select
        aria-label="Field"
        value={token.key}
        onChange={(event) => onChange({ kind: 'field', key: event.target.value })}
      >
        {inputs.map((field) => (
          <option key={field.key} value={field.key}>
            {field.label}
          </option>
        ))}
      </select>
    );
  }
  if (token.kind === 'number') {
    return (
      <input
        aria-label="Number"
        value={token.value}
        onChange={(event) => onChange({ kind: 'number', value: event.target.value })}
      />
    );
  }
  if (token.kind === 'op') {
    return (
      <select
        aria-label="Operator"
        value={token.op}
        onChange={(event) =>
          onChange({ kind: 'op', op: event.target.value as '+' | '-' | '*' | '/' })
        }
      >
        {OPS.map((item) => (
          <option key={item.op} value={item.op}>
            {item.label}
          </option>
        ))}
      </select>
    );
  }
  if (token.kind === 'cmp') {
    return (
      <select
        aria-label="Comparison"
        value={token.op}
        onChange={(event) =>
          onChange({ kind: 'cmp', op: event.target.value as (typeof COMPARES)[number]['op'] })
        }
      >
        {COMPARES.map((item) => (
          <option key={item.op} value={item.op}>
            {item.label}
          </option>
        ))}
      </select>
    );
  }
  if (token.kind === 'fn') {
    const label =
      token.name === 'ROUND'
        ? 'Round'
        : token.name === 'MIN'
          ? 'Min'
          : token.name === 'MAX'
            ? 'Max'
            : 'If';
    return <span>{label}</span>;
  }
  if (token.kind === 'comma') {
    return <span>,</span>;
  }
  return <span>{token.side}</span>;
}

function readableFormula(
  label: string,
  tokens: readonly FormulaToken[],
  inputs: readonly FormulaInput[],
): string {
  const name = label.trim() || 'Calculated';
  if (tokens.length === 0) {
    return '';
  }
  return `${name} = ${tokens.map((token) => tokenPhrase(token, inputs)).join(' ')}`;
}

function tokenPhrase(token: FormulaToken, inputs: readonly FormulaInput[]): string {
  switch (token.kind) {
    case 'field':
      return inputs.find((field) => field.key === token.key)?.label ?? token.key;
    case 'number':
      return token.value.trim();
    case 'op':
      if (token.op === '*') return '×';
      if (token.op === '/') return '÷';
      if (token.op === '-') return '−';
      return '+';
    case 'paren':
      return token.side;
    case 'fn':
      if (token.name === 'ROUND') return 'Round';
      if (token.name === 'MIN') return 'Min';
      if (token.name === 'MAX') return 'Max';
      return 'If';
    case 'comma':
      return ',';
    case 'cmp':
      return COMPARES.find((item) => item.op === token.op)?.label ?? token.op;
  }
}
