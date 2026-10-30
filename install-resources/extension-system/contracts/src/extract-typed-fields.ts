export const EXTRACT_TYPED_FIELDS_METHOD = "mocu.extract.typed_fields" as const;

export type ExtractTypedFieldType =
  | "text"
  | "number"
  | "date"
  | "datetime"
  | "time"
  | "duration"
  | "list"
  | "estimate"
  | "forecast";

/** A typed output field; additional options depend on the selected type. */
export interface ExtractTypedFieldDefinition {
  type: ExtractTypedFieldType;
  [option: string]: unknown;
}

export interface ExtractTypedFieldsParams {
  state: string | Record<string, unknown> | unknown[];
  fields: Record<string, ExtractTypedFieldDefinition>;
  reference_date?: string;
}

/** The Extractions API's answers are keyed by the caller-defined field names. */
export interface ExtractTypedFieldsResult {
  answers: Record<string, unknown>;
  [metadata: string]: unknown;
}
