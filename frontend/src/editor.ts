// Markdown editor built on CodeMirror 6. Loaded lazily (dynamic import) the
// first time a tab enters edit or split mode.
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {highlightSelectionMatches, openSearchPanel, search, searchKeymap} from '@codemirror/search';
import {EditorSelection, EditorState} from '@codemirror/state';
import {
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    rectangularSelection,
} from '@codemirror/view';
import {tags as t} from '@lezer/highlight';

export interface EditorCallbacks {
    onChange: () => void;
    onScroll: () => void;
    onCursor: (line: number, col: number) => void;
}

// Colours come from CSS variables (see style.css), so the editor follows the
// light/dark theme without being reconfigured.
const theme = EditorView.theme({
    '&': {
        height: '100%',
        color: 'var(--fg)',
        backgroundColor: 'var(--bg)',
        fontSize: 'calc(13px * var(--zoom, 1))',
    },
    '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, "Liberation Mono", monospace',
        lineHeight: '1.6',
    },
    '.cm-content': {padding: '12px 0 40vh', caretColor: 'var(--fg)'},
    '.cm-line': {padding: '0 16px 0 8px'},
    '.cm-gutters': {
        backgroundColor: 'var(--bg)',
        color: 'var(--cm-gutter)',
        border: 'none',
        paddingLeft: '8px',
    },
    '.cm-activeLine': {backgroundColor: 'var(--cm-active-line)'},
    '.cm-activeLineGutter': {backgroundColor: 'transparent', color: 'var(--fg)'},
    '&.cm-focused .cm-cursor': {borderLeftColor: 'var(--fg)'},
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--cm-selection) !important',
    },
    '.cm-selectionMatch': {backgroundColor: 'var(--cm-match)'},
    '.cm-searchMatch': {backgroundColor: 'var(--find-bg)', outline: '1px solid var(--find-current)'},
    '.cm-searchMatch.cm-searchMatch-selected': {backgroundColor: 'var(--find-current)'},
    '.cm-panels': {backgroundColor: 'var(--bg-pane)', color: 'var(--fg)'},
    '.cm-panels.cm-panels-top': {borderBottom: '1px solid var(--border)'},
    '.cm-panels.cm-panels-bottom': {borderTop: '1px solid var(--border)'},
    '.cm-panel.cm-search': {padding: '6px 8px', fontFamily: 'inherit'},
    '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {fontSize: '12px'},
    '.cm-textfield': {
        backgroundColor: 'var(--bg)',
        color: 'var(--fg)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '3px 6px',
    },
    '.cm-button': {
        backgroundImage: 'none',
        backgroundColor: 'var(--btn-bg)',
        color: 'var(--fg)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '2px 8px',
    },
});

const highlight = HighlightStyle.define([
    {tag: t.heading, color: 'var(--cm-heading)', fontWeight: '600'},
    {tag: t.strong, fontWeight: '600'},
    {tag: t.emphasis, fontStyle: 'italic'},
    {tag: t.strikethrough, textDecoration: 'line-through'},
    {tag: [t.link, t.url], color: 'var(--cm-link)'},
    {tag: t.monospace, color: 'var(--cm-code)'},
    {tag: t.quote, color: 'var(--muted)', fontStyle: 'italic'},
    {tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: 'var(--cm-mark)'},
    {tag: [t.comment, t.meta], color: 'var(--muted)'},
    // Code inside fenced blocks (GitHub-like colours).
    {tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--cm-keyword)'},
    {tag: [t.string, t.special(t.string), t.regexp], color: 'var(--cm-string)'},
    {tag: [t.number, t.bool, t.null, t.atom], color: 'var(--cm-number)'},
    {tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--cm-function)'},
    {tag: [t.typeName, t.className, t.tagName], color: 'var(--cm-type)'},
    {tag: [t.propertyName, t.attributeName], color: 'var(--cm-number)'},
    {tag: t.definition(t.variableName), color: 'var(--cm-string)'},
    {tag: t.invalid, color: 'var(--error-fg)'},
]);

