/** Triggers a text download as a file (bundle export). DOM-only (not unit-tested). */
export function downloadText(filename: string, contents: string, mime = 'application/json'): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Reads a text file (bundle import). */
export function readFileText(file: File): Promise<string> {
  return file.text();
}
