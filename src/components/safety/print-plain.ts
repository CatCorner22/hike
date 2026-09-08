export type PrintablePopup = {
  opener: unknown;
  document: {
    open(): unknown;
    write(markup: string): void;
    close(): void;
  };
  focus(): void;
  print(): void;
  close(): void;
};

export type OpenPrintablePopup = () => PrintablePopup | null;

/**
 * Reports whether the file was actually saved. It used to return void, which
 * inside WKWebView meant "downloaded" was printed for an `<a download>` click
 * the engine had ignored — the print fallback claimed a file that did not exist.
 */
type DownloadPlainText = (filename: string, body: string, mime: string) => Promise<boolean>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function printableDocument(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font:14px/1.45 ui-monospace,monospace;padding:24px;white-space:pre-wrap">${escapeHtml(body)}</body></html>`;
}

function openBrowserPopup(): PrintablePopup | null {
  // `noopener` makes modern browsers return null even when the new tab opened,
  // so open same-origin about:blank and sever the reference before writing.
  return window.open("", "_blank", "width=720,height=900");
}

export function printPlain(
  title: string,
  body: string,
  openPopup: OpenPrintablePopup = openBrowserPopup,
): boolean {
  const popup = openPopup();
  if (!popup) return false;

  try {
    popup.opener = null;
    if (popup.opener !== null) throw new Error("Could not isolate print window");

    popup.document.open();
    popup.document.write(printableDocument(title, body));
    popup.document.close();

    // Fail closed if document creation unexpectedly restored an opener.
    if (popup.opener !== null) throw new Error("Print window regained an opener");
    popup.focus();
    popup.print();
    return true;
  } catch {
    try {
      popup.close();
    } catch {
      // A failed or already-closed popup still falls back to a text download.
    }
    return false;
  }
}

export async function printOrDownloadPlain(
  input: { title: string; body: string; filename: string },
  dependencies: {
    download: DownloadPlainText;
    openPopup?: OpenPrintablePopup;
  },
): Promise<"printed" | "downloaded" | "failed"> {
  if (printPlain(input.title, input.body, dependencies.openPopup)) return "printed";
  return (await dependencies.download(input.filename, input.body, "text/plain"))
    ? "downloaded"
    : "failed";
}
