package main

import (
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// singleInstanceID identifies MD Reader for Wails' single-instance lock.
// Changing it would let an old and a new version run side by side.
const singleInstanceID = "6f1c2a8e-4b7d-4d4e-9a51-md-reader"

// onSecondInstance runs in the first instance when the app is started again,
// e.g. by double-clicking a .md file in Explorer: the files open as tabs in
// the existing window instead of a new window.
func (a *App) onSecondInstance(data options.SecondInstanceData) {
	args := parseArgs(data.Args, data.WorkingDirectory)
	if args.Folder != "" {
		runtime.EventsEmit(a.ctx, evtFolder, args.Folder)
	}
	for _, f := range args.Files {
		runtime.EventsEmit(a.ctx, evtOpen, f)
	}
	a.bringToFront()
}

func (a *App) showAbout() {
	_, _ = runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:  runtime.InfoDialog,
		Title: "Giới thiệu " + appName,
		Message: appName + " " + appVersion + "\n\n" +
			"Xem và sửa file Markdown giống như trên GitHub.\n" +
			"Viết bằng Go (Wails, goldmark), CodeMirror, mermaid và KaTeX.",
	})
}

// bringToFront shows the window above others. Windows does not let a
// background process steal focus, so the window is briefly made topmost.
func (a *App) bringToFront() {
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
	runtime.WindowSetAlwaysOnTop(a.ctx, true)
	runtime.WindowSetAlwaysOnTop(a.ctx, false)
}
