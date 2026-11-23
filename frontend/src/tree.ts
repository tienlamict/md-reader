// Sidebar file tree: folders load lazily when expanded; only Markdown files
// are listed (see internal/fstree).
import {ListDir} from '../wailsjs/go/main/App';
import {baseName, escapeHtml, icon, samePath} from './ui';

interface TreeOptions {
    onOpen: (path: string, newTab: boolean) => void;
    onError: (err: unknown) => void;
}

export class FileTree {
    root = '';
    private expanded = new Set<string>();
    private activePath = '';

    constructor(
        private list: HTMLElement,
        private title: HTMLElement,
        private empty: HTMLElement,
        private opts: TreeOptions,
    ) {
        list.addEventListener('click', (e) => this.onClick(e));
        list.addEventListener('auxclick', (e) => {
            if (e.button === 1) this.onClick(e, true);
        });
    }

    /** Shows `root` in the tree, or the empty state when root is "". */
    async setRoot(root: string) {
        if (root && !samePath(root, this.root)) this.expanded.clear();
        this.root = root;
        this.title.textContent = root ? baseName(root) : 'Thư mục';
        this.title.title = root;
        this.empty.hidden = !!root;
        this.list.hidden = !root;
        this.list.innerHTML = '';
        if (!root) return;
        try {
            await this.renderDir(root, this.list, 0);
        } catch (err) {
            this.opts.onError(err);
        }
    }

    refresh() {
        return this.setRoot(this.root);
    }

    setActive(path: string) {
        this.activePath = path;
        this.list.querySelectorAll<HTMLElement>('.tree-row.active').forEach((el) => el.classList.remove('active'));
        if (!path) return;
        const row = [...this.list.querySelectorAll<HTMLElement>('.tree-row[data-file]')]
            .find((el) => samePath(el.dataset.path!, path));
        row?.classList.add('active');
        row?.scrollIntoView({block: 'nearest'});
    }

    private async renderDir(dir: string, container: HTMLElement, depth: number) {
        const entries = await ListDir(dir);
        const ul = document.createElement('ul');
        ul.setAttribute('role', depth === 0 ? 'tree' : 'group');
        if (entries.length === 0) {
            ul.innerHTML = `<li class="tree-note" style="--depth:${depth}">(không có file Markdown)</li>`;
        }
        for (const e of entries) {
            const li = document.createElement('li');
            li.setAttribute('role', 'treeitem');
            const isOpen = e.isDir && this.expanded.has(e.path.toLowerCase());
            if (e.isDir) li.setAttribute('aria-expanded', String(isOpen));
            li.innerHTML = `<button type="button" class="tree-row${e.isDir ? '' : ' file'}" style="--depth:${depth}"
                data-path="${escapeHtml(e.path)}" ${e.isDir ? 'data-dir' : 'data-file'} title="${escapeHtml(e.path)}">
                ${e.isDir ? icon('chevron', 'chevron') : '<span class="chevron-space"></span>'}
                ${icon(e.isDir ? 'folder' : 'file', e.isDir ? 'icon-folder' : 'icon-file')}
                <span class="tree-name">${escapeHtml(e.name)}</span></button>`;
            ul.appendChild(li);
            if (isOpen) await this.renderDir(e.path, li, depth + 1);
        }
        container.appendChild(ul);
        if (depth === 0) this.setActive(this.activePath);
    }

    private async onClick(e: MouseEvent, middle = false) {
        const row = (e.target as Element).closest<HTMLElement>('.tree-row');
        if (!row) return;
        const path = row.dataset.path!;
        if (row.hasAttribute('data-file')) {
            if (middle) e.preventDefault();
            this.opts.onOpen(path, middle || e.ctrlKey);
            return;
        }
        if (middle) return;
        const li = row.parentElement!;
        const key = path.toLowerCase();
        if (this.expanded.has(key)) {
            this.expanded.delete(key);
            li.querySelector('ul')?.remove();
            li.setAttribute('aria-expanded', 'false');
        } else {
            this.expanded.add(key);
            li.setAttribute('aria-expanded', 'true');
            try {
                await this.renderDir(path, li, Number(row.style.getPropertyValue('--depth')) + 1);
                this.setActive(this.activePath);
            } catch (err) {
                this.expanded.delete(key);
                li.setAttribute('aria-expanded', 'false');
                this.opts.onError(err);
            }
        }
    }
}
