import './style.css';

import type {EditorState} from '@codemirror/state';
import {
    AddRecentFile,
    DefaultFormat,
    GetRecentFiles,
    GetSession,
    GetStartupArgs,
    GetTheme,
    HighlightCSS,
    LoadFile,
    OpenFileDialog,
    OpenFolderDialog,
    Quit,
    ReadSource,
    RenderMarkdown,
    RevealInExplorer,
    ResolveLink,
    SaveAsDialog,
    SaveFile,
    SaveHTML,
    SaveSession,
    SetDirtyCount,
    WatchFiles,
} from '../wailsjs/go/main/App';
import type {textfile} from '../wailsjs/go/models';
import {BrowserOpenURL, EventsOn, WindowSetTitle} from '../wailsjs/runtime/runtime';
import type {MarkdownEditor} from './editor';
import {addCopyButtons, fillMermaidFromCache, handleCopyClick, renderMath, renderMermaid} from './enhance';
import {buildStandaloneHtml} from './export';
import {FindBar} from './find';
import {addHighlightCss, applyTheme, isDark, onAppearanceChange, type Theme} from './theme';
import {type HeadingInfo, Toc} from './toc';
import {FileTree} from './tree';
import {ask, baseName, escapeHtml, icon, isModalOpen, samePath, showError, showToast} from './ui';

// ---------- Elements ----------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const appEl = $('app');
const contentEl = $('content');
const docEl = $('doc');
const welcomeEl = $('welcome');
const tabstripEl = $('tabstrip');
const tabbarEl = $('tabbar');
const modeSwitchEl = $('mode-switch');
const workspaceEl = $('workspace');
const editorHostEl = $('editor-host');
const editorStatusEl = $('editor-status');
const conflictBarEl = $('conflict-bar');

// ---------- State ----------

type Mode = 'view' | 'edit' | 'split';

interface HistoryEntry {
    path: string;
    scrollTop: number;
}

interface Tab {
    id: number;
    path: string; // '' for a new file that was never saved
    name: string;
    html: string;
    headings: HeadingInfo[];
    scrollTop: number;
    back: HistoryEntry[];
    forward: HistoryEntry[];
    missing: boolean; // file deleted/unreadable since it was loaded

