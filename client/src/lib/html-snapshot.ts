// Builds a self-contained, static HTML copy of a rendered Project Wrapped page.
// The copy is a snapshot: it carries the numbers as they were when it was taken,
// never fetches data, and opens offline from a single file.

/** Elements marked with this attribute are left out of the snapshot. */
export const SNAPSHOT_EXCLUDE_ATTR = "data-snapshot-exclude";

export function snapshotFileName(projectName: string, takenAt: Date): string {
  const slug =
    projectName
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "project";
  const day = takenAt.toISOString().slice(0, 10);
  return `${slug}-wrapped-snapshot-${day}.html`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Keeps inlined CSS from closing the <style> element early.
function safeCss(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

// Without JavaScript everything stays visible; with it, each slide fades in as
// it scrolls into view, echoing the live app.
const REVEAL_CSS = `
html { scroll-padding-top: 56px; }
html.snapshot-js [data-snapshot-slide] { opacity: 0; transform: translateY(24px); transition: opacity .7s ease, transform .7s ease; }
html.snapshot-js [data-snapshot-slide].snapshot-in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { html.snapshot-js [data-snapshot-slide] { opacity: 1; transform: none; transition: none; } }
@media print { html.snapshot-js [data-snapshot-slide] { opacity: 1; transform: none; } .snapshot-banner { position: static; } }
.snapshot-banner { position: sticky; top: 0; z-index: 60; display: flex; flex-wrap: wrap; gap: 4px 12px; justify-content: center; align-items: center;
  padding: 8px 16px; font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4f1fa;
  background: rgba(20, 14, 32, .88); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255,255,255,.12); text-align: center; }
.snapshot-banner strong { color: #fff; }
`;

const REVEAL_SCRIPT = `
(function () {
  var slides = document.querySelectorAll("[data-snapshot-slide]");
  if (!("IntersectionObserver" in window) || !slides.length) return;
  document.documentElement.classList.add("snapshot-js");
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("snapshot-in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  slides.forEach(function (s) { io.observe(s); });
})();
`;

export interface SnapshotParts {
  projectName: string;
  takenAt: Date;
  /** Attributes copied from the live <html> element, already serialized (e.g. ` class="dark"`). */
  htmlAttributes: string;
  /** All same-origin CSS, inlined. */
  css: string;
  /** <link> tags for cross-origin stylesheets (web fonts) kept as-is. */
  externalStyleLinks: string[];
  /** Serialized attributes of the live <body>. */
  bodyAttributes: string;
  /** The rendered recap markup. */
  bodyHtml: string;
}

export function buildSnapshotHtml(parts: SnapshotParts): string {
  const title = `${parts.projectName} · Project Wrapped (snapshot)`;
  const taken = parts.takenAt.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
  return [
    "<!DOCTYPE html>",
    `<html${parts.htmlAttributes}>`,
    "<head>",
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<meta name="generator" content="Project Wrapped (static snapshot)" />',
    `<meta name="snapshot-taken-at" content="${parts.takenAt.toISOString()}" />`,
    `<title>${escapeHtml(title)}</title>`,
    ...parts.externalStyleLinks,
    `<style>${safeCss(parts.css)}</style>`,
    `<style>${REVEAL_CSS}</style>`,
    "</head>",
    `<body${parts.bodyAttributes}>`,
    `<div class="snapshot-banner" role="note"><span><strong>Static snapshot</strong> of ${escapeHtml(parts.projectName)}</span><span>taken ${escapeHtml(taken)}</span><span>Not live: numbers won't update.</span></div>`,
    parts.bodyHtml,
    `<script>${REVEAL_SCRIPT}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Browser-only part: reads the live document.
// ---------------------------------------------------------------------------

function serializeAttributes(el: Element, skip: string[] = []): string {
  return Array.from(el.attributes)
    .filter((a) => !skip.includes(a.name))
    .map((a) => ` ${a.name}="${escapeHtml(a.value)}"`)
    .join("");
}

function collectCss(doc: Document): { css: string; externalStyleLinks: string[] } {
  const chunks: string[] = [];
  const externalStyleLinks: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      chunks.push(Array.from(sheet.cssRules).map((r) => r.cssText).join("\n"));
    } catch {
      // Cross-origin sheet (Google Fonts): its rules can't be read, so link it.
      // Fonts load when online and fall back to system fonts offline.
      if (sheet.href) externalStyleLinks.push(`<link rel="stylesheet" href="${escapeHtml(sheet.href)}" />`);
    }
  }
  return { css: chunks.join("\n"), externalStyleLinks };
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Serializes `root` (the rendered recap) into a standalone HTML document.
 * Call it only once every slide is in its final, revealed state.
 */
export async function captureSnapshotHtml(root: HTMLElement, projectName: string, takenAt = new Date()): Promise<string> {
  const doc = root.ownerDocument;
  const clone = root.cloneNode(true) as HTMLElement;

  clone.querySelectorAll(`[${SNAPSHOT_EXCLUDE_ATTR}], script, noscript, template`).forEach((el) => el.remove());
  // Mark slides so the snapshot can fade them in on scroll.
  clone.querySelectorAll("section[data-testid^='slide-']").forEach((el) => el.setAttribute("data-snapshot-slide", ""));
  // Buttons left in the copy have no handlers; keep them visible but inert.
  clone.querySelectorAll("button").forEach((b) => b.setAttribute("tabindex", "-1"));

  // Inline same-origin images so the file works on its own.
  const images = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      const abs = new URL(src, doc.baseURI);
      if (abs.origin !== doc.location.origin) return;
      const data = await toDataUrl(abs.href);
      if (data) img.setAttribute("src", data);
      else img.remove();
    })
  );

  const { css, externalStyleLinks } = collectCss(doc);
  return buildSnapshotHtml({
    projectName,
    takenAt,
    htmlAttributes: serializeAttributes(doc.documentElement),
    css,
    externalStyleLinks,
    bodyAttributes: serializeAttributes(doc.body, ["style"]),
    bodyHtml: clone.outerHTML,
  });
}

export function downloadHtml(html: string, fileName: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