// Vietnamese labels for the search / replace panel.
const phrases = EditorState.phrases.of({
    'Find': 'Tìm',
    'Replace': 'Thay bằng',
    'next': 'tiếp',
    'previous': 'trước',
    'all': 'tất cả',
    'match case': 'phân biệt hoa/thường',
    'by word': 'nguyên từ',
    'regexp': 'biểu thức chính quy',
    'replace': 'thay',
    'replace all': 'thay tất cả',
    'close': 'đóng',
    'current match': 'kết quả hiện tại',
    'on line': 'ở dòng',
    'Go to line': 'Tới dòng',
    'go': 'đi',
});

export class MarkdownEditor {
    readonly view: EditorView;
    private readonly extensions;

    constructor(parent: HTMLElement, private cb: EditorCallbacks) {
        this.extensions = [
            lineNumbers(),
            highlightActiveLineGutter(),
            highlightSpecialChars(),
            history(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            bracketMatching(),
            rectangularSelection(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            search({top: true}),
            EditorView.lineWrapping,
            markdown({base: markdownLanguage, codeLanguages: languages}),
            syntaxHighlighting(highlight),
            theme,
            phrases,
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
            EditorView.updateListener.of((u) => {
                if (u.docChanged) this.cb.onChange();
                if (u.docChanged || u.selectionSet) this.reportCursor(u.state);
            }),
            EditorView.contentAttributes.of({spellcheck: 'false', 'aria-label': 'Nội dung Markdown'}),
        ];
        this.view = new EditorView({parent, state: this.createState('')});
        this.view.scrollDOM.addEventListener('scroll', () => this.cb.onScroll(), {passive: true});
    }

    /** A fresh state (own undo history) for a tab. */
    createState(text: string): EditorState {
        return EditorState.create({doc: text, extensions: this.extensions});
    }

    get state(): EditorState {
        return this.view.state;
    }

    setState(state: EditorState) {
        this.view.setState(state);
        this.reportCursor(state);
    }

    text(): string {
        return this.view.state.doc.toString();
    }

    /** Replaces the whole text as one undoable change (keeps the cursor line). */
    replaceText(text: string) {
        const state = this.view.state;
        if (state.doc.toString() === text) return;
        const line = state.doc.lineAt(state.selection.main.head).number;
        this.view.dispatch({changes: {from: 0, to: state.doc.length, insert: text}});
        const target = this.view.state.doc.line(Math.min(line, this.view.state.doc.lines));
        this.view.dispatch({selection: EditorSelection.cursor(target.from)});
    }

    focus() {
        this.view.focus();
    }

    openSearch() {
        openSearchPanel(this.view);
    }

    /** Line at the top of the viewport, with a fraction for partial lines (1-based). */
    topLine(): number {
        const scroller = this.view.scrollDOM;
        const top = scroller.scrollTop - this.view.documentPadding.top;
        const block = this.view.lineBlockAtHeight(Math.max(0, top));
        const line = this.view.state.doc.lineAt(block.from).number;
        const frac = block.height > 0 ? Math.min(1, Math.max(0, (top - block.top) / block.height)) : 0;
        return line + frac;
    }

    /** Scrolls so that (fractional) line is at the top of the viewport. */
    scrollToLine(line: number) {
        const doc = this.view.state.doc;
        const n = Math.min(Math.max(1, Math.floor(line)), doc.lines);
        const block = this.view.lineBlockAt(doc.line(n).from);
        this.view.scrollDOM.scrollTop = block.top + (line - n) * block.height + this.view.documentPadding.top;
    }

    /** Puts the cursor on a line and shows it near the top. */
    revealLine(line: number) {
        const doc = this.view.state.doc;
        const pos = doc.line(Math.min(Math.max(1, line), doc.lines)).from;
        this.view.dispatch({
            selection: EditorSelection.cursor(pos),
            effects: EditorView.scrollIntoView(pos, {y: 'start', yMargin: 24}),
        });
        this.view.focus();
    }

    atBottom(): boolean {
        const s = this.view.scrollDOM;
        return s.scrollTop + s.clientHeight >= s.scrollHeight - 2;
    }

    scrollToBottom() {
        const s = this.view.scrollDOM;
        s.scrollTop = s.scrollHeight;
    }

    private reportCursor(state: EditorState) {
        const head = state.selection.main.head;
        const line = state.doc.lineAt(head);
        this.cb.onCursor(line.number, head - line.from + 1);
    }
}
