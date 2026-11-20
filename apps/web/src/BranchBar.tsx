import { useToast } from '@omnivate/ui';
import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';

type BranchChoice = { id: string; name: string; code: string };

type Context = {
  multiBranch: boolean;
  current: BranchChoice | null;
  branches: BranchChoice[];
};

/** Current branch in the header. Hidden while the company uses one branch. */
export function BranchBar() {
  const notify = useToast();
  const [context, setContext] = useState<Context | null>(null);

  useEffect(() => {
    let cancelled = false;
    api('/krn/branches/context')
      .then(({ status, body }) => {
        if (cancelled || status !== 200 || !body || typeof body !== 'object') {
          return;
        }
        setContext(body as Context);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!context?.multiBranch || context.branches.length === 0) {
    return null;
  }

  if (context.branches.length === 1) {
    return (
      <p className="ui-branch-picker">
        Branch <strong>{context.branches[0]?.name}</strong>
      </p>
    );
  }

  return (
    <label className="ui-branch-picker">
      Branch
      <select
        aria-label="Current Branch"
        value={context.current?.id ?? ''}
        onChange={(event) => {
          const branchId = event.target.value;
          void api('/krn/branches/current', {
            method: 'PUT',
            body: JSON.stringify({ branchId }),
          }).then(({ status, body }) => {
            if (status >= 400) {
              notify({ title: errorMessage(body, 'The branch was not changed.'), tone: 'bad' });
              return;
            }
            const next = context.branches.find((branch) => branch.id === branchId) ?? null;
            setContext({ ...context, current: next });
            if (next) {
              notify({ title: `Working at ${next.name}.` });
            }
          });
        }}
      >
        {context.branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
