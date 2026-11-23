// Table of contents built from the document headings, with the heading
// currently at the top of the view highlighted.
import {escapeHtml} from './ui';

export interface HeadingInfo {
    level: number;
    id: string;
    text: string;
}

export class Toc {
    private headings: HeadingInfo[] = [];
    private frame = 0;
    private pinnedUntil = 0;

    constructor(
        private list: HTMLElement,
        private scroller: HTMLElement,
        private doc: HTMLElement,
        private onJump: (id: string) => void,
    ) {
        list.addEventListener('click', (e) => {
            const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-id]');
            if (!a) return;
            e.preventDefault();
            this.onJump(a.dataset.id!);
            // The heading may not reach the top (end of a short page), so mark
            // the clicked entry directly and ignore the scroll it triggered.
            cancelAnimationFrame(this.frame);
            this.mark(a.dataset.id!);
            this.pinnedUntil = performance.now() + 300;
        });
        scroller.addEventListener('scroll', () => {
            cancelAnimationFrame(this.frame);
            this.frame = requestAnimationFrame(() => {
                if (performance.now() >= this.pinnedUntil) this.updateActive();
            });
        }, {passive: true});
    }

    set(headings: HeadingInfo[]) {
        this.headings = headings.filter((h) => h.id);
        if (this.headings.length === 0) {
            this.list.innerHTML = '<p class="pane-note">Không có tiêu đề nào.</p>';
            return;
        }
        const min = Math.min(...this.headings.map((h) => h.level));
        this.list.innerHTML = '<ul>' + this.headings.map((h) =>
            `<li><a href="#${escapeHtml(h.id)}" data-id="${escapeHtml(h.id)}" style="--indent:${h.level - min}"
                title="${escapeHtml(h.text)}">${escapeHtml(h.text) || '(trống)'}</a></li>`).join('') + '</ul>';
        this.updateActive();
    }

    updateActive() {
        if (this.headings.length === 0) return;
        const box = this.scroller.getBoundingClientRect();
        // At the very bottom, later headings can never reach the top line,
        // so count every heading that is visible on screen.
        const atBottom = this.scroller.scrollTop > 0 &&
            this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 2;
        const line = atBottom ? box.bottom - 40 : box.top + 80;
        let current = this.headings[0].id;
        for (const h of this.headings) {
            const el = this.doc.querySelector(`[id="${CSS.escape(h.id)}"]`);
            if (!el) continue;
            if (el.getBoundingClientRect().top <= line) current = h.id;
            else break;
        }
        this.mark(current);
    }

    private mark(id: string) {
        this.list.querySelectorAll('a.active').forEach((a) => a.classList.remove('active'));
        const link = this.list.querySelector<HTMLElement>(`a[data-id="${CSS.escape(id)}"]`);
        link?.classList.add('active');
        link?.scrollIntoView({block: 'nearest'});
    }
}
