import lightCssUrl from 'github-markdown-css/github-markdown-light.css?url';
import darkCssUrl from 'github-markdown-css/github-markdown-dark.css?url';
import './style.css';

import {
    GetTheme,
    HighlightCSS,
    LoadFile,
    OpenFileDialog,
    RevealInExplorer,
    ResolveLink,
} from '../wailsjs/go/main/App';
import {BrowserOpenURL, EventsOn} from '../wailsjs/runtime/runtime';

type Theme = 'system' | 'light' | 'dark';

const welcomeEl = document.getElementById('welcome')!;
const docEl = document.getElementById('doc')!;
const errorEl = document.getElementById('error')!;

// ---------- Theme ----------
// Light and dark stylesheets are both loaded; the `media` attribute decides
// which one applies, so "system" simply follows prefers-color-scheme.

function addLink(href: string): HTMLLinkElement {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return link;
}

function addStyle(css: string): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return style;
}

const lightSheets: (HTMLLinkElement | HTMLStyleElement)[] = [addLink(lightCssUrl)];
const darkSheets: (HTMLLinkElement | HTMLStyleElement)[] = [addLink(darkCssUrl)];

function applyTheme(theme: Theme) {
    const media = {
        system: ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'],
        light: ['all', 'not all'],
        dark: ['not all', 'all'],
    }[theme] ?? ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'];
    lightSheets.forEach((s) => (s.media = media[0]));
    darkSheets.forEach((s) => (s.media = media[1]));
    if (theme === 'system') {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = theme;
    }
}

// ---------- Errors ----------

let errorTimer: number | undefined;

function showError(err: unknown) {
    errorEl.textContent = String(err).replace(/^Error:\s*/, '');
    errorEl.hidden = false;
    window.clearTimeout(errorTimer);
    errorTimer = window.setTimeout(() => (errorEl.hidden = true), 6000);
}

// ---------- Document ----------

interface HistoryEntry {
    path: string;
    scrollY: number;
}

let currentPath = '';
const back: HistoryEntry[] = [];
const forward: HistoryEntry[] = [];

const isRemote = (src: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src);

/** Point relative <img> sources at the Go middleware that serves local images. */
function rewriteImages(docPath: string) {
    docEl.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
        const src = img.getAttribute('src')!;
        if (isRemote(src)) return;
        img.src = `/__local?doc=${encodeURIComponent(docPath)}&src=${encodeURIComponent(src)}`;
    });
}

function scrollToAnchor(fragment: string): boolean {
    if (!fragment) return false;
    const el = document.getElementById(fragment) ?? document.getElementById(fragment.toLowerCase());
    if (!el) return false;
    el.scrollIntoView({block: 'start'});
    el.classList.remove('anchor-hit');
    void el.offsetWidth; // restart the highlight animation
    el.classList.add('anchor-hit');
    return true;
}

/** Render a file. `scrollTo` is an anchor or a saved scroll position. */
async function show(path: string, scrollTo: string | number = 0) {
    const doc = await LoadFile(path);
    currentPath = doc.path;
    docEl.innerHTML = doc.html;
    rewriteImages(doc.path);
    welcomeEl.hidden = true;
    docEl.hidden = false;

    if (typeof scrollTo === 'string') {
        if (!scrollToAnchor(scrollTo)) window.scrollTo(0, 0);
    } else {
        window.scrollTo(0, scrollTo);
    }
}

/** Open a file as a new history step. */
async function open(path: string, fragment = '') {
    try {
        const previous = currentPath ? {path: currentPath, scrollY: window.scrollY} : null;
        await show(path, fragment);
        if (previous && previous.path !== currentPath) {
            back.push(previous);
            forward.length = 0;
        }
    } catch (err) {
        showError(err);
    }
}

async function navigate(from: HistoryEntry[], to: HistoryEntry[]) {
    const entry = from.pop();
    if (!entry) return;
    try {
        const here = {path: currentPath, scrollY: window.scrollY};
        await show(entry.path, entry.scrollY);
        to.push(here);
    } catch (err) {
        from.push(entry);
        showError(err);
    }
}

async function reload() {
    if (!currentPath) return;
    try {
        await show(currentPath, window.scrollY);
    } catch (err) {
        showError(err);
    }
}

async function pickAndOpen() {
    try {
        const path = await OpenFileDialog();
        if (path) await open(path);
    } catch (err) {
        showError(err);
    }
}

// ---------- Links ----------

docEl.addEventListener('click', async (e) => {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    e.preventDefault();

    try {
        const target = await ResolveLink(currentPath, href);
        switch (target.kind) {
            case 'anchor':
                scrollToAnchor(target.fragment ?? '');
                break;
            case 'external':
                BrowserOpenURL(target.url!);
                break;
            case 'markdown':
                await open(target.path!, target.fragment ?? '');
                break;
            case 'file':
                await RevealInExplorer(target.path!);
                break;
        }
    } catch (err) {
        showError(err);
    }
});

// Mouse back/forward buttons.
window.addEventListener('mouseup', (e) => {
    if (e.button === 3) navigate(back, forward);
    if (e.button === 4) navigate(forward, back);
});

// ---------- Wiring ----------

document.getElementById('open-btn')!.addEventListener('click', pickAndOpen);

EventsOn('file:open', (path: string) => open(path));
EventsOn('file:reload', reload);
EventsOn('nav:back', () => navigate(back, forward));
EventsOn('nav:forward', () => navigate(forward, back));
EventsOn('theme:changed', (theme: Theme) => applyTheme(theme));

async function init() {
    const css = await HighlightCSS();
    lightSheets.push(addStyle(css.light));
    darkSheets.push(addStyle(css.dark));
    applyTheme((await GetTheme()) as Theme);
}

init().catch(showError);

// Expose for manual testing from the dev browser console.
Object.assign(window, {mdReader: {open, reload, applyTheme}});
