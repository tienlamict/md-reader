package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"md-reader/internal/config"
	"md-reader/internal/fstree"
	"md-reader/internal/links"
	"md-reader/internal/markdown"
	"md-reader/internal/textfile"
	"md-reader/internal/watcher"
)

const appName = "MD Reader"

// Events sent from Go to the frontend.
const (
	evtCommand = "cmd"           // payload: command name, see buildMenu
	evtOpen    = "file:open"     // payload: absolute path of a Markdown file
	evtFolder  = "folder:open"   // payload: absolute path of a folder
	evtChanged = "file:changed"  // payload: path of an open file modified on disk
	evtTheme   = "theme:changed" // payload: theme value
	evtError   = "app:error"     // payload: message for the user
)

// Document is a rendered Markdown file sent to the frontend.
type Document struct {
	Path     string             `json:"path"`
	Name     string             `json:"name"`
	HTML     string             `json:"html"`
	Headings []markdown.Heading `json:"headings"`
}

// StartupArgs are the files/folder given on the command line.
type StartupArgs struct {
	Files  []string `json:"files"`
	Folder string   `json:"folder"`
}

// App holds the state shared with the frontend through Wails bindings.
type App struct {
	ctx      context.Context
	renderer *markdown.Renderer
	watcher  *watcher.Watcher
	args     StartupArgs

	mu         sync.Mutex
	cfg        config.Config
	cfgPath    string
	dirtyCount int  // tabs with unsaved changes (reported by the frontend)
	allowQuit  bool // set once the frontend has resolved unsaved changes
}

// NewApp creates the application backend and loads saved preferences.
func NewApp(args []string) *App {
	a := &App{renderer: markdown.New(), cfg: config.Default(), args: parseArgs(args)}
	if p, err := config.DefaultPath(); err == nil {
		a.cfgPath = p
		a.cfg = config.Load(p)
	}
	return a
}

// parseArgs keeps existing paths: Markdown files are opened as tabs and the
// last folder becomes the sidebar folder.
func parseArgs(args []string) StartupArgs {
	out := StartupArgs{Files: []string{}}
	for _, arg := range args {
		abs, err := filepath.Abs(arg)
		if err != nil {
			continue
		}
		fi, err := os.Stat(abs)
		switch {
		case err != nil:
			continue
		case fi.IsDir():
			out.Folder = abs
		default:
			out.Files = append(out.Files, abs)
		}
	}
	return out
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	w, err := watcher.New(func(path string) {
		runtime.EventsEmit(ctx, evtChanged, path)
	}, 150*time.Millisecond)
	if err != nil {
		log.Printf("file watcher disabled: %v", err)
	} else {
		a.watcher = w
	}
	runtime.OnFileDrop(ctx, a.onFileDrop)
}

func (a *App) domReady(_ context.Context) {
	a.applyWindowTheme(a.GetTheme())
}

func (a *App) shutdown(_ context.Context) {
	if a.watcher != nil {
		_ = a.watcher.Close()
	}
}

// ---------- Files ----------

// OpenFileDialog asks the user for a Markdown file. It returns "" if cancelled.
func (a *App) OpenFileDialog() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Mở file Markdown",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown (*.md, *.markdown)", Pattern: "*.md;*.markdown;*.mdown;*.mkd"},
			{DisplayName: "Tất cả file (*.*)", Pattern: "*.*"},
		},
	})
}

// OpenFolderDialog asks the user for a folder. It returns "" if cancelled.
func (a *App) OpenFolderDialog() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Mở thư mục"})
}

// LoadFile reads and renders a Markdown file.
func (a *App) LoadFile(path string) (Document, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return Document{}, err
	}
	src, err := os.ReadFile(abs)
	if err != nil {
		return Document{}, fmt.Errorf("không đọc được file: %w", err)
	}
	text := textfile.DecodeLossy(src) // handles BOMs, UTF-16 and CRLF

	res, err := a.renderer.Render([]byte(text))
	if err != nil {
		return Document{}, fmt.Errorf("không render được file: %w", err)
	}
	return Document{Path: abs, Name: filepath.Base(abs), HTML: res.HTML, Headings: res.Headings}, nil
}

// ListDir returns sub-folders and Markdown files of dir for the file tree.
func (a *App) ListDir(dir string) ([]fstree.Entry, error) {
	return fstree.List(dir)
}

