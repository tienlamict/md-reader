# MD Reader

Ứng dụng Windows để **xem và sửa file Markdown, hiển thị giống như trên GitHub**. Viết bằng Go ([Wails](https://wails.io) + WebView2).

## Tính năng

- **Hiển thị như GitHub:**
  - GFM: bảng, task list, gạch ngang, autolink, footnote, emoji `:smile:`.
  - Tô màu code, GitHub Alerts (`> [!NOTE]`…), anchor cho heading (giữ được tiếng Việt).
  - Sơ đồ **mermaid**, công thức toán `$…$` / `$$…$$` (KaTeX).
  - Theme sáng / tối / theo hệ thống.
- **Kiểu Notepad++:**
  - Nhiều tab, cây thư mục, danh sách file gần đây.
  - Kéo thả file hoặc thư mục vào cửa sổ.
  - Tự tải lại khi file thay đổi trên đĩa.
  - Mục lục, tìm trong trang, zoom.
  - Nhớ session: tab, thư mục, zoom.
- **Chế độ sửa:**
  - CodeMirror có tô màu cú pháp và tìm/thay thế.
  - Chế độ chia đôi có preview chạy live và đồng bộ cuộn hai bên.
  - Khi lưu, giữ nguyên CRLF/LF, BOM và UTF-16 của file gốc.
  - Hỏi trước khi đóng tab hoặc thoát nếu còn thay đổi chưa lưu.
  - Phát hiện khi file bị sửa bên ngoài trong lúc bạn đang sửa.
- **Khác:**
  - In và xuất ra một file HTML độc lập (không cần mạng).
  - Nút copy cho code block.
  - Chỉ chạy một cửa sổ: mở thêm file từ Explorer sẽ thành tab mới trong cửa sổ đang chạy.
- **Bảo mật:**
  - HTML trong file `.md` được lọc giống GitHub.
  - Link `javascript:` bị chặn.
  - App chỉ đọc file ảnh để hiển thị, và không bao giờ chạy file được link tới.

## Phím tắt

| Phím | Chức năng |
|---|---|
| `Ctrl+N` / `Ctrl+O` / `Ctrl+Shift+O` | File mới / Mở file / Mở thư mục |
| `Ctrl+S` / `Ctrl+Shift+S` | Lưu / Lưu thành |
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` / `Ctrl+E` | Xem / Sửa / Chia đôi / Bật-tắt chế độ sửa |
| `Ctrl+F`, `F3` | Tìm (trong chế độ Sửa: tìm và thay thế) |
| `F5` | Tải lại |
| `Ctrl+W` | Đóng tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Tab tiếp theo / trước |
| `Alt+←` / `Alt+→` | Quay lại / Tiến tới (cả nút back/forward trên chuột) |
| `Ctrl+B` / `Ctrl+Shift+M` | Ẩn/hiện cây thư mục / mục lục |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, `Ctrl+lăn chuột` | Phóng to / Thu nhỏ / Cỡ gốc |
| `Ctrl+P` / `Ctrl+Shift+E` | In / Xuất ra HTML |

Mở file từ dòng lệnh: `md-reader.exe README.md docs\guide.md` (truyền một thư mục để mở nó trong cây thư mục).

## Phát triển

Cần có: Go (bản ghi trong `go.mod`; Go sẽ tự tải nếu máy đang dùng bản cũ hơn), Node.js 18+ và [Wails CLI v2](https://wails.io/docs/gettingstarted/installation):

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Chạy ở chế độ phát triển (frontend tự reload khi sửa code; Go được build lại khi file `.go` thay đổi):

```bash
wails dev
```

Khi chạy `wails dev`, có thể mở http://localhost:34115 bằng trình duyệt để gọi được code Go từ DevTools.

Chạy test:

```bash
go test ./...
```

Golden test của renderer nằm trong `internal/markdown/testdata`. Khi cố ý thay đổi cách render, cập nhật file golden rồi xem lại diff:

```bash
go test ./internal/markdown -update
```

## Build và đóng gói

Build file `.exe` (ra `build/bin/md-reader.exe`):

```bash
wails build -clean
```

Tạo installer (ra `build/bin/md-reader-amd64-installer.exe`). Cần cài [NSIS](https://nsis.sourceforge.io) trước, ví dụ bằng `winget install NSIS.NSIS`:

```bash
wails build -clean -nsis
```

Installer sẽ:

- cài vào `Program Files\tienlamict\MD Reader`, tạo shortcut ở Start Menu và Desktop;
- liên kết `.md` và `.markdown` với MD Reader (có icon riêng cho file) và thêm MD Reader vào danh sách "Mở bằng";
- tự tải WebView2 Runtime nếu máy chưa có (Windows 11 có sẵn).

Gỡ cài đặt sẽ trả lại liên kết file cũ. Cài đặt của người dùng trong `%APPDATA%\md-reader\config.json` được giữ lại.

> [!NOTE]
> Windows 10/11 không cho chương trình tự đặt app mặc định. Nếu `.md` đang được mở bằng app khác, chọn **Mở bằng → Chọn ứng dụng khác → MD Reader → Luôn dùng ứng dụng này** một lần.

> [!WARNING]
> Installer và file exe chưa được ký số (code signing), nên lần đầu chạy Windows SmartScreen có thể cảnh báo. Bấm **Thông tin thêm → Vẫn chạy**.

### Icon

Icon app và icon file `.md` được vẽ bằng code. Sau khi sửa `tools/genicons/main.go`, tạo lại icon bằng:

```bash
go run ./tools/genicons
```

### Đổi phiên bản

Sửa `info.productVersion` trong `wails.json` và hằng `appVersion` trong `app.go` (hiện trong **Trợ giúp → Giới thiệu**).

## Cấu trúc

```
main.go, app.go        Cửa sổ Wails, menu, các hàm frontend gọi tới
editing.go             Đọc/lưu file cho editor, chặn thoát khi còn thay đổi chưa lưu
instance.go            Chạy một instance, hộp thoại Giới thiệu
internal/markdown      goldmark → HTML giống GitHub (alerts, toán, mermaid, số dòng nguồn, lọc HTML)
internal/links         Xử lý link và đường dẫn ảnh
internal/localfs       Phục vụ ảnh local cho WebView
internal/textfile      Giữ nguyên CRLF/LF, BOM, UTF-16 khi lưu
internal/watcher       Theo dõi file đang mở (fsnotify)
internal/fstree        Cây thư mục
internal/config        Cài đặt và session (%APPDATA%\md-reader)
frontend/src           Giao diện: tab, cây thư mục, mục lục, tìm kiếm, editor, xuất HTML
tools/genicons         Công cụ vẽ icon
testdata/demo          File mẫu để thử bằng tay
```
