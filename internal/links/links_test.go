package links

import (
	"os"
	"path/filepath"
	"testing"
)

func mkfile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestResolve(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	docDir := filepath.Join(root, "docs")
	doc := filepath.Join(docDir, "guide.md")
	mkfile(t, doc)
	mkfile(t, filepath.Join(docDir, "sub", "README.md"))
	if err := os.MkdirAll(filepath.Join(docDir, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		href string
		want Target
	}{
		{"", Target{}},
		{"#intro", Target{Kind: KindAnchor, Fragment: "intro"}},
		{"#ti%C3%AAu-%C4%91%E1%BB%81", Target{Kind: KindAnchor, Fragment: "tiêu-đề"}},
		{"https://github.com", Target{Kind: KindExternal, URL: "https://github.com"}},
		{"HTTP://x.org/a", Target{Kind: KindExternal, URL: "HTTP://x.org/a"}},
		{"mailto:a@b.c", Target{Kind: KindExternal, URL: "mailto:a@b.c"}},
		{"//cdn.example.com/a.png", Target{Kind: KindExternal, URL: "https://cdn.example.com/a.png"}},
		{"javascript:alert(1)", Target{}},
		{"data:text/html,hi", Target{}},
		{"?q=1", Target{}},
		{"other.md", Target{Kind: KindMarkdown, Path: filepath.Join(docDir, "other.md")}},
		{"other.md#setup", Target{Kind: KindMarkdown, Path: filepath.Join(docDir, "other.md"), Fragment: "setup"}},
		{"../CHANGELOG.markdown", Target{Kind: KindMarkdown, Path: filepath.Join(root, "CHANGELOG.markdown")}},
		{"img/a%20b.png", Target{Kind: KindFile, Path: filepath.Join(docDir, "img", "a b.png")}},
		{`img\c.png`, Target{Kind: KindFile, Path: filepath.Join(docDir, "img", "c.png")}},
		{"sub/", Target{Kind: KindMarkdown, Path: filepath.Join(docDir, "sub", "README.md")}},
		{"sub", Target{Kind: KindMarkdown, Path: filepath.Join(docDir, "sub", "README.md")}},
		{"empty", Target{Kind: KindFile, Path: filepath.Join(docDir, "empty")}},
		{"/LICENSE", Target{Kind: KindFile, Path: filepath.Join(root, "LICENSE")}},
		{`C:\notes\todo.md#x`, Target{Kind: KindMarkdown, Path: `C:\notes\todo.md`, Fragment: "x"}},
		{"file:///C:/notes/a%20b.md", Target{Kind: KindMarkdown, Path: `C:\notes\a b.md`}},
	}
	for _, c := range cases {
		t.Run(c.href, func(t *testing.T) {
			if got := Resolve(doc, c.href); got != c.want {
				t.Errorf("Resolve(%q)\n got  %+v\n want %+v", c.href, got, c.want)
			}
		})
	}
}

func TestRootRelativeWithoutRepo(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "a.md")
	// No .git anywhere under dir: "/x.png" falls back to the document folder
	// (unless the temp dir itself sits inside a repository, which it does not).
	got := Resolve(doc, "/x.png")
	if got.Kind != KindFile || filepath.Base(got.Path) != "x.png" {
		t.Errorf("got %+v", got)
	}
}
