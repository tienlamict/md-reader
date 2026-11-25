import './style.css';

import {
    AddRecentFile,
    GetRecentFiles,
    GetSession,
    GetStartupArgs,
    GetTheme,
    HighlightCSS,
    LoadFile,
    OpenFileDialog,
    OpenFolderDialog,
    RevealInExplorer,
    ResolveLink,
    SaveHTML,
    SaveSession,
    WatchFiles,
} from '../wailsjs/go/main/App';
import {BrowserOpenURL, EventsOn, WindowSetTitle} from '../wailsjs/runtime/runtime';
import {addCopyButtons, handleCopyClick, renderMath, renderMermaid} from './enhance';
import {buildStandaloneHtml} from './export';
import {FindBar} from './find';
import {addHighlightCss, applyTheme, isDark, onAppearanceChange, type Theme} from './theme';
import {type HeadingInfo, Toc} from './toc';
import {FileTree} from './tree';
import {baseName, escapeHtml, icon, samePath, showError, showToast} from './ui';

// ---------- Elements ----------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const appEl = $('app');
const contentEl = $('content');
const docEl = $('doc');
const welcomeEl = $('welcome');
const tabbarEl = $('tabbar');

// ---------- State ----------

interface HistoryEntry {
    path: string;
    scrollTop: number;
}

interface Tab {
    id: number;
    path: string;
    name: string;
    html: string;
    headings: HeadingInfo[];
    scrollTop: number;
    back: HistoryEntry[];
    forward: HistoryEntry[];
    missing: boolean; // file deleted/unreadable since it was loaded
}

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const state = {
    tabs: [] as Tab[],
    active: null as Tab | null,
    zoom: 1,
    showSidebar: true,
    showToc: true,
};
let nextTabId = 1;

const toc = new Toc($('toc-list'), contentEl, docEl, (id) => scrollToAnchor(id));
const find = new FindBar($('findbar'), docEl, contentEl);
const tree = new FileTree($('tree'), $('folder-name'), $('tree-empty'), {
    onOpen: (path, newTab) => openFile(path, {newTab}),
    onError: showError,
});

// ---------- Session ----------

let saveTimer: number | undefined;

function saveSession() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        SaveSession({
            tabs: state.tabs.map((t) => t.path),
            active: state.active?.path ?? '',
            folder: tree.root,
            showSidebar: state.showSidebar,
            showToc: state.showToc,
            zoom: state.zoom,
        }).catch(showError);
    }, 300);
}

function syncWatch() {
    const paths = [...new Map(state.tabs.map((t) => [t.path.toLowerCase(), t.path])).values()];
    WatchFiles(paths).catch(showError);
}

// ---------- Rendering ----------

const isRemote = (src: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src);

/** Point relative <img> sources at the Go middleware that serves local images. */
function rewriteImages(docPath: string) {
    docEl.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
        const src = img.getAttribute('src')!;
        if (isRemote(src)) return;
        img.src = `/__local?doc=${encodeURIComponent(docPath)}&src=${encodeURIComponent(src)}`;
    });
}

function renderTabbar() {
    tabbarEl.innerHTML = state.tabs.map((t) => `
        <div class="tab${t === state.active ? ' active' : ''}${t.missing ? ' missing' : ''}" role="tab"
             aria-selected="${t === state.active}" data-id="${t.id}" title="${escapeHtml(t.path)}">
            ${icon('file', 'tab-icon')}<span class="tab-name">${escapeHtml(t.name)}</span>
            <button type="button" class="tab-close" data-close="${t.id}" title="Đóng (Ctrl+W)" aria-label="Đóng ${escapeHtml(t.name)}">${icon('close')}</button>
        </div>`).join('');
    tabbarEl.hidden = state.tabs.length === 0;
    tabbarEl.querySelector('.tab.active')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
}

async function renderWelcome() {
    const recent = await GetRecentFiles().catch(() => [] as string[]);
    $('recent').hidden = recent.length === 0;
    $('recent-list').innerHTML = recent.map((p) => `
        <li><button type="button" class="recent-item" data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">
            ${icon('file')}<span class="recent-name">${escapeHtml(baseName(p))}</span>
            <span class="recent-dir">${escapeHtml(p.slice(0, p.length - baseName(p).length))}</span>
        </button></li>`).join('');
}

