/**
 * A JSON number of a settings file as the file wrote it (specs/010-app-settings,
 * research R1): its text, to tell `1` from `1.0` and to keep `cpus` as
 * written, and its value. Moved here from shape.ts, which still gives it, so
 * that build-shape.ts reads it without importing shape.ts, which imports
 * build-shape.ts (specs/016-build-from-source, tasks T105).
 */
export class JsonNumber {
  constructor(
    readonly text: string,
    readonly value: number
  ) {}
}
