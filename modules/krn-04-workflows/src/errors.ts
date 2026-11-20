/** A workflow rule the caller can fix. Permission and segregation errors stay in the kernel. */
export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowError';
  }
}
