/** A mistake in how a command was called, or a target that doesn't exist. Exit code 2, nothing changed. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
