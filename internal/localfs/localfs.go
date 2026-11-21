// Package localfs lets the WebView display images that a Markdown file
// references by a local path (e.g. ![logo](img/logo.png)).
//
// The frontend rewrites such sources to
//
//	/__local?doc=<absolute path of the .md file>&src=<src as written>
//
// and this middleware resolves them with the same rules as links. Only image
// files are served, so a document cannot read arbitrary files from disk.
package localfs

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"md-reader/internal/links"
)

// Prefix is the URL path handled by the middleware.
const Prefix = "/__local"

var imageExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".svg": true, ".bmp": true, ".ico": true, ".avif": true,
}

// Middleware serves Prefix requests and passes everything else to next.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != Prefix {
			next.ServeHTTP(w, r)
			return
		}
		serve(w, r)
	})
}

func serve(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	t := links.Resolve(q.Get("doc"), q.Get("src"))
	ext := strings.ToLower(filepath.Ext(t.Path))
	if t.Kind != links.KindFile || !imageExt[ext] {
		http.NotFound(w, r)
		return
	}

	f, err := os.Open(t.Path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil || fi.IsDir() {
		http.NotFound(w, r)
		return
	}

	if ct := mime.TypeByExtension(ext); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	// Images may be edited while the document is open; always revalidate.
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
}