/** Shows the active tab's document (or the welcome screen). */
function renderActive() {
    const tab = state.active;
    renderTabbar();
    if (!tab) {
        docEl.hidden = true;
        docEl.innerHTML = '';
        welcomeEl.hidden = false;
        toc.set([]);
        tree.setActive('');
        find.close();
        WindowSetTitle('MD Reader');
        renderWelcome();
        return;
    }
    welcomeEl.hidden = true;
    docEl.hidden = false;
    docEl.innerHTML = tab.html;
    rewriteImages(tab.path);
    contentEl.scrollTop = tab.scrollTop;
    toc.set(tab.headings);
    tree.setActive(tab.path);
    find.refresh();
    WindowSetTitle(`${tab.name} - MD Reader`);
    enhanceDoc(tab.scrollTop);
}

let enhanceSeq = 0;
let userScrolled = false;
for (const ev of ['wheel', 'keydown', 'mousedown', 'touchstart']) {
    contentEl.addEventListener(ev, () => (userScrolled = true), {passive: true});
}

/**
 * Adds copy buttons, then typesets math and diagrams (asynchronous). They
 * change the page height, so the scroll position is restored again unless the
 * user has scrolled in the meantime.
 */
async function enhanceDoc(scrollTop: number) {
    const seq = ++enhanceSeq;
    userScrolled = false;
    addCopyButtons(docEl);
    try {
        await renderMath(docEl);
        if (seq !== enhanceSeq) return;
        await renderMermaid(docEl, isDark());
    } catch (err) {
        showError(err);
    }
    if (seq !== enhanceSeq) return;
    if (!userScrolled && scrollTop > 0) contentEl.scrollTop = scrollTop;
    find.refresh();
    toc.updateActive();
}

onAppearanceChange((dark) => {
    if (!docEl.hidden) renderMermaid(docEl, dark);
});

// ---------- Print & export ----------

async function printDoc() {
    if (!state.active) return;
    // Paper is white: re-draw dark diagrams in light colours while printing.
    const recolor = isDark() && docEl.querySelector('.mermaid-block') !== null;
    if (recolor) await renderMermaid(docEl, false);
    window.print();
    if (recolor) await renderMermaid(docEl, isDark());
}

async function exportHtml() {
    const tab = state.active;
    if (!tab) return;
    const title = tab.headings.find((h) => h.level === 1)?.text || tab.name;
    const html = await buildStandaloneHtml(docEl, title, isDark());
    const saved = await SaveHTML(tab.path, html);
    if (saved) showToast(`Đã lưu ${saved}`, 'info', 4000);
}

function scrollToAnchor(fragment: string): boolean {
    if (!fragment) return false;
    const el = document.getElementById(fragment) ?? document.getElementById(fragment.toLowerCase());
    if (!el || !docEl.contains(el)) return false;
    el.scrollIntoView({block: 'start'});
    el.classList.remove('anchor-hit');
    void el.offsetWidth; // restart the highlight animation
    el.classList.add('anchor-hit');
    return true;
}

function applyLayout() {
    appEl.classList.toggle('no-sidebar', !state.showSidebar);
    appEl.classList.toggle('no-toc', !state.showToc);
    docEl.style.zoom = String(state.zoom);
}

// ---------- Tabs ----------

function rememberScroll() {
    if (state.active) state.active.scrollTop = contentEl.scrollTop;
}

function activate(tab: Tab | null) {
    if (tab === state.active) return;
    rememberScroll();
    state.active = tab;
    renderActive();
    saveSession();
}

async function loadInto(tab: Tab, path: string) {
    const doc = await LoadFile(path);
    Object.assign(tab, {path: doc.path, name: doc.name, html: doc.html, headings: doc.headings ?? [], missing: false});
}

interface OpenOptions {
    fragment?: string;
    newTab?: boolean; // open beside the current tab even if called from a link
    recent?: boolean; // add to the recent files list (default true)
    activate?: boolean; // default true
}

