# Kế hoạch: Markdown Reader viết bằng Go

Mục tiêu: tool đọc file `.md` (kiểu Notepad++), hiển thị giống GitHub, viết bằng Golang.

## 1. Chọn công nghệ

Muốn hiển thị **giống GitHub** thì phải render ra HTML và dùng CSS của GitHub. Vì vậy cách hợp lý nhất là: **Go lo backend, WebView lo hiển thị**.

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| GUI | **Wails v2** (Go + WebView2) | Ra cửa sổ native, có menu và hộp thoại mở file. WebView2 có sẵn trên Win11. Build ra 1 file `.exe` khoảng 10MB |
| Parser Markdown | **goldmark** | Tuân thủ CommonMark (Hugo cũng dùng). Có extension GFM: bảng, task list, gạch ngang, autolink |
| Tô màu code | **goldmark-highlighting** (chroma) | Có sẵn style `github` / `github-dark` |
| Mở rộng | footnote, emoji `:smile:`, heading anchor, GitHub Alerts `> [!NOTE]` (tự viết extension) | Giống GitHub nhất có thể |
| Lọc HTML | **bluemonday** | GitHub cũng lọc HTML thô, nên làm vậy là vừa an toàn vừa giống |
| CSS | **github-markdown-css** (light/dark) | Đây chính là CSS GitHub dùng |
| Mermaid / Math | mermaid.js, KaTeX (đóng gói kèm app) | Chạy offline, không cần CDN |
| Theo dõi file | **fsnotify** | File bị sửa ở chỗ khác thì app tự reload |

**Các phương án đã loại:**

- **Fyne**: thuần Go, nhưng widget markdown hiển thị kém xa GitHub (bảng, highlight code yếu).
- **TUI (glamour)**: chạy trong terminal, không giống GitHub được.
- **Gọi GitHub API `/markdown`**: ra kết quả chính xác 100%, nhưng cần mạng và bị giới hạn số request. Có thể để làm "chế độ so sánh" sau này.

## 2. Kiến trúc

```
┌──────────── Wails window ─────────────────────────────┐
│  Frontend (TypeScript + Vite)                         │
│  ┌─────────┬─────────────────────────────┬─────────┐  │
│  │ Sidebar │  Tabs: README.md | docs.md  │  TOC    │  │
│  │ (cây    │  ┌───────────────────────┐  │ (mục    │  │
│  │  thư    │  │ <article class=       │  │  lục)   │  │
│  │  mục)   │  │  "markdown-body">     │  │         │  │
│  └─────────┴──┴───────────────────────┴──┴─────────┘  │
│        ▲ binding calls          │ events (file đổi)    │
├────────┼────────────────────────┼─────────────────────┤
│  Go backend                     ▼                     │
│  app.go: OpenFile / OpenFolder / Render / Recent      │
│  internal/markdown: goldmark pipeline → HTML          │
│  internal/watcher:  fsnotify → emit "file:changed"    │
│  internal/assets:   serve ảnh local (đường dẫn tương đối) │
└───────────────────────────────────────────────────────┘
```

**Cấu trúc thư mục dự kiến:**

```
md-reader/
├── main.go, app.go, wails.json
├── internal/
│   ├── markdown/   (renderer.go, alerts.go, renderer_test.go, testdata/*.md + golden .html)
│   ├── watcher/
│   ├── assets/     (handler phục vụ ảnh/file local cho WebView)
│   └── config/     (recent files, theme, zoom → %APPDATA%\md-reader\config.json)
├── frontend/       (index.html, src/main.ts, styles/github-markdown*.css)
└── build/          (icon, manifest Windows, cấu hình installer NSIS)
```

## 3. Các giai đoạn

### Phase 0: Khởi tạo (khoảng 0.5 ngày)

- Cài Wails CLI, chạy `wails doctor`, tạo project từ template `vanilla-ts`, thiết lập `.gitignore`.

### Phase 1: Lõi render (khoảng 1–2 ngày). Phần này quan trọng nhất.

