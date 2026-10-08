import type { z } from 'zod';

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export function validationError(err: z.ZodError): ErrorBody {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return { error: { code: 'VALIDATION', message: 'Please check the highlighted fields.', fields } };
}
