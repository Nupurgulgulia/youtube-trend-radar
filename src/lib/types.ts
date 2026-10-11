// Shared shapes used across the pipeline.

// Ishaan's editable settings (map step 1). Keyword order is priority order:
// when the quota budget is tight, keywords at the end are skipped first.
export type Settings = {
  categories: string[];
  keywords: string[];
  regionCode: string;
  relevanceLanguage: string;
  categoryIds: number[];
  email: string;
};
