import type { ModuleIndexEntry } from '@omnivate/shared';
import { Card, EmptyState, PageHeader } from '@omnivate/ui';

export function ModuleOverview({
  entry,
  mode,
}: {
  entry: ModuleIndexEntry;
  mode: 'soon' | 'locked';
}) {
  const soon = mode === 'soon';
  return (
    <>
      <PageHeader title={entry.name} description={entry.summary} />
      <Card>
        <EmptyState
          title={soon ? 'Coming Soon' : 'Not In Your Package'}
          body={
            soon
              ? `${entry.name} will be ready here. You can keep working in the sections that are already open.`
              : `${entry.name} is switched off for this company. Ask the person who looks after Omnivate if you need it.`
          }
        />
      </Card>
    </>
  );
}