// WatchFiles sets the files whose changes on disk are reported (file:changed).
func (a *App) WatchFiles(paths []string) {
	if a.watcher == nil {
		return
	}
	if err := a.watcher.SetFiles(paths); err != nil {
		log.Printf("watch: %v", err)
	}
}

// ResolveLink tells the frontend what to do with a link clicked in docPath.
func (a *App) ResolveLink(docPath, href string) links.Target {
	return links.Resolve(docPath, href)
}

// RevealInExplorer selects a local file in Windows Explorer. Files are never
// executed, so a link to an .exe inside a document is harmless.
func (a *App) RevealInExplorer(path string) error {
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("không tìm thấy: %s", path)
	}
	return revealInExplorer(path)
}

// SaveHTML asks where to save an exported HTML page (next to docPath by
// default) and writes it. It returns the saved path, or "" if cancelled.
func (a *App) SaveHTML(docPath, content string) (string, error) {
	name := strings.TrimSuffix(filepath.Base(docPath), filepath.Ext(docPath)) + ".html"
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Xuất ra HTML",
		DefaultDirectory: filepath.Dir(docPath),
		DefaultFilename:  name,
		Filters:          []runtime.FileFilter{{DisplayName: "Trang web (*.html)", Pattern: "*.html;*.htm"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if ext := strings.ToLower(filepath.Ext(path)); ext != ".html" && ext != ".htm" {
		path += ".html"
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("không lưu được file: %w", err)
	}
	return path, nil
}

// GetStartupArgs returns the files and folder passed on the command line.
func (a *App) GetStartupArgs() StartupArgs {
	return a.args
}

func (a *App) onFileDrop(_, _ int, paths []string) {
	skipped := 0
	for _, p := range paths {
		fi, err := os.Stat(p)
		switch {
		case err != nil:
			skipped++
		case fi.IsDir():
			runtime.EventsEmit(a.ctx, evtFolder, p)
		case links.IsMarkdown(p):
			runtime.EventsEmit(a.ctx, evtOpen, p)
		default:
			skipped++
		}
	}
	if skipped > 0 {
		runtime.EventsEmit(a.ctx, evtError, fmt.Sprintf("Bỏ qua %d mục không phải file Markdown hoặc thư mục.", skipped))
	}
}

// ---------- Preferences ----------

// HighlightCSS returns the syntax-highlighting stylesheets for both themes.
func (a *App) HighlightCSS() markdown.ThemeCSS {
	return markdown.HighlightCSS()
}

// GetTheme returns the saved theme: "system", "light" or "dark".
func (a *App) GetTheme() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg.Theme
}

// GetSession returns the window state saved on the last run.
func (a *App) GetSession() config.Session {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg.Session
}

// SaveSession stores the current window state.
func (a *App) SaveSession(s config.Session) {
	if s.Tabs == nil {
		s.Tabs = []string{}
	}
	s.Zoom = config.ClampZoom(s.Zoom)
	a.update(func(c *config.Config) { c.Session = s })
}

// GetRecentFiles returns recently opened files, most recent first.
func (a *App) GetRecentFiles() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string{}, a.cfg.Recent...)
}

// AddRecentFile records a file the user opened and refreshes the menu.
func (a *App) AddRecentFile(path string) {
	a.update(func(c *config.Config) { c.Recent = config.AddRecent(c.Recent, path) })
	a.refreshMenu()
}

func (a *App) clearRecentFiles() {
	a.update(func(c *config.Config) { c.Recent = []string{} })
	a.refreshMenu()
}

func (a *App) setTheme(theme string) {
	if !config.ValidTheme(theme) {
		return
	}
	a.update(func(c *config.Config) { c.Theme = theme })
	a.applyWindowTheme(theme)
	runtime.EventsEmit(a.ctx, evtTheme, theme)
}

// update changes the config under the lock and saves it.
func (a *App) update(change func(*config.Config)) {
	a.mu.Lock()
	change(&a.cfg)
	cfg, path := a.cfg, a.cfgPath
	a.mu.Unlock()
	if path == "" {
		return
	}
	if err := config.Save(path, cfg); err != nil {
		log.Printf("save config: %v", err)
	}
}

// applyWindowTheme makes the native title bar match the content theme.
func (a *App) applyWindowTheme(theme string) {
	switch theme {
	case config.ThemeLight:
		runtime.WindowSetLightTheme(a.ctx)
	case config.ThemeDark:
		runtime.WindowSetDarkTheme(a.ctx)
	default:
		runtime.WindowSetSystemDefaultTheme(a.ctx)
	}
}

