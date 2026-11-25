package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"md-reader/internal/markdown"
	"md-reader/internal/textfile"
)

// Bindings used by the editor (Phase 5).

// evtQuitRequested asks the frontend what to do with unsaved files before
// the window closes.
const evtQuitRequested = "app:quit-requested"

// Source is the raw text of a Markdown file for the editor. Text always uses
// "\n"; Format remembers how to write it back (line endings, BOM, encoding).
type Source struct {
	Path   string          `json:"path"`
	Name   string          `json:"name"`
	Text   string          `json:"text"`
	Format textfile.Format `json:"format"`
}

// ReadSource loads a file for editing.
func (a *App) ReadSource(path string) (Source, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Source{}, fmt.Errorf("không đọc được file: %w", err)
	}
	text, format, err := textfile.Decode(data)
	if err != nil {
		return Source{}, err
	}
	return Source{Path: path, Name: filepath.Base(path), Text: text, Format: format}, nil
}

// DefaultFormat is the format used for new files.
func (a *App) DefaultFormat() textfile.Format {
	return textfile.DefaultFormat
}

// RenderMarkdown renders editor text for the live preview.
func (a *App) RenderMarkdown(text string) (markdown.Result, error) {
	return a.renderer.Render([]byte(text))
}

// SaveFile writes editor text to path in the given format. The file is
// overwritten in place (like most editors) so its attributes and ACLs stay.
func (a *App) SaveFile(path, text string, format textfile.Format) error {
	if path == "" {
		return errors.New("chưa có đường dẫn để lưu")
	}
	if err := os.WriteFile(path, textfile.Encode(text, format), 0o644); err != nil {
		return fmt.Errorf("không lưu được file: %w", err)
	}
	return nil
}

// SaveAsDialog asks where to save a Markdown file. suggested may be an
// existing path or just a file name. It returns "" if cancelled.
func (a *App) SaveAsDialog(suggested string) (string, error) {
	dir, name := filepath.Split(suggested)
	if name == "" {
		name = "Untitled.md"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:            "Lưu file Markdown",
		DefaultDirectory: dir,
		DefaultFilename:  name,
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown (*.md)", Pattern: "*.md;*.markdown"},
			{DisplayName: "Tất cả file (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	if filepath.Ext(path) == "" {
		path += ".md"
	}
	return path, nil
}

// SetDirtyCount tells Go how many tabs have unsaved changes, so closing the
// window can ask first.
func (a *App) SetDirtyCount(n int) {
	a.mu.Lock()
	a.dirtyCount = n
	a.mu.Unlock()
}

// Quit closes the app without asking again (after the frontend has dealt
// with unsaved files).
func (a *App) Quit() {
	a.mu.Lock()
	a.allowQuit = true
	a.mu.Unlock()
	runtime.Quit(a.ctx)
}

// beforeClose runs when the window is about to close. Returning true keeps
// it open; the frontend then asks about unsaved files and calls Quit.
func (a *App) beforeClose(_ context.Context) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.allowQuit || a.dirtyCount == 0 {
		return false
	}
	runtime.EventsEmit(a.ctx, evtQuitRequested, a.dirtyCount)
	return true
}
