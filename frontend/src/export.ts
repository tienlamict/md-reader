// Builds a standalone HTML file from the document as currently shown:
// diagrams stay as SVG, math becomes MathML (no fonts needed), local images
// are embedded as data URIs, and the GitHub CSS of the current theme is inlined.
import lightCss from 'github-markdown-css/github-markdown-light.css?raw';
import darkCss from 'github-markdown-css/github-markdown-dark.css?raw';
import {mathToMathML} from './enhance';
import {highlightCss} from './theme';
import {escapeHtml} from './ui';

const pageCss = (dark: boolean) => `
* { box-sizing: border-box; }
body { margin: 0; }
.markdown-body { min-width: 200px; max-width: 980px; margin: 0 auto; padding: 45px; }
@media (max-width: 767px) { .markdown-body { padding: 15px; } }
.markdown-body .task-list-item input[type="checkbox"] { margin: 0 0.2em 0.25em -1.4em; vertical-align: middle; }
.markdown-body .mermaid-block { margin-bottom: 16px; text-align: center; overflow-x: auto; }
.markdown-body .mermaid-block svg { max-width: 100%; height: auto; }
.markdown-body .mermaid-block pre { text-align: left; }
.markdown-body .mermaid-error { margin-bottom: 8px; padding: 8px 12px; text-align: left; white-space: pre-wrap;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
  color: ${dark ? "#ff7b72" : "#d1242f"}; background: ${dark ? "#25171c" : "#ffebe9"}; border-radius: 6px; }
.markdown-body .math-display { display: block; margin: 0 0 16px; overflow-x: auto; overflow-y: hidden; text-align: center; }
`;

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

export async function buildStandaloneHtml(doc: HTMLElement, title: string, dark: boolean): Promise<string> {
    const clone = doc.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.removeAttribute('hidden');
    clone.style.removeProperty('zoom');
    clone.querySelectorAll('.code-copy').forEach((b) => b.remove());
    clone.querySelectorAll('.anchor-hit').forEach((el) => el.classList.remove('anchor-hit'));

    await mathToMathML(clone);

    await Promise.all([...clone.querySelectorAll<HTMLImageElement>('img[src^="/__local"]')].map(async (img) => {
        try {
            const res = await fetch(img.getAttribute('src')!);
            if (res.ok) img.src = await blobToDataUrl(await res.blob());
        } catch {
            // leave the broken reference; the rest of the page still exports
        }
    }));

    const hl = highlightCss();
    const bg = dark ? '#0d1117' : '#ffffff';
    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MD Reader">
<title>${escapeHtml(title)}</title>
<style>
${dark ? darkCss : lightCss}
${dark ? hl.dark : hl.light}
body { background: ${bg}; }
${pageCss(dark)}
</style>
</head>
<body>
<article class="markdown-body">
${clone.innerHTML}
</article>
</body>
</html>
`;
}
