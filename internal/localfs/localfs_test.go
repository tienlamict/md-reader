package localfs

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestMiddleware(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "docs", "README.md")
	files := map[string]string{
		filepath.Join(dir, "docs", "img", "logo.png"): "PNGDATA",
		filepath.Join(dir, "shared", "diagram.svg"):   "<svg/>",
		filepath.Join(dir, "docs", "secret.txt"):      "secret",
	}
	for p, content := range files {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("next"))
	})
	h := Middleware(next)

	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}
	local := func(src string) string {
		return Prefix + "?doc=" + url.QueryEscape(doc) + "&src=" + url.QueryEscape(src)
	}

	cases := []struct {
		name, path string
		code       int
		body, ct   string
	}{
		{"image next to doc", local("img/logo.png"), 200, "PNGDATA", "image/png"},
		{"image via ..", local("../shared/diagram.svg"), 200, "<svg/>", "image/svg+xml"},
		{"non-image refused", local("secret.txt"), 404, "", ""},
		{"missing file", local("img/none.png"), 404, "", ""},
		{"external refused", local("https://x.org/a.png"), 404, "", ""},
		{"other paths pass through", "/assets/index.js", 200, "next", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := get(c.path)
			if rec.Code != c.code {
				t.Fatalf("code = %d, want %d", rec.Code, c.code)
			}
			if c.body != "" && rec.Body.String() != c.body {
				t.Errorf("body = %q, want %q", rec.Body.String(), c.body)
			}
			if c.ct != "" && rec.Header().Get("Content-Type") != c.ct {
				t.Errorf("content-type = %q, want %q", rec.Header().Get("Content-Type"), c.ct)
			}
		})
	}
}
