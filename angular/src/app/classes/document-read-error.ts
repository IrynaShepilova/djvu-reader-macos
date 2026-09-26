export class DocumentReadError extends Error {
  constructor(cause?: unknown) {
    super('This book could not be read. It may be corrupted or use an unsupported document feature.');
    this.name = 'DocumentReadError';
    this.cause = cause;
  }
}
