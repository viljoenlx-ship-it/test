export class LedgerError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'LedgerError';
    this.statusCode = statusCode;
  }
}
