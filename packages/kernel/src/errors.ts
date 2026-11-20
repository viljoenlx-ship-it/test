export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';

  constructor(message = 'You do not have permission for this action.') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export class IdentityRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityRuleError';
  }
}

export class SodConflictError extends Error {
  readonly code = 'SOD_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'SodConflictError';
  }
}

/** The person cannot work at the branch a later module is about to use. */
export class BranchAccessError extends Error {
  readonly code = 'BRANCH_ACCESS_DENIED';

  constructor(message: string) {
    super(message);
    this.name = 'BranchAccessError';
  }
}