    mode: Mode;
    lastEditMode: 'edit' | 'split';
    editor: EditorState | null; // created the first time the tab is edited
    editorTop: number; // line at the top of the editor
    savedText: string | null; // text on disk at the last load/save ("\n" line endings)
    format: textfile.Format | null; // encoding + line endings to save with
    dirty: boolean;
    conflict: boolean; // changed on disk while it had unsaved edits
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
let untitledCount = 0;

function newTab(path: string, name = baseName(path)): Tab {
    return {
        id: nextTabId++, path, name, html: '', headings: [], scrollTop: 0, back: [], forward: [], missing: false,
        mode: 'view', lastEditMode: 'split', editor: null, editorTop: 1, savedText: null, format: null,
        dirty: false, conflict: false,
    };
}

const toc = new Toc($('toc-list'), contentEl, docEl, (id) => jumpToHeading(id));
const find = new FindBar($('findbar'), docEl, contentEl);
const tree = new FileTree($('tree'), $('folder-name'), $('tree-empty'), {
    onOpen: (path, newTab) => openFile(path, {newTab}),
    onError: showError,
});

// ---------- Editor (loaded on first use) ----------

let editor: MarkdownEditor | null = null;

async function ensureEditor(): Promise<MarkdownEditor> {
    if (!editor) {
        const {MarkdownEditor} = await import('./editor');
        editor = new MarkdownEditor(editorHostEl, {
            onChange: onEditorChange,
            onScroll: onEditorScroll,
            onCursor: renderEditorStatus,
        });
    }
    return editor;
}

/** Loads the file text into the tab so it can be edited. */
async function prepareEditing(tab: Tab) {
    const ed = await ensureEditor();
    if (tab.editor) return;
    if (!tab.path) {
        tab.savedText = '';
        tab.format = await DefaultFormat();
        tab.editor = ed.createState('');
        return;
    }
    const src = await ReadSource(tab.path);
    tab.savedText = src.text;
    tab.format = src.format;
    tab.editor = ed.createState(src.text);
    tab.editorTop = 1;
}

/** Whether the tab shows the editor (edit or split mode). */
const editing = (tab: Tab | null): tab is Tab => !!tab && tab.mode !== 'view' && !!tab.editor && !!editor;

// The single editor view holds the state of exactly one tab at a time: its
// owner. Edits are always attributed to the owner, never to whichever tab
// happens to be active.
let editorOwner: Tab | null = null;

/** Copies the live editor state back into the tab that owns the editor. */
function stashEditor() {
    const owner = editorOwner;
    if (!owner || !editor || !owner.editor) return;
    owner.editor = editor.state;
    if (owner === state.active && owner.mode !== 'view') owner.editorTop = editor.topLine();
}

/** Loads a tab's editor state into the editor view. */
function attachEditor(tab: Tab) {
    if (!editor || !tab.editor || editorOwner === tab) return;
    stashEditor();
    editor.setState(tab.editor);
    editorOwner = tab;
}

function releaseEditor(tab: Tab) {
    if (editorOwner !== tab) return;
    stashEditor();
    editorOwner = null;
    editor?.setState(editor.createState(''));
}

/** The current text of a tab: the live editor's if it owns the editor. */
function currentText(tab: Tab): string | null {
    if (tab === editorOwner && editor) return editor.text();
    return tab.editor ? tab.editor.doc.toString() : null;
}

const ENCODING_NAMES: Record<string, string> = {
    'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8 có BOM', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE',
};

function renderEditorStatus(line: number, col: number) {
    const f = state.active?.format;
    const parts = [`Dòng ${line}, Cột ${col}`];
    if (f) parts.push(ENCODING_NAMES[f.encoding] ?? f.encoding, f.lineEnding === '\r\n' ? 'CRLF' : 'LF');
    editorStatusEl.textContent = parts.join('  ·  ');
}

// ---------- Session & dirty state ----------

let saveTimer: number | undefined;

function saveSession() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        SaveSession({
            tabs: state.tabs.filter((t) => t.path).map((t) => t.path),
            active: state.active?.path ?? '',
            folder: tree.root,
            showSidebar: state.showSidebar,
            showToc: state.showToc,
            zoom: state.zoom,
        }).catch(showError);
    }, 300);
}

function syncWatch() {
    const paths = [...new Map(state.tabs.filter((t) => t.path).map((t) => [t.path.toLowerCase(), t.path])).values()];
    WatchFiles(paths).catch(showError);
}

