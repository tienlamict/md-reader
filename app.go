package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"md-reader/internal/config"
	"md-reader/internal/links"
	"md-reader/internal/markdown"
)

const appName = "MD Reader"

// Events sent from the Go side (mostly the native menu) to the frontend.
const (
	evtOpen    = "file:open"     // payload: absolute path
	evtReload  = "file:reload"   // reload the current document
	evtBack    = "nav:back"      // history back
	evtForward = "nav:forward"   // history forward
	evtTheme   = "theme:changed" // payload: theme value
)

// Document is a rendered Markdown file sent to the frontend.
type Document struct {
	Path     string             `json:"path"`
	Name     string             `json:"name"`
	HTML     string             `json:"html"`
	Headings []markdown.Heading `json:"headings"`
}

// App holds the state shared with the frontend through Wails bindings.
type App struct {
	ctx      context.Context
	renderer *markdown.Renderer

	mu      sync.Mutex
	cfg     config.Config
	cfgPath string
}

// NewApp creates the application backend and loads saved preferences.
func NewApp() *App {
	a := &App{renderer: markdown.New(), cfg: config.Default()}
	if p, err := config.DefaultPath(); err == nil {
		a.cfgPath = p
		a.cfg = config.Load(p)
	}
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) domReady(_ context.Context) {
	a.applyWindowTheme(a.GetTheme())
}

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

// LoadFile reads and renders a Markdown file and updates the window title.
func (a *App) LoadFile(path string) (Document, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return Document{}, err
	}
	src, err := os.ReadFile(abs)
	if err != nil {
		return Document{}, fmt.Errorf("không đọc được file: %w", err)
	}
	src = bytes.TrimPrefix(src, []byte("\xef\xbb\xbf")) // UTF-8 BOM

	res, err := a.renderer.Render(src)
	if err != nil {
		return Document{}, fmt.Errorf("không render được file: %w", err)
	}
	name := filepath.Base(abs)
	runtime.WindowSetTitle(a.ctx, name+" - "+appName)
	return Document{Path: abs, Name: name, HTML: res.HTML, Headings: res.Headings}, nil
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

func (a *App) setTheme(theme string) {
	if !config.ValidTheme(theme) {
		return
	}
	a.mu.Lock()
	a.cfg.Theme = theme
	cfg, path := a.cfg, a.cfgPath
	a.mu.Unlock()

	if path != "" {
		if err := config.Save(path, cfg); err != nil {
			log.Printf("save config: %v", err)
		}
	}
	a.applyWindowTheme(theme)
	runtime.EventsEmit(a.ctx, evtTheme, theme)
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

func (a *App) openViaDialog() {
	path, err := a.OpenFileDialog()
	if err != nil {
		runtime.LogErrorf(a.ctx, "open dialog: %v", err)
		return
	}
	if path != "" {
		runtime.EventsEmit(a.ctx, evtOpen, path)
	}
}

func (a *App) buildMenu() *menu.Menu {
	emit := func(event string) menu.Callback {
		return func(*menu.CallbackData) { runtime.EventsEmit(a.ctx, event) }
	}

	m := menu.NewMenu()

	file := m.AddSubmenu("Tệp")
	file.AddText("Mở…", keys.CmdOrCtrl("o"), func(*menu.CallbackData) { a.openViaDialog() })
	file.AddText("Tải lại", keys.Key("F5"), emit(evtReload))
	file.AddSeparator()
	file.AddText("Thoát", keys.OptionOrAlt("F4"), func(*menu.CallbackData) { runtime.Quit(a.ctx) })

	view := m.AddSubmenu("Xem")
	view.AddText("Quay lại", keys.OptionOrAlt("Left"), emit(evtBack))
	view.AddText("Tiến tới", keys.OptionOrAlt("Right"), emit(evtForward))
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