- Dựng pipeline goldmark với GFM, highlight, footnote, emoji, heading ID kiểu GitHub (`## Hello World` → `#hello-world`) và GitHub Alerts.
- Viết test golden-file: một bộ file `.md` mẫu (bảng, code, task list, HTML thô, alert…) đối chiếu với HTML mong đợi.

### Phase 2: Viewer cơ bản (khoảng 1–2 ngày)

- Mở file (`Ctrl+O`), render, áp CSS GitHub, chuyển light/dark (mặc định theo hệ thống).
- Ảnh có đường dẫn tương đối hiển thị đúng. Link tới `.md` khác mở ngay trong app, link `http` mở bằng trình duyệt, link `#anchor` thì cuộn tới vị trí.

### Phase 3: Tính năng kiểu Notepad++ (khoảng 2–3 ngày)

- Nhiều tab; sidebar cây thư mục (mở folder); danh sách file gần đây.
- Kéo thả file vào cửa sổ; mở file qua tham số dòng lệnh (`md-reader.exe README.md`).
- Tự reload khi file đổi; mục lục (TOC) bên phải; tìm trong trang (`Ctrl+F`); zoom (`Ctrl +/-`).
- Nhớ trạng thái: theme, zoom, các tab đang mở.

### Phase 4: Nâng cao (khoảng 1–2 ngày)

- Diagram mermaid, công thức toán `$...$` / `$$...$$`, nút copy cho code block.
- In / xuất ra HTML.

### Phase 5: Chế độ sửa (khoảng 2–3 ngày)

- 3 chế độ xem cho mỗi tab: **Xem** / **Sửa** / **Chia đôi** (editor bên trái, preview live bên phải).
- Editor: CodeMirror 6 (highlight cú pháp markdown, số dòng, undo/redo, tìm & thay thế).
- Preview cập nhật live (debounce ~150ms), cuộn đồng bộ giữa editor và preview.
- `Ctrl+S` lưu, `Ctrl+Shift+S` lưu thành file khác, `Ctrl+N` tạo file mới.
- Đánh dấu tab chưa lưu (`●`), hỏi trước khi đóng tab/thoát nếu còn thay đổi chưa lưu.
- Xử lý xung đột: file bị sửa bên ngoài khi đang có thay đổi chưa lưu thì hỏi người dùng thay vì tự reload.
- Giữ nguyên kiểu xuống dòng (CRLF/LF) và encoding (UTF-8, có/không BOM) của file gốc khi lưu.

### Phase 6: Đóng gói (khoảng 1 ngày)

- `wails build`, tạo installer NSIS, đăng ký mở file `.md` bằng app (file association).
- Chỉ cho chạy 1 instance (Wails có `SingleInstanceLock`): double-click file trong Explorer sẽ mở thêm tab trong cửa sổ đang chạy, không mở cửa sổ mới.

## 4. Kiểm thử

- **Unit test**: golden test cho renderer, test resolve đường dẫn ảnh/link, test config.
- **Kiểm tra bằng mắt**: so sánh bộ file mẫu với cách GitHub hiển thị chính những file đó.
- **Thủ công**: kéo thả, mở bằng file association, tự reload khi sửa file ở editor khác.

## 5. Rủi ro và cách xử lý

- **Khác GitHub ở các trường hợp đặc biệt**: goldmark và cmark-gfm của GitHub đôi khi xử lý khác nhau. Golden test sẽ phát hiện những chỗ này.
- **HTML độc trong file `.md`**: lọc bằng bluemonday và đặt CSP cho WebView.
- **Máy không có WebView2** (Win10 cũ): installer của Wails có thể tự cài kèm.

## 6. Quyết định đã chốt

1. **Cần cả chế độ sửa**: là Phase 5 (bắt buộc), đóng gói dời xuống Phase 6.
2. **Chỉ Windows**: không cần làm installer và file association cho macOS/Linux.
3. **Frontend vanilla TypeScript** + Vite.
4. **Mermaid và công thức toán để Phase 4.**