/** Opens a file in its existing tab or a new one. */
async function openFile(path: string, opts: OpenOptions = {}) {
    try {
        let tab = state.tabs.find((t) => samePath(t.path, path));
        if (!tab) {
            tab = {id: nextTabId++, path, name: baseName(path), html: '', headings: [], scrollTop: 0, back: [], forward: [], missing: false};
            await loadInto(tab, path);
            const at = state.active ? state.tabs.indexOf(state.active) + 1 : state.tabs.length;
            state.tabs.splice(at, 0, tab);
            syncWatch();
        }
        if (opts.recent !== false) AddRecentFile(tab.path).catch(showError);
        if (opts.activate === false) {
            renderTabbar();
            saveSession();
            return;
        }
        if (tab === state.active) {
            if (opts.fragment) scrollToAnchor(opts.fragment);
            return;
        }
        activate(tab);
        if (opts.fragment) scrollToAnchor(opts.fragment);
    } catch (err) {
        showError(err);
    }
}

/** Follows a link inside the active tab, keeping back/forward history. */
async function navigate(path: string, fragment = '') {
    const tab = state.active;
    if (!tab) return openFile(path, {fragment});
    if (samePath(tab.path, path)) {
        scrollToAnchor(fragment);
        return;
    }
    const here = {path: tab.path, scrollTop: contentEl.scrollTop};
    try {
        await loadInto(tab, path);
    } catch (err) {
        showError(err);
        return;
    }
    tab.back.push(here);
    tab.forward.length = 0;
    tab.scrollTop = 0;
    renderActive();
    if (!scrollToAnchor(fragment)) contentEl.scrollTop = 0;
    AddRecentFile(tab.path).catch(showError);
    syncWatch();
    saveSession();
}

async function goHistory(dir: 'back' | 'forward') {
    const tab = state.active;
    if (!tab) return;
    const from = dir === 'back' ? tab.back : tab.forward;
    const to = dir === 'back' ? tab.forward : tab.back;
    const entry = from.pop();
    if (!entry) return;
    const here = {path: tab.path, scrollTop: contentEl.scrollTop};
    try {
        await loadInto(tab, entry.path);
    } catch (err) {
        from.push(entry);
        showError(err);
        return;
    }
    to.push(here);
    tab.scrollTop = entry.scrollTop;
    renderActive();
    syncWatch();
    saveSession();
}

function closeTab(tab: Tab | null = state.active) {
    if (!tab) return;
    const i = state.tabs.indexOf(tab);
    state.tabs.splice(i, 1);
    if (tab === state.active) {
        state.active = null; // don't remember the scroll of a closed tab
        activate(state.tabs[i] ?? state.tabs[i - 1] ?? null);
        if (!state.active) renderActive();
    } else {
        renderTabbar();
    }
    syncWatch();
    saveSession();
}

function cycleTab(dir: number) {
    if (state.tabs.length < 2 || !state.active) return;
    const i = state.tabs.indexOf(state.active);
    activate(state.tabs[(i + dir + state.tabs.length) % state.tabs.length]);
}

/** Reloads tabs showing `path` after it changed on disk (or on F5). */
async function reloadPath(path: string, manual = false) {
    for (const tab of state.tabs.filter((t) => samePath(t.path, path))) {
        try {
            await loadInto(tab, tab.path);
        } catch (err) {
            if (manual || !tab.missing) showError(`Không đọc được ${tab.name}: file đã bị xoá, đổi tên hoặc đang bị khoá.`);
            tab.missing = true;
            renderTabbar();
            continue;
        }
        if (tab === state.active) {
            const top = contentEl.scrollTop;
            tab.scrollTop = top;
            renderActive();
            contentEl.scrollTop = top;
        } else {
            renderTabbar();
        }
    }
}

// ---------- Folder ----------

async function openFolder(path: string) {
    state.showSidebar = true;
    applyLayout();
    await tree.setRoot(path);
    saveSession();
}

async function pickFile() {
    try {
        const path = await OpenFileDialog();
        if (path) await openFile(path);
    } catch (err) {
        showError(err);
    }
}

