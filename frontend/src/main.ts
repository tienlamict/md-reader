import 'github-markdown-css/github-markdown.css';
import './style.css';

import {HighlightCSS, Render} from '../wailsjs/go/main/App';
import sample from './sample.md?raw';

async function init() {
    const style = document.createElement('style');
    style.textContent = await HighlightCSS();
    document.head.appendChild(style);

    const result = await Render(sample);
    document.querySelector<HTMLElement>('#app')!.innerHTML =
        `<article class="markdown-body">${result.html}</article>`;
}

init().catch((err) => {
    document.querySelector<HTMLElement>('#app')!.textContent = `Lỗi: ${err}`;
});
