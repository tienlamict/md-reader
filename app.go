package main

import (
	"context"

	"md-reader/internal/markdown"
)

// App holds the state shared with the frontend through Wails bindings.
type App struct {
	ctx      context.Context
	renderer *markdown.Renderer
}

// NewApp creates the application backend.
func NewApp() *App {
	return &App{renderer: markdown.New()}
}

// startup is called when the app starts; the context is kept for runtime calls.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Render converts Markdown source to GitHub-style HTML plus its heading outline.
func (a *App) Render(src string) (markdown.Result, error) {
	return a.renderer.Render([]byte(src))
}

// HighlightCSS returns the stylesheet for syntax-highlighted code blocks.
func (a *App) HighlightCSS() string {
	return markdown.HighlightCSS()
}