async function pickFolder() {
    try {
        const path = await OpenFolderDialog();
        if (path) await openFolder(path);
    } catch (err) {
        showError(err);
    }
}

// ---------- Zoom ----------

function setZoom(z: number) {
    state.zoom = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
    applyLayout();
    showToast(`${Math.round(state.zoom * 100)}%`, 'info');
    saveSession();
}

function zoomStep(dir: number) {
    const next = dir > 0
        ? ZOOM_STEPS.find((s) => s > state.zoom + 0.001)
        : [...ZOOM_STEPS].reverse().find((s) => s < state.zoom - 0.001);
    if (next) setZoom(next);
}

// ---------- Commands ----------

const commands: Record<string, () => unknown> = {
    'open-file': pickFile,
    'open-folder': pickFolder,
    'reload': () => state.active && reloadPath(state.active.path, true),
    'close-tab': () => closeTab(),
    'find': () => state.active && find.open(),
    'toggle-sidebar': () => {
        state.showSidebar = !state.showSidebar;
        applyLayout();
        saveSession();
    },
    'toggle-toc': () => {
        state.showToc = !state.showToc;
        applyLayout();
        saveSession();
    },
    'zoom-in': () => zoomStep(1),
    'zoom-out': () => zoomStep(-1),
    'zoom-reset': () => setZoom(1),
    'back': () => goHistory('back'),
    'forward': () => goHistory('forward'),
    'next-tab': () => cycleTab(1),
    'prev-tab': () => cycleTab(-1),
    'print': printDoc,
    'export-html': exportHtml,
};

function run(name: string) {
    const cmd = commands[name];
    if (!cmd) return;
    Promise.resolve(cmd()).catch(showError);
}

/** Shortcut table: [ctrl, shift, alt, KeyboardEvent.code or key] -> command. */
const shortcuts: [boolean, boolean, boolean, string, string][] = [
    [true, false, false, 'KeyO', 'open-file'],
    [true, true, false, 'KeyO', 'open-folder'],
    [false, false, false, 'F5', 'reload'],
    [true, false, false, 'KeyW', 'close-tab'],
    [true, false, false, 'F4', 'close-tab'],
    [true, false, false, 'KeyF', 'find'],
    [false, false, false, 'F3', 'find'],
    [true, false, false, 'KeyB', 'toggle-sidebar'],
    [true, true, false, 'KeyM', 'toggle-toc'],
    [true, false, false, 'Equal', 'zoom-in'],
    [true, true, false, 'Equal', 'zoom-in'],
    [true, false, false, 'NumpadAdd', 'zoom-in'],
    [true, false, false, 'Minus', 'zoom-out'],
    [true, false, false, 'NumpadSubtract', 'zoom-out'],
    [true, false, false, 'Digit0', 'zoom-reset'],
    [true, false, false, 'Numpad0', 'zoom-reset'],
    [false, false, true, 'ArrowLeft', 'back'],
    [false, false, true, 'ArrowRight', 'forward'],
    [true, false, false, 'Tab', 'next-tab'],
    [true, true, false, 'Tab', 'prev-tab'],
    [true, false, false, 'PageDown', 'next-tab'],
    [true, false, false, 'PageUp', 'prev-tab'],
    [true, false, false, 'KeyP', 'print'],
    [true, true, false, 'KeyE', 'export-html'],
];

window.addEventListener('keydown', (e) => {
    const hit = shortcuts.find(([c, s, a, code]) =>
        c === e.ctrlKey && s === e.shiftKey && a === e.altKey && code === e.code);
    if (!hit) return;
    // Let text fields keep their own editing keys (except find/zoom/tab shortcuts).
    e.preventDefault();
    run(hit[4]);
});

contentEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomStep(e.deltaY < 0 ? 1 : -1);
}, {passive: false});

// ---------- Mouse ----------

