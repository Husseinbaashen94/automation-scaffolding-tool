/** A mistake in how a command was called, or a target that doesn't exist. Exit code 2, nothing changed. */
export class UsageError extends Error {
  /** showHint: whether to point at --help (not useful for e.g. a disk error). */
  constructor(message: string, readonly showHint = true) {
    super(message);
    this.name = 'UsageError';
  }
}