// ---------- Menu ----------
//
// Keyboard shortcuts are handled by the frontend (Wails cannot bind keys such
// as Ctrl+= or Ctrl+-), so menu items only show them after a tab character,
// which Windows renders as the right-aligned shortcut column.

func (a *App) buildMenu() *menu.Menu {
	cmd := func(name string) menu.Callback {
		return func(*menu.CallbackData) { runtime.EventsEmit(a.ctx, evtCommand, name) }
	}

	m := menu.NewMenu()

	file := m.AddSubmenu("Tệp")
	file.AddText("Mới\tCtrl+N", nil, cmd("new-file"))
	file.AddText("Mở file…\tCtrl+O", nil, cmd("open-file"))
	file.AddText("Mở thư mục…\tCtrl+Shift+O", nil, cmd("open-folder"))
	recent := file.AddSubmenu("Mở gần đây")
	files := a.GetRecentFiles()
	if len(files) == 0 {
		recent.Append(&menu.MenuItem{Label: "(trống)", Type: menu.TextType, Disabled: true})
	}
	for _, p := range files {
		// "&" marks a mnemonic in Win32 menus; "&&" shows a literal ampersand.
		label := strings.ReplaceAll(p, "&", "&&")
		recent.AddText(label, nil, func(*menu.CallbackData) { runtime.EventsEmit(a.ctx, evtOpen, p) })
	}
	if len(files) > 0 {
		recent.AddSeparator()
		recent.AddText("Xoá danh sách", nil, func(*menu.CallbackData) { a.clearRecentFiles() })
	}
	file.AddSeparator()
	file.AddText("Lưu\tCtrl+S", nil, cmd("save"))
	file.AddText("Lưu thành…\tCtrl+Shift+S", nil, cmd("save-as"))
	file.AddSeparator()
	file.AddText("Xuất ra HTML…\tCtrl+Shift+E", nil, cmd("export-html"))
	file.AddText("In…\tCtrl+P", nil, cmd("print"))
	file.AddSeparator()
	file.AddText("Tải lại\tF5", nil, cmd("reload"))
	file.AddText("Đóng tab\tCtrl+W", nil, cmd("close-tab"))
	file.AddSeparator()
	file.AddText("Thoát\tAlt+F4", nil, func(*menu.CallbackData) { runtime.Quit(a.ctx) })

	view := m.AddSubmenu("Xem")
	view.AddText("Chế độ xem\tCtrl+1", nil, cmd("mode-view"))
	view.AddText("Chế độ sửa\tCtrl+2", nil, cmd("mode-edit"))
	view.AddText("Chia đôi (sửa + xem)\tCtrl+3", nil, cmd("mode-split"))
	view.AddSeparator()
	view.AddText("Tìm trong trang…\tCtrl+F", nil, cmd("find"))
	view.AddSeparator()
	view.AddText("Cây thư mục\tCtrl+B", nil, cmd("toggle-sidebar"))
	view.AddText("Mục lục\tCtrl+Shift+M", nil, cmd("toggle-toc"))
	view.AddSeparator()
	view.AddText("Phóng to\tCtrl+=", nil, cmd("zoom-in"))
	view.AddText("Thu nhỏ\tCtrl+-", nil, cmd("zoom-out"))
	view.AddText("Cỡ gốc\tCtrl+0", nil, cmd("zoom-reset"))
	view.AddSeparator()
	view.AddText("Quay lại\tAlt+Left", nil, cmd("back"))
	view.AddText("Tiến tới\tAlt+Right", nil, cmd("forward"))
	view.AddText("Tab tiếp theo\tCtrl+Tab", nil, cmd("next-tab"))
	view.AddText("Tab trước\tCtrl+Shift+Tab", nil, cmd("prev-tab"))
	view.AddSeparator()
	current := a.GetTheme()
	for _, opt := range []struct{ label, value string }{
		{"Giao diện: theo hệ thống", config.ThemeSystem},
		{"Giao diện: sáng", config.ThemeLight},
		{"Giao diện: tối", config.ThemeDark},
	} {
		view.AddRadio(opt.label, current == opt.value, nil, func(*menu.CallbackData) { a.setTheme(opt.value) })
	}
	return m
}

func (a *App) refreshMenu() {
	if a.ctx == nil {
		return
	}
	runtime.MenuSetApplicationMenu(a.ctx, a.buildMenu())
	runtime.MenuUpdateApplicationMenu(a.ctx)
}