async function onLinkClick(e: MouseEvent) {
    if (e.button === 0 && handleCopyClick(e)) return;
    const a = (e.target as Element).closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    const newTab = e.ctrlKey || e.button === 1;

    try {
        const target = await ResolveLink(state.active?.path ?? '', href);
        switch (target.kind) {
            case 'anchor':
                scrollToAnchor(target.fragment ?? '');
                break;
            case 'external':
                BrowserOpenURL(target.url!);
                break;
            case 'markdown':
                if (newTab) await openFile(target.path!, {fragment: target.fragment, activate: !e.ctrlKey || e.shiftKey});
                else await navigate(target.path!, target.fragment ?? '');
                break;
            case 'file':
                await RevealInExplorer(target.path!);
                break;
        }
    } catch (err) {
        showError(err);
    }
}

docEl.addEventListener('click', onLinkClick);
docEl.addEventListener('auxclick', (e) => {
    if (e.button === 1) onLinkClick(e);
});

// Mouse back/forward buttons.
window.addEventListener('mouseup', (e) => {
    if (e.button === 3) run('back');
    if (e.button === 4) run('forward');
});

tabbarEl.addEventListener('click', (e) => {
    const target = e.target as Element;
    const close = target.closest<HTMLElement>('[data-close]');
    if (close) {
        closeTab(state.tabs.find((t) => t.id === Number(close.dataset.close)));
        return;
    }
    const el = target.closest<HTMLElement>('.tab');
    if (el) activate(state.tabs.find((t) => t.id === Number(el.dataset.id)) ?? null);
});
tabbarEl.addEventListener('auxclick', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.tab');
    if (el && e.button === 1) closeTab(state.tabs.find((t) => t.id === Number(el.dataset.id)));
});
tabbarEl.addEventListener('wheel', (e) => {
    if (e.deltaY && !e.ctrlKey) {
        tabbarEl.scrollLeft += e.deltaY;
        e.preventDefault();
    }
}, {passive: false});

$('recent-list').addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('[data-path]');
    if (item) openFile(item.dataset.path!);
});

$('open-btn').addEventListener('click', pickFile);
$('open-folder-btn').addEventListener('click', pickFolder);
$('tree-open').addEventListener('click', pickFolder);
const folderOpenBtn = $('folder-open');
folderOpenBtn.innerHTML = icon('folder');
folderOpenBtn.addEventListener('click', pickFolder);
const folderRefreshBtn = $('folder-refresh');
folderRefreshBtn.innerHTML = icon('refresh');
folderRefreshBtn.addEventListener('click', () => tree.refresh());

// ---------- Go events ----------

EventsOn('cmd', (name: string) => run(name));
EventsOn('file:open', (path: string) => openFile(path));
EventsOn('folder:open', (path: string) => openFolder(path));
EventsOn('file:changed', (path: string) => reloadPath(path));
EventsOn('theme:changed', (theme: Theme) => applyTheme(theme));
EventsOn('app:error', (msg: string) => showError(msg));

// ---------- Startup ----------

async function init() {
    const [css, theme, session, args] = await Promise.all([HighlightCSS(), GetTheme(), GetSession(), GetStartupArgs()]);
    addHighlightCss(css.light, css.dark);
    applyTheme(theme as Theme);

    state.zoom = session.zoom || 1;
    state.showSidebar = session.showSidebar;
    state.showToc = session.showToc;
    applyLayout();

    const folder = args.folder || session.folder;
    if (folder) await tree.setRoot(folder);

    // Restore the previous tabs (silently skipping files that are gone),
    // then open files passed on the command line.
    for (const path of session.tabs ?? []) {
        if (state.tabs.some((t) => samePath(t.path, path))) continue;
        const tab: Tab = {id: nextTabId++, path, name: baseName(path), html: '', headings: [], scrollTop: 0, back: [], forward: [], missing: false};
        try {
            await loadInto(tab, path);
            state.tabs.push(tab);
        } catch {
            // file no longer exists
        }
    }
    state.active = state.tabs.find((t) => samePath(t.path, session.active ?? '')) ?? state.tabs[0] ?? null;
    renderActive();
    syncWatch();

    for (const path of args.files ?? []) await openFile(path);
}

init().catch(showError);

// Hook for manual testing from the dev browser console.
Object.assign(window, {mdReader: {openFile, openFolder, run, state, buildStandaloneHtml}});