function setDirty(tab: Tab, dirty: boolean) {
    if (tab.dirty === dirty) return;
    tab.dirty = dirty;
    renderTabbar();
    updateTitle();
    SetDirtyCount(state.tabs.filter((t) => t.dirty).length).catch(showError);
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
        <div class="tab${t === state.active ? ' active' : ''}${t.missing ? ' missing' : ''}${t.dirty ? ' dirty' : ''}" role="tab"
             aria-selected="${t === state.active}" data-id="${t.id}" title="${escapeHtml(t.path || t.name)}">
            ${icon('file', 'tab-icon')}<span class="tab-name">${escapeHtml(t.name)}</span>
            <button type="button" class="tab-close" data-close="${t.id}" title="Đóng (Ctrl+W)"
                aria-label="Đóng ${escapeHtml(t.name)}${t.dirty ? ' (chưa lưu)' : ''}"><span class="dirty-dot" aria-hidden="true"></span>${icon('close')}</button>
        </div>`).join('');
    tabstripEl.hidden = state.tabs.length === 0;
    tabbarEl.querySelector('.tab.active')?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    modeSwitchEl.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.mode === state.active?.mode));
    });
}

function updateTitle() {
    const tab = state.active;
    WindowSetTitle(tab ? `${tab.dirty ? '● ' : ''}${tab.name} - MD Reader` : 'MD Reader');
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

/** Shows the active tab (preview and/or editor) or the welcome screen. */
function renderActive() {
    const tab = state.active;
    renderTabbar();
    updateTitle();
    conflictBarEl.hidden = !tab?.conflict;
    if (!tab) {
        workspaceEl.dataset.mode = 'view';
        docEl.hidden = true;
        docEl.innerHTML = '';
        welcomeEl.hidden = false;
        toc.set([]);
        tree.setActive('');
        find.close();
        renderWelcome();
        return;
    }
    workspaceEl.dataset.mode = tab.mode;
    if (editing(tab)) {
        const switched = editorOwner !== tab;
        attachEditor(tab);
        const top = tab.editorTop;
        if (switched) requestAnimationFrame(() => editor!.scrollToLine(top));
    } else if (editor?.view.hasFocus) {
        (document.activeElement as HTMLElement | null)?.blur(); // hidden editor must not take keys
    }
    renderPreview(tab, tab.scrollTop);
    toc.set(tab.headings);
    tree.setActive(tab.path);
    if (tab.mode === 'edit') find.close();
}

function renderPreview(tab: Tab, scrollTop: number) {
    welcomeEl.hidden = true;
    docEl.hidden = false;
    docEl.innerHTML = tab.html;
    rewriteImages(tab.path);
    fillMermaidFromCache(docEl, isDark());
    contentEl.scrollTop = scrollTop;
    find.refresh();
    enhanceDoc(scrollTop);
}

let enhanceSeq = 0;
let userScrolled = false;
for (const ev of ['wheel', 'keydown', 'mousedown', 'touchstart']) {
    contentEl.addEventListener(ev, () => (userScrolled = true), {passive: true});
}

/**
 * Adds copy buttons, then typesets math and diagrams (asynchronous). They
 * change the page height, so the scroll position is restored afterwards
 * (in split mode: re-synced with the editor) unless the user has scrolled.
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
    if (state.active?.mode === 'split') syncPreviewFromEditor();
    else if (!userScrolled && scrollTop > 0) contentEl.scrollTop = scrollTop;
    find.refresh();
    toc.updateActive();
}

onAppearanceChange((dark) => {
    if (!docEl.hidden) renderMermaid(docEl, dark);
});

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

function jumpToHeading(id: string) {
    const tab = state.active;
    if (tab?.mode === 'edit' && editor) {
        const h = tab.headings.find((x) => x.id === id);
        if (h?.line) editor.revealLine(h.line);
        return;
    }
    scrollToAnchor(id);
}

function applyLayout() {
    appEl.classList.toggle('no-sidebar', !state.showSidebar);
    appEl.classList.toggle('no-toc', !state.showToc);
    docEl.style.zoom = String(state.zoom);
    workspaceEl.style.setProperty('--zoom', String(state.zoom));
}

// ---------- Live preview & scroll sync ----------

let previewTimer: number | undefined;

function onEditorChange() {
    const tab = editorOwner;
    if (!tab) return;
    setDirty(tab, true); // exact check happens in refreshPreview
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(refreshPreview, 150);
}

async function refreshPreview() {
    const tab = editorOwner;
    if (!tab || !editor) return;
    const text = editor.text();
    setDirty(tab, text !== tab.savedText);
    let res;
    try {
        res = await RenderMarkdown(text);
    } catch (err) {
        showError(err);
        return;
    }
    tab.html = res.html;
    tab.headings = res.headings ?? [];
    if (tab !== state.active) return;
    toc.set(tab.headings);
    if (tab.mode === 'split') renderPreview(tab, contentEl.scrollTop);
}

// When one side is scrolled by code, ignore its own scroll events briefly so
// the two panes do not keep pushing each other.
let quiet = {side: '', until: 0};

function scrollQuietly(side: 'editor' | 'preview', fn: () => void) {
    quiet = {side, until: performance.now() + 150};
    fn();
}

const isQuiet = (side: string) => quiet.side === side && performance.now() < quiet.until;

interface Anchor {
    line: number;
    y: number;
}

/** Preview positions of the blocks that carry their source line (data-line). */
function lineAnchors(): Anchor[] {
    const base = contentEl.getBoundingClientRect().top - contentEl.scrollTop;
    const anchors: Anchor[] = [{line: 1, y: 0}];
    for (const el of docEl.querySelectorAll<HTMLElement>('[data-line]')) {
        const line = Number(el.dataset.line);
        const y = el.getBoundingClientRect().top - base - 8;
        const last = anchors[anchors.length - 1];
        if (line > last.line && y > last.y) anchors.push({line, y});
    }
    const lines = editor?.state.doc.lines ?? anchors[anchors.length - 1].line;
    anchors.push({line: lines + 1, y: contentEl.scrollHeight - contentEl.clientHeight});
    return anchors;
}

function previewYForLine(line: number): number {
    const a = lineAnchors();
    let i = 0;
    while (i < a.length - 2 && a[i + 1].line <= line) i++;
    const [p, n] = [a[i], a[i + 1]];
    return p.y + (n.y - p.y) * Math.min(1, Math.max(0, (line - p.line) / (n.line - p.line)));
}

function lineForPreviewY(y: number): number {
    const a = lineAnchors();
    let i = 0;
    while (i < a.length - 2 && a[i + 1].y <= y) i++;
    const [p, n] = [a[i], a[i + 1]];
    return p.line + (n.line - p.line) * Math.min(1, Math.max(0, (y - p.y) / Math.max(1, n.y - p.y)));
}

function syncPreviewFromEditor() {
    if (!editor || state.active?.mode !== 'split') return;
    const y = editor.atBottom() ? contentEl.scrollHeight : previewYForLine(editor.topLine());
    scrollQuietly('preview', () => (contentEl.scrollTop = y));
}

function syncEditorFromPreview() {
    if (!editor || state.active?.mode !== 'split') return;
    const atBottom = contentEl.scrollTop + contentEl.clientHeight >= contentEl.scrollHeight - 2;
    scrollQuietly('editor', () => {
        if (atBottom) editor!.scrollToBottom();
        else editor!.scrollToLine(lineForPreviewY(contentEl.scrollTop));
    });
}

let syncFrame = 0;

function onEditorScroll() {
    if (isQuiet('editor')) return;
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(syncPreviewFromEditor);
}

contentEl.addEventListener('scroll', () => {
    if (isQuiet('preview')) return;
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(syncEditorFromPreview);
}, {passive: true});

// ---------- Modes ----------

async function setMode(mode: Mode) {
    const tab = state.active;
    if (!tab || tab.mode === mode) return;
    if (mode !== 'view') {
        try {
            await prepareEditing(tab);
        } catch (err) {
            showError(err);
            return;
        }
        tab.lastEditMode = mode;
    }
    // Keep showing the same part of the document in the new layout.
    const line = editing(tab) ? editor!.topLine() : lineForPreviewY(contentEl.scrollTop);
    stashEditor();
    tab.scrollTop = contentEl.scrollTop;
    tab.mode = mode;
    renderActive();
    requestAnimationFrame(() => {
        if (editing(tab)) {
            editor!.scrollToLine(line);
            editor!.focus();
        } else {
            contentEl.scrollTop = previewYForLine(line);
        }
    });
}

function toggleEdit() {
    const tab = state.active;
    if (tab) setMode(tab.mode === 'view' ? tab.lastEditMode : 'view');
}

// ---------- Tabs ----------

function rememberScroll() {
    stashEditor();
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

/** Forgets the editor of an unmodified tab (e.g. before it shows another file). */
function dropEditor(tab: Tab) {
    if (editorOwner === tab) editorOwner = null;
    tab.editor = null;
    tab.savedText = null;
    tab.format = null;
    tab.mode = 'view';
    tab.conflict = false;
}

interface OpenOptions {
    fragment?: string;
    newTab?: boolean;
    recent?: boolean; // add to the recent files list (default true)
    activate?: boolean; // default true
}

/** Opens a file in its existing tab or a new one. */
async function openFile(path: string, opts: OpenOptions = {}) {
    try {
        let tab = state.tabs.find((t) => t.path && samePath(t.path, path));
        if (!tab) {
            tab = newTab(path);
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
        if (tab !== state.active) activate(tab);
        if (opts.fragment) scrollToAnchor(opts.fragment);
    } catch (err) {
        showError(err);
    }
}

function newFile() {
    rememberScroll();
    untitledCount++;
    const tab = newTab('', `Chưa đặt tên-${untitledCount}.md`);
    const at = state.active ? state.tabs.indexOf(state.active) + 1 : state.tabs.length;
    state.tabs.splice(at, 0, tab);
    state.active = tab;
    renderActive();
    setMode('split');
}

/** Follows a link inside the active tab, keeping back/forward history. */
async function navigate(path: string, fragment = '') {
    const tab = state.active;
    if (!tab) return openFile(path, {fragment});
    if (tab.path && samePath(tab.path, path)) {
        if (!scrollToAnchor(fragment)) jumpToHeading(fragment);
        return;
    }
    // Never replace a document that has unsaved edits: open the link beside it.
    if (tab.dirty || !tab.path) return openFile(path, {fragment});
    const here = {path: tab.path, scrollTop: contentEl.scrollTop};
    try {
        await loadInto(tab, path);
    } catch (err) {
        showError(err);
        return;
    }
    dropEditor(tab);
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
    if (!tab || tab.dirty) return;
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
    dropEditor(tab);
    to.push(here);
    tab.scrollTop = entry.scrollTop;
    renderActive();
    syncWatch();
    saveSession();
}

/** Asks what to do with unsaved changes. Returns false if the user cancelled. */
async function resolveUnsaved(tab: Tab): Promise<boolean> {
    if (!tab.dirty) return true;
    const choice = await ask(
        `Lưu thay đổi của ${tab.name}?`,
        'Nếu không lưu, các thay đổi sẽ bị mất.',
        [{id: 'save', label: 'Lưu', primary: true}, {id: 'discard', label: 'Không lưu', danger: true}, {id: 'cancel', label: 'Huỷ'}],
    );
    if (choice === 'save') return save(tab);
    return choice === 'discard';
}

async function closeTab(tab: Tab | null | undefined = state.active) {
    if (!tab) return;
    stashEditor();
    if (!(await resolveUnsaved(tab))) return;
    const i = state.tabs.indexOf(tab);
    if (i < 0) return;
    releaseEditor(tab);
    state.tabs.splice(i, 1);
    if (tab === state.active) {
        state.active = null; // don't stash the editor of a closed tab
        activate(state.tabs[i] ?? state.tabs[i - 1] ?? null);
        if (!state.active) renderActive();
    } else {
        renderTabbar();
    }
    SetDirtyCount(state.tabs.filter((t) => t.dirty).length).catch(showError);
    syncWatch();
    saveSession();
}

function cycleTab(dir: number) {
    if (state.tabs.length < 2 || !state.active) return;
    const i = state.tabs.indexOf(state.active);
    activate(state.tabs[(i + dir + state.tabs.length) % state.tabs.length]);
}

// ---------- Saving ----------

async function save(tab: Tab | null = state.active, saveAs = false): Promise<boolean> {
    if (!tab) return false;
    stashEditor();
    try {
        if (!tab.editor && !saveAs) return true; // never edited: nothing to save
        if (!tab.editor) await prepareEditing(tab); // "save as" of a file only viewed
        const text = tab.editor!.doc.toString();
        let path = tab.path;
        if (saveAs || !path) {
            path = await SaveAsDialog(path || tab.name);
            if (!path) return false;
        }
        const format = tab.format ?? await DefaultFormat();
        await SaveFile(path, text, format);
        const renamed = path !== tab.path;
        Object.assign(tab, {path, name: baseName(path), savedText: text, format, conflict: false, missing: false});
        setDirty(tab, false);
        if (tab === state.active) conflictBarEl.hidden = true;
        if (renamed) {
            AddRecentFile(path).catch(showError);
            syncWatch();
            saveSession();
            if (tree.root) tree.refresh();
            renderTabbar();
            updateTitle();
        }
        showToast(`Đã lưu ${tab.name}`, 'info');
        return true;
    } catch (err) {
        showError(err);
        return false;
    }
}

// ---------- Changes on disk ----------

/** Reloads tabs showing `path` after it changed on disk (or on F5). */
async function reloadPath(path: string, manual = false) {
    for (const tab of state.tabs.filter((t) => t.path && samePath(t.path, path))) {
        if (tab.editor) {
            let src;
            try {
                src = await ReadSource(tab.path);
            } catch {
                markMissing(tab, manual);
                continue;
            }
            if (src.text === tab.savedText && !manual) continue; // e.g. our own save
            const mine = currentText(tab);
            if (tab.dirty && src.text !== mine && !manual) {
                tab.conflict = true; // let the user decide (see the conflict bar)
                if (tab === state.active) conflictBarEl.hidden = false;
                continue;
            }
            applyDiskText(tab, src.text, src.format);
        }
        try {
            await loadInto(tab, tab.path);
        } catch {
            markMissing(tab, manual);
            continue;
        }
        if (tab === state.active) renderPreview(tab, contentEl.scrollTop);
        else renderTabbar();
    }
}

function markMissing(tab: Tab, manual: boolean) {
    if (manual || !tab.missing) showError(`Không đọc được ${tab.name}: file đã bị xoá, đổi tên hoặc đang bị khoá.`);
    tab.missing = true;
    renderTabbar();
}

/** Puts the disk version into the editor (undoable) and marks it saved. */
function applyDiskText(tab: Tab, text: string, format: textfile.Format) {
    tab.savedText = text;
    tab.format = format;
    tab.conflict = false;
    if (tab === editorOwner && editor) {
        editor.replaceText(text); // undoable
    } else if (editor) {
        tab.editor = editor.createState(text);
    }
    if (tab === state.active) conflictBarEl.hidden = true;
    setDirty(tab, false);
}

async function reloadCurrent() {
    const tab = state.active;
    if (!tab?.path) return;
    stashEditor();
    if (tab.dirty) {
        const choice = await ask(`Tải lại ${tab.name}?`, 'Các thay đổi chưa lưu sẽ bị mất.',
            [{id: 'reload', label: 'Tải lại', danger: true}, {id: 'cancel', label: 'Huỷ', primary: true}]);
        if (choice !== 'reload') return;
    }
    await reloadPath(tab.path, true);
}

conflictBarEl.addEventListener('click', async (e) => {
    const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
    const tab = state.active;
    if (!tab || !act) return;
    if (act === 'keep') {
        tab.conflict = false; // the next save overwrites the disk version
        conflictBarEl.hidden = true;
    } else if (act === 'reload') {
        await reloadPath(tab.path, true);
    }
});

// ---------- Quit ----------

EventsOn('app:quit-requested', async (count: number) => {
    stashEditor();
    const choice = await ask(
        `Có ${count} file chưa lưu`,
        'Bạn muốn lưu các thay đổi trước khi thoát không?',
        [{id: 'save', label: 'Lưu tất cả', primary: true}, {id: 'discard', label: 'Thoát không lưu', danger: true}, {id: 'cancel', label: 'Huỷ'}],
    );
    if (choice === 'cancel') return;
    if (choice === 'save') {
        for (const tab of state.tabs.filter((t) => t.dirty)) {
            if (!(await save(tab))) return; // cancelled "save as" or failed: stay open
        }
    }
    Quit();
});

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
    const saved = await SaveHTML(tab.path || tab.name, html);
    if (saved) showToast(`Đã lưu ${saved}`, 'info', 4000);
}

// ---------- Commands ----------

const commands: Record<string, () => unknown> = {
    'new-file': newFile,
    'open-file': pickFile,
    'open-folder': pickFolder,
    'save': () => save(),
    'save-as': () => save(state.active, true),
    'reload': reloadCurrent,
    'close-tab': () => closeTab(),
    'find': () => {
        if (state.active?.mode === 'edit') editor?.openSearch();
        else if (state.active) find.open();
    },
    'mode-view': () => setMode('view'),
    'mode-edit': () => setMode('edit'),
    'mode-split': () => setMode('split'),
    'toggle-edit': toggleEdit,
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

/** Shortcut table: [ctrl, shift, alt, KeyboardEvent.code] -> command. */
const shortcuts: [boolean, boolean, boolean, string, string][] = [
    [true, false, false, 'KeyN', 'new-file'],
    [true, false, false, 'KeyO', 'open-file'],
    [true, true, false, 'KeyO', 'open-folder'],
    [true, false, false, 'KeyS', 'save'],
    [true, true, false, 'KeyS', 'save-as'],
    [false, false, false, 'F5', 'reload'],
    [true, false, false, 'KeyW', 'close-tab'],
    [true, false, false, 'F4', 'close-tab'],
    [true, false, false, 'KeyF', 'find'],
    [false, false, false, 'F3', 'find'],
    [true, false, false, 'Digit1', 'mode-view'],
    [true, false, false, 'Digit2', 'mode-edit'],
    [true, false, false, 'Digit3', 'mode-split'],
    [true, false, false, 'KeyE', 'toggle-edit'],
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
    // Keys the editor (or a dialog) already handled are left alone.
    if (e.defaultPrevented || isModalOpen()) return;
    const hit = shortcuts.find(([c, s, a, code]) =>
        c === e.ctrlKey && s === e.shiftKey && a === e.altKey && code === e.code);
    if (!hit) return;
    e.preventDefault();
    run(hit[4]);
});

workspaceEl.addEventListener('wheel', (e) => {
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

const tabById = (id: string | undefined) => state.tabs.find((t) => t.id === Number(id));

tabbarEl.addEventListener('click', (e) => {
    const target = e.target as Element;
    const close = target.closest<HTMLElement>('[data-close]');
    if (close) {
        closeTab(tabById(close.dataset.close));
        return;
    }
    const el = target.closest<HTMLElement>('.tab');
    if (el) activate(tabById(el.dataset.id) ?? null);
});
tabbarEl.addEventListener('auxclick', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.tab');
    if (el && e.button === 1) closeTab(tabById(el.dataset.id));
});
tabbarEl.addEventListener('wheel', (e) => {
    if (e.deltaY && !e.ctrlKey) {
        tabbarEl.scrollLeft += e.deltaY;
        e.preventDefault();
    }
}, {passive: false});

const modeIcons: Record<Mode, Parameters<typeof icon>[0]> = {view: 'eye', edit: 'pencil', split: 'columns'};
modeSwitchEl.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => {
    b.innerHTML = icon(modeIcons[b.dataset.mode as Mode]);
    b.addEventListener('click', () => setMode(b.dataset.mode as Mode));
});

$('recent-list').addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('[data-path]');
    if (item) openFile(item.dataset.path!);
});

$('open-btn').addEventListener('click', pickFile);
$('open-folder-btn').addEventListener('click', pickFolder);
$('new-btn').addEventListener('click', newFile);
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
        const tab = newTab(path);
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
Object.assign(window, {mdReader: {openFile, openFolder, run, state, buildStandaloneHtml, setMode, save, editor: () => editor}});
