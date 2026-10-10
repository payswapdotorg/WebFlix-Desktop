export class LocalStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends LocalStoreError {}
export class NotFoundError extends LocalStoreError {}
export class DuplicateError extends LocalStoreError {}
export class PathSafetyError extends LocalStoreError {}
export class IndexCancelledError extends LocalStoreError {}

export class MigrationError extends LocalStoreError {}
export class MigrationHashMismatchError extends MigrationError {}

export class BackupError extends LocalStoreError {}
export class BackupValidationError extends BackupError {}
export class BackupHashMismatchError extends BackupError {}

export class SqliteUnavailableError extends LocalStoreError {}
