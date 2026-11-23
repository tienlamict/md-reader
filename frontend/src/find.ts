// Find in page (Ctrl+F). Matches are painted with the CSS Custom Highlight
// API, so the document DOM is never modified. Text is searched across inline
// elements ("foo **bar**" matches "foo bar") but not across blocks.
import {icon} from './ui';

const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,dt,dd,summary,div,figcaption';

export class FindBar {
    private input: HTMLInputElement;
    private count: HTMLElement;
    private ranges: Range[] = [];
    private index = -1;

    constructor(private bar: HTMLElement, private doc: HTMLElement, private scroller: HTMLElement) {
        bar.innerHTML = `
            <input type="search" class="find-input" placeholder="Tìm trong trang" aria-label="Tìm trong trang" spellcheck="false">
            <span class="find-count" aria-live="polite"></span>
            <button type="button" class="icon-btn" data-act="prev" title="Kết quả trước (Shift+Enter)">${icon('up')}</button>
            <button type="button" class="icon-btn" data-act="next" title="Kết quả tiếp (Enter)">${icon('down')}</button>
            <button type="button" class="icon-btn" data-act="close" title="Đóng (Esc)">${icon('close')}</button>`;
        this.input = bar.querySelector('input')!;
        this.count = bar.querySelector('.find-count')!;

        this.input.addEventListener('input', () => this.search(true));
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        });
        bar.addEventListener('click', (e) => {
            const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
            if (act === 'prev') this.step(-1);
            if (act === 'next') this.step(1);
            if (act === 'close') this.close();
        });
    }

    get isOpen() {
        return !this.bar.hidden;
    }

    open() {
        this.bar.hidden = false;
        this.input.focus();
        this.input.select();
        this.search(false);
    }

    close() {
        this.bar.hidden = true;
        this.clear();
    }

    /** Re-run the search after the document changed. */
    refresh() {
        if (this.isOpen) this.search(false);
    }

    private clear() {
        this.ranges = [];
        this.index = -1;
        CSS.highlights?.delete('find');
        CSS.highlights?.delete('find-current');
        this.count.textContent = '';
    }

    private search(scroll: boolean) {
        this.clear();
        const query = this.input.value.toLowerCase();
        if (!query || this.doc.hidden) return;

        // Concatenate text nodes; "\u0000" separates blocks so matches never span them.
        const nodes: Text[] = [];
        const starts: number[] = [];
        let text = '';
        let lastBlock: Element | null = null;
        const walker = document.createTreeWalker(this.doc, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
            const block = n.parentElement?.closest(BLOCKS) ?? null;
            if (block !== lastBlock) text += '\u0000';
            lastBlock = block;
            nodes.push(n);
            starts.push(text.length);
            text += n.data;
        }
        const lower = text.toLowerCase();
        if (lower.length !== text.length) return; // exotic case mapping; give up safely

        const locate = (offset: number, end: boolean): [Text, number] => {
            let lo = 0, hi = nodes.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (starts[mid] < offset || (!end && starts[mid] === offset)) lo = mid;
                else hi = mid - 1;
            }
            return [nodes[lo], offset - starts[lo]];
        };

        for (let i = lower.indexOf(query); i !== -1; i = lower.indexOf(query, i + query.length)) {
            const range = document.createRange();
            const [sn, so] = locate(i, false);
            const [en, eo] = locate(i + query.length, true);
            range.setStart(sn, so);
            range.setEnd(en, eo);
            this.ranges.push(range);
        }

        if (this.ranges.length === 0) {
            this.count.textContent = 'Không thấy';
            return;
        }
        CSS.highlights?.set('find', new Highlight(...this.ranges));
        // Start from the first match below the top of the view.
        const top = this.scroller.getBoundingClientRect().top;
        const first = this.ranges.findIndex((r) => r.getBoundingClientRect().bottom > top);
        this.select(first === -1 ? 0 : first, scroll);
    }

    private step(dir: number) {
        if (this.ranges.length === 0) return;
        this.select((this.index + dir + this.ranges.length) % this.ranges.length, true);
    }

    private select(i: number, scroll: boolean) {
        this.index = i;
        const range = this.ranges[i];
        CSS.highlights?.set('find-current', new Highlight(range));
        this.count.textContent = `${i + 1}/${this.ranges.length}`;
        if (!scroll) return;
        const r = range.getBoundingClientRect();
        const s = this.scroller.getBoundingClientRect();
        if (r.top < s.top + 48 || r.bottom > s.bottom - 16) {
            this.scroller.scrollTop += r.top - s.top - s.height / 3;
        }
    }
}
