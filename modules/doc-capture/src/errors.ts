export class DocumentError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'document',
  ) {
    super(message);
    this.name = 'DocumentError';
  }
}
