/** Trigger a browser download from a Blob response. Shared by
 * api/ipRecords.ts (CSV export) and api/files.ts (file download) — was
 * previously duplicated as a local function in ipRecords.ts. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
