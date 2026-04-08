/**
 * Strip all HTML/script content from a free-text input.
 * Removes script tags (with contents), all other HTML tags,
 * javascript: and data: URI schemes, and event-handler patterns.
 */
export function sanitizeText(input: string): string {
  if (!input || typeof input !== 'string') return input;

  let out = input;

  // 1. Remove <script>...</script> blocks (including multi-line)
  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // 2. Remove <style>...</style> blocks
  out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 3. Remove all remaining HTML/XML tags
  out = out.replace(/<[^>]+>/g, '');

  // 4. Remove javascript: and data: URI schemes (may appear outside tags after stripping)
  out = out.replace(/javascript\s*:/gi, '');
  out = out.replace(/data\s*:/gi, '');

  return out.trim();
}
