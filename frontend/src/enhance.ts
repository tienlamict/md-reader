// Post-processing of a rendered document: copy buttons on code blocks,
// KaTeX for math and mermaid for diagrams. KaTeX and mermaid are large, so
// they are loaded only when a document actually needs them.
import type {Mermaid} from 'mermaid';
import {ClipboardSetText} from '../wailsjs/runtime/runtime';
import {escapeHtml, icon, showError} from './ui';

// ---------- Copy buttons ----------

export function addCopyButtons(doc: HTMLElement) {
    doc.querySelectorAll('pre').forEach((pre) => {
        if (pre.closest('.mermaid-block') || pre.parentElement?.classList.contains('code-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'code-wrap';
        pre.replaceWith(wrap);
        wrap.appendChild(pre);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy';
        btn.title = 'Sao chép';
        btn.setAttribute('aria-label', 'Sao chép code');
        btn.innerHTML = icon('copy');
        wrap.appendChild(btn);
    });
}

/** Handles clicks on copy buttons; returns true if the click was one. */
export function handleCopyClick(e: MouseEvent): boolean {
    const btn = (e.target as Element).closest<HTMLButtonElement>('.code-copy');
    if (!btn) return false;
    const pre = btn.parentElement?.querySelector('pre');
    if (!pre) return true;
    // textContent, not innerText: chroma lays lines out as flex boxes, which
    // makes innerText add an extra blank line after each one.
    ClipboardSetText((pre.textContent ?? '').replace(/\n$/, ''))
        .then((ok) => {
            if (!ok) throw new Error('Không sao chép được vào clipboard.');
            btn.innerHTML = icon('check');
            btn.classList.add('copied');
            window.setTimeout(() => {
                btn.innerHTML = icon('copy');
                btn.classList.remove('copied');
            }, 1500);
        })
        .catch(showError);
    return true;
}

// ---------- Math ----------

export async function renderMath(doc: HTMLElement) {
    const els = [...doc.querySelectorAll<HTMLElement>('.math:not([data-tex])')];
    if (els.length === 0) return;
    const [{default: katex}] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
    for (const el of els) {
        const tex = el.textContent ?? '';
        el.dataset.tex = tex;
        katex.render(tex, el, {
            displayMode: el.classList.contains('math-display'),
            throwOnError: false, // show the bad part in red instead of failing
            output: 'htmlAndMathml',
        });
    }
}

/** Converts rendered math to MathML only (needs no CSS or fonts). */
export async function mathToMathML(doc: HTMLElement) {
    const els = [...doc.querySelectorAll<HTMLElement>('.math[data-tex]')];
    if (els.length === 0) return;
    const {default: katex} = await import('katex');
    for (const el of els) {
        el.innerHTML = katex.renderToString(el.dataset.tex ?? '', {
            displayMode: el.classList.contains('math-display'),
            throwOnError: false,
            output: 'mathml',
        });
        el.removeAttribute('data-tex');
    }
}

// ---------- Mermaid ----------

let mermaid: Mermaid | null = null;
let mermaidTheme = '';
let seq = 0;
let queue: Promise<void> = Promise.resolve();
const cache = new Map<string, string>(); // theme + source -> svg
const CACHE_LIMIT = 200; // live editing creates many versions of a diagram

function remember(key: string, svg: string) {
    cache.set(key, svg);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

function showSvg(block: HTMLElement, svg: string, theme: string) {
    block.classList.remove('is-error');
    block.classList.add('is-rendered');
    block.dataset.theme = theme;
    block.innerHTML = svg;
}

/**
 * Synchronously puts already-rendered diagrams back, so re-rendering the
 * preview while typing does not flash the diagram source.
 */
export function fillMermaidFromCache(doc: HTMLElement, dark: boolean) {
    const theme = dark ? 'dark' : 'default';
    doc.querySelectorAll<HTMLElement>('.mermaid-block:not(.is-rendered)').forEach((block) => {
        const source = block.dataset.source ?? block.textContent ?? '';
        const svg = cache.get(`${theme}\n${source}`);
        if (!svg) return;
        block.dataset.source = source;
        showSvg(block, svg, theme);
    });
}

/** Renders every diagram in doc. Calls are queued so themes never mix. */
export function renderMermaid(doc: HTMLElement, dark: boolean): Promise<void> {
    queue = queue.then(() => doRenderMermaid(doc, dark)).catch(showError);
    return queue;
}

async function doRenderMermaid(doc: HTMLElement, dark: boolean) {
    const blocks = [...doc.querySelectorAll<HTMLElement>('.mermaid-block')];
    if (blocks.length === 0) return;
    mermaid ??= (await import('mermaid')).default;

    const theme = dark ? 'dark' : 'default';
    if (mermaidTheme !== theme) {
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
        });
        mermaidTheme = theme;
    }

    for (const block of blocks) {
        if (!block.isConnected) return; // document was replaced meanwhile
        if (block.classList.contains('is-rendered') && block.dataset.theme === theme) continue;
        const source = block.dataset.source ?? block.textContent ?? '';
        block.dataset.source = source;
        const key = `${theme}\n${source}`;
        let svg = cache.get(key);
        if (!svg) {
            const id = `mmd-${++seq}`;
            try {
                svg = (await mermaid.render(id, source)).svg;
                remember(key, svg);
            } catch (err) {
                document.getElementById(id)?.remove();
                document.getElementById(`d${id}`)?.remove();
                block.classList.add('is-error');
                block.classList.remove('is-rendered');
                block.innerHTML = `<div class="mermaid-error">Lỗi sơ đồ mermaid: ${escapeHtml(String((err as Error)?.message ?? err))}</div>` +
                    `<pre class="mermaid-source">${escapeHtml(source)}</pre>`;
                continue;
            }
        }
        if (!block.isConnected) return;
        showSvg(block, svg, theme);
    }
}
