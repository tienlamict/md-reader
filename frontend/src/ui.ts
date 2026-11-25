// Small shared UI helpers: icons, HTML escaping and toast messages.

const ICON_PATHS = {
    chevron: 'M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z',
    close: 'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z',
    file: 'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z',
    folder: 'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z',
    refresh: 'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z',
    up: 'M3.22 10.53a.749.749 0 0 1 0-1.06l4.25-4.25a.749.749 0 0 1 1.06 0l4.25 4.25a.749.749 0 1 1-1.06 1.06L8 6.811 4.28 10.53a.749.749 0 0 1-1.06 0Z',
    down: 'M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z',
    copy: 'M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z',
    check: 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z',
    eye: 'M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z',
    pencil: 'M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Zm1.238-3.763a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354Z',
    columns: 'M2.75 0h2.5C6.216 0 7 .784 7 1.75v12.5A1.75 1.75 0 0 1 5.25 16h-2.5A1.75 1.75 0 0 1 1 14.25V1.75C1 .784 1.784 0 2.75 0Zm8 0h2.5C14.216 0 15 .784 15 1.75v12.5A1.75 1.75 0 0 1 13.25 16h-2.5A1.75 1.75 0 0 1 9 14.25V1.75C9 .784 9.784 0 10.75 0ZM2.5 1.75v12.5c0 .138.112.25.25.25h2.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Zm8 0v12.5c0 .138.112.25.25.25h2.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z',
};

export type IconName = keyof typeof ICON_PATHS;

/** Octicon (MIT, github.com/primer/octicons) as an inline SVG string. */
export function icon(name: IconName, cls = ''): string {
    return `<svg class="icon ${cls}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${ICON_PATHS[name]}"></path></svg>`;
}

export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
}

export function baseName(path: string): string {
    return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

/** Windows paths are case-insensitive. */
export function samePath(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

const toastEl = document.getElementById('toast')!;
let toastTimer: number | undefined;

export function showToast(message: unknown, kind: 'error' | 'info' = 'error', ms = kind === 'error' ? 6000 : 1200) {
    toastEl.textContent = String(message).replace(/^Error:\s*/, '');
    toastEl.className = `toast toast-${kind}`;
    toastEl.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), ms);
}

export const showError = (err: unknown) => showToast(err, 'error');

export interface AskButton {
    id: string;
    label: string;
    primary?: boolean;
    danger?: boolean;
}

/**
 * Shows a modal question and resolves with the id of the chosen button.
 * Escape (or clicking outside) resolves with "cancel".
 */
export function ask(title: string, message: string, buttons: AskButton[]): Promise<string> {
    return new Promise((resolve) => {
        const previous = document.activeElement as HTMLElement | null;
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.innerHTML = `
            <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-message">
                <h2 id="modal-title">${escapeHtml(title)}</h2>
                <p id="modal-message">${escapeHtml(message)}</p>
                <div class="modal-actions">${buttons.map((b) => `
                    <button type="button" class="btn${b.primary ? ' btn-primary' : ''}${b.danger ? ' btn-danger' : ''}"
                        data-id="${escapeHtml(b.id)}">${escapeHtml(b.label)}</button>`).join('')}
                </div>
            </div>`;
        const done = (id: string) => {
            backdrop.remove();
            document.removeEventListener('keydown', onKey, true);
            previous?.focus?.();
            resolve(id);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                done('cancel');
            } else if (e.key === 'Tab') {
                // Keep focus inside the dialog.
                const btns = [...backdrop.querySelectorAll<HTMLButtonElement>('button')];
                const i = btns.indexOf(document.activeElement as HTMLButtonElement);
                e.preventDefault();
                btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
            } else if (!e.ctrlKey && !e.altKey && e.key !== 'Enter' && e.key !== ' ') {
                e.stopPropagation(); // no app shortcuts while the dialog is open
            }
        };
        backdrop.addEventListener('click', (e) => {
            const btn = (e.target as Element).closest<HTMLElement>('button[data-id]');
            if (btn) done(btn.dataset.id!);
            else if (e.target === backdrop) done('cancel');
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(backdrop);
        (backdrop.querySelector<HTMLButtonElement>('.btn-primary') ?? backdrop.querySelector('button'))?.focus();
    });
}

export function isModalOpen(): boolean {
    return document.querySelector('.modal-backdrop') !== null;
}
