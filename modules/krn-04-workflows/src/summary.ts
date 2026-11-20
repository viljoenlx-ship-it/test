import { asc } from 'drizzle-orm';
import type { TenantTransaction } from '@omnivate/kernel';
import { describeRule } from './workflows';
import { fieldDefinitions, pipelines, workflowRules } from './tables';

export type WorkflowSummary = {
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

/** Read-only picture for the control panel. The company edits these in its own settings. */
export async function workflowSummary(tx: TenantTransaction): Promise<WorkflowSummary> {
  const fields = await tx.db
    .select()
    .from(fieldDefinitions)
    .orderBy(asc(fieldDefinitions.sortOrder));
  const pipes = await tx.db.select().from(pipelines).orderBy(asc(pipelines.label));
  const rules = await tx.db.select().from(workflowRules).orderBy(asc(workflowRules.name));
  return {
    fieldCount: fields.filter((row) => row.archivedAt === null).length,
    pipelineCount: pipes.filter((row) => row.archivedAt === null).length,
    ruleCount: rules.filter((row) => row.archivedAt === null && row.enabled).length,
    fields: fields.map((row) => ({
      entityLabel: row.entityLabel,
      label: row.label,
      fieldType: row.fieldType,
      required: row.required,
      archived: row.archivedAt !== null,
    })),
    pipelines: pipes.map((row) => {
      const base = Array.isArray(row.baseStates) ? row.baseStates : [];
      const extra = Array.isArray(row.extraStates) ? row.extraStates : [];
      const stages = [...base, ...extra].flatMap((item) => {
        if (!item || typeof item !== 'object' || !('label' in item)) {
          return [];
        }
        const label = (item as { label?: unknown }).label;
        return typeof label === 'string' ? [label] : [];
      });
      return { label: row.label, entityLabel: row.entityLabel, stages };
    }),
    rules: rules.map((row) => {
      const view = {
        name: row.name,
        entityType: row.entityType,
        triggerKind:
          row.triggerKind === 'transition' ? ('transition' as const) : ('event' as const),
        eventKey: row.eventKey,
        machineKey: row.machineKey,
        transitionKey: row.transitionKey,
        conditions: [],
        actionKind: row.actionKind,
        actionConfig:
          row.actionConfig && typeof row.actionConfig === 'object'
            ? (row.actionConfig as Record<string, unknown>)
            : {},
        enabled: row.enabled,
      };
      return {
        name: row.name,
        summary: describeRule(view),
        enabled: row.enabled,
        archived: row.archivedAt !== null,
      };
    }),
  };
}
