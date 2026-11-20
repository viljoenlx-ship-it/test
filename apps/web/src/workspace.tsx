import { defaultColumnLayouts, type ColumnLayouts } from '@omnivate/shared';
import { createContext, useContext, type ReactNode } from 'react';

type WorkspaceValue = {
  layouts: ColumnLayouts;
  readOnly: boolean;
};

const WorkspaceContext = createContext<WorkspaceValue>({
  layouts: defaultColumnLayouts(),
  readOnly: false,
});

export function WorkspaceProvider({
  layouts,
  readOnly = false,
  children,
}: {
  layouts: ColumnLayouts;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={{ layouts, readOnly }}>{children}</WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceValue {
  return useContext(WorkspaceContext);
}
