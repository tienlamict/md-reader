package markdown

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var update = flag.Bool("update", false, "rewrite golden files in testdata")

// TestGolden renders every testdata/*.md and compares with the matching
// .golden.html. Run `go test ./internal/markdown -update` after an intended
// rendering change, then review the diff of the golden files.
func TestGolden(t *testing.T) {
	files, err := filepath.Glob("testdata/*.md")
	if err != nil || len(files) == 0 {
		t.Fatalf("no testdata: %v", err)
	}
	r := New()
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			src, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			res, err := r.Render(src)
			if err != nil {
				t.Fatal(err)
			}
			golden := strings.TrimSuffix(f, ".md") + ".golden.html"
			if *update {
				if err := os.WriteFile(golden, []byte(res.HTML), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			want, err := os.ReadFile(golden)
			if err != nil {
				t.Fatalf("missing golden file (run with -update): %v", err)
			}
			if res.HTML != strings.ReplaceAll(string(want), "\r\n", "\n") {
				t.Errorf("output differs from %s\n--- got ---\n%s", golden, res.HTML)
			}
		})
	}
}

func render(t *testing.T, src string) Result {
	t.Helper()
	res, err := New().Render([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestHeadingIDs(t *testing.T) {
	res := render(t, "# Hello World!\n## Hello World!\n## Hello World!\n### Xin chào `Go` & [bạn](x)\n### snake_case-ok\n")
	want := []Heading{
		{1, "hello-world", "Hello World!"},
		{2, "hello-world-1", "Hello World!"},
		{2, "hello-world-2", "Hello World!"},
		{3, "xin-chào-go--bạn", "Xin chào Go & bạn"},
		{3, "snake_case-ok", "snake_case-ok"},
	}
	if len(res.Headings) != len(want) {
		t.Fatalf("got %d headings, want %d: %+v", len(res.Headings), len(want), res.Headings)
	}
	for i, h := range want {
		if res.Headings[i] != h {
			t.Errorf("heading %d = %+v, want %+v", i, res.Headings[i], h)
		}
		if !strings.Contains(res.HTML, `id="`+h.ID+`"`) {
			t.Errorf("HTML lacks id %q", h.ID)
		}
	}
}

func TestAlerts(t *testing.T) {
	cases := []struct {
		name, src, want, notWant string
	}{
		{"note", "> [!NOTE]\n> Hi", `<div class="markdown-alert markdown-alert-note">`, "[!NOTE]"},
		{"lowercase marker", "> [!tip]\n> Hi", "markdown-alert-tip", "[!tip]"},
		{"marker then paragraph", "> [!CAUTION]\n>\n> Hi", "markdown-alert-caution", "[!CAUTION]"},
		{"marker only stays blockquote", "> [!NOTE]", "<blockquote>", "markdown-alert"},
		{"text on marker line stays blockquote", "> [!NOTE] Hi", "<blockquote>", "markdown-alert"},
		{"unknown type", "> [!FOO]\n> Hi", "<blockquote>", "markdown-alert"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			html := render(t, c.src).HTML
			if !strings.Contains(html, c.want) {
				t.Errorf("want %q in:\n%s", c.want, html)
			}
			if strings.Contains(html, c.notWant) {
				t.Errorf("did not want %q in:\n%s", c.notWant, html)
			}
		})
	}
}

func TestTaskListClasses(t *testing.T) {
	html := render(t, "- [x] a\n- [ ] b\n").HTML
	for _, want := range []string{`<ul class="contains-task-list">`, `<li class="task-list-item">`, `type="checkbox"`, `checked`} {
		if !strings.Contains(html, want) {
			t.Errorf("want %q in:\n%s", want, html)
		}
	}
}

func TestSanitize(t *testing.T) {
	html := render(t, "<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n<img src=\"a.png\" onerror=\"alert(1)\">\n\n<a href=\"#\" style=\"color:red\" onclick=\"x()\">y</a>\n").HTML
	for _, bad := range []string{"<script", "javascript:", "onerror", "onclick", "style="} {
		if strings.Contains(html, bad) {
			t.Errorf("unsafe %q survived:\n%s", bad, html)
		}
	}
	if !strings.Contains(html, `src="a.png"`) {
		t.Errorf("relative image was stripped:\n%s", html)
	}
}

func TestHighlightCSS(t *testing.T) {
	css := HighlightCSS()
	if !strings.Contains(css.Light, ".chroma") || !strings.Contains(css.Dark, ".chroma") {
		t.Fatal("missing .chroma rules")
	}
	if css.Light == css.Dark {
		t.Error("light and dark CSS are identical")
	}
}
