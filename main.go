package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"md-reader/internal/localfs"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp(os.Args[1:])

	err := wails.Run(&options.App{
		Title:     appName,
		Width:     1280,
		Height:    820,
		MinWidth:  480,
		MinHeight: 320,
		Menu:      app.buildMenu(),
		AssetServer: &assetserver.Options{
			Assets: assets,
			// Serves images referenced by relative paths in the open document.
			Middleware: localfs.Middleware,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 1},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		Windows: &windows.Options{
			Theme: windows.SystemDefault,
		},
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
