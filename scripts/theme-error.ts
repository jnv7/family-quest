export class ThemeValidationError extends Error {
  readonly file: string;
  readonly jsonPath: string;

  constructor(file: string, jsonPath: string, message: string) {
    super(`${file}: ${jsonPath || '/'}: ${message}`);
    this.name = 'ThemeValidationError';
    this.file = file;
    this.jsonPath = jsonPath;
  }
}
