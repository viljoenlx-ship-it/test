import { fieldTypeLabel } from '@omnivate/shared';
import { Badge, Card, Skeleton } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';

type Summary = {
  fieldCount: number;
  pipelineCount: number;
  ruleCount: number;
  fields: {
    entityLabel: string;
    label: string;
    fieldType: string;
    required: boolean;
    archived: boolean;
  }[];
  pipelines: { label: string; entityLabel: string; stages: string[] }[];
  rules: { name: string; summary: string; enabled: boolean; archived: boolean }[];
};

/** Read-only. The company changes these in its own settings. */
export function WorkflowSummary({ tenantId }: { tenantId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let cancelled = false;
    api(`/control/tenants/${tenantId}/workflows`).then(({ status, body }) => {
      if (cancelled) {
        return;
      }
      if (status !== 200 || !body || typeof body !== 'object') {
        setProblem(errorMessage(body, 'Custom fields could not be loaded.'));
        return;
      }
      setSummary(body as Summary);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (problem) {
    return (
      <Card title="Custom Fields And Stages">
        <p>{problem}</p>
      </Card>
    );
  }
  if (!summary) {
    return <Skeleton lines={4} />;
  }

  const activeFields = summary.fields.filter((field) => !field.archived);
  return (
    <Card title="Custom Fields And Stages">
      <p className="ui-hint">
        Read only. Use Custom Fields to change the field list. The company still edits stages and
        alerts.
      </p>
      <p>
        {summary.fieldCount} custom fields · {summary.pipelineCount} stage lists ·{' '}
        {summary.ruleCount} alerts
      </p>
      {activeFields.slice(0, 8).map((field) => (
        <p key={`${field.entityLabel}-${field.label}`}>
          <strong>{field.label}</strong> on {field.entityLabel}
          <Badge tone="neutral">
            {fieldTypeLabel(
              field.fieldType === 'text' ||
                field.fieldType === 'number' ||
                field.fieldType === 'money' ||
                field.fieldType === 'date' ||
                field.fieldType === 'select' ||
                field.fieldType === 'multi_select' ||
                field.fieldType === 'checkbox' ||
                field.fieldType === 'calculated'
                ? field.fieldType
                : 'text',
            )}
          </Badge>
          {field.required ? ' Required' : ''}
        </p>
      ))}
      {summary.pipelines.map((pipeline) => (
        <p key={pipeline.label}>
          <strong>{pipeline.label}</strong>: {pipeline.stages.join(' → ')}
        </p>
      ))}
      {summary.rules
        .filter((rule) => !rule.archived)
        .map((rule) => (
          <p key={rule.name}>
            <strong>{rule.name}.</strong> {rule.summary}
          </p>
        ))}
    </Card>
  );
}
