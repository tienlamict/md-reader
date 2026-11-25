package markdown

import (
	"regexp"
	"strings"
	"testing"
)

func TestSourceLines(t *testing.T) {
	src := strings.Join([]string{
		"# Tiêu đề",     // 1
		"",              // 2
		"Đoạn văn",      // 3
		"nhiều dòng.",   // 4
		"",              // 5
		"- mục một",     // 6
		"- mục hai",     // 7
		"",              // 8
		"> [!NOTE]",     // 9
		"> ghi chú",     // 10
		"",              // 11
		"```mermaid",    // 12
		"graph TD",      // 13
		"```",           // 14
		"",              // 15
		"$$",            // 16
		"x^2",           // 17
		"$$",            // 18
		"",              // 19
		"| a | b |",     // 20
		"|---|---|",     // 21
		"| 1 | 2 |",     // 22
		"",              // 23
		"```go",         // 24
		"fmt.Println()", // 25
		"```",           // 26
	}, "\n")
	html := renderWithLines(t, src).HTML

	for _, want := range []string{
		`<h1 id="tiêu-đề" data-line="1">`,
		`<p data-line="3">Đoạn văn`,
		`<ul data-line="6">`,
		`<li data-line="6">mục một`,
		`<li data-line="7">mục hai`,
		`<div class="markdown-alert markdown-alert-note" data-line="9">`,
		`<div class="mermaid-block" data-line="12">`,
		`<div class="math math-display" data-line="16">`,
		`<table data-line="20">`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("want %q in:\n%s", want, html)
		}
	}

	// Lines must never go backwards, or scroll sync would jump around.
	last := 0
	for _, m := range regexp.MustCompile(`data-line="(\d+)"`).FindAllStringSubmatch(html, -1) {
		n := 0
		for _, c := range m[1] {
			n = n*10 + int(c-'0')
		}
		if n < last {
			t.Errorf("data-line %d after %d", n, last)
		}
		last = n
	}
}

func TestLineIndex(t *testing.T) {
	idx := newLineIndex([]byte("ab\ncd\n\nef"))
	for off, want := range map[int]int{0: 1, 2: 1, 3: 2, 6: 3, 7: 4, 8: 4} {
		if got := idx.line(off); got != want {
			t.Errorf("line(%d) = %d, want %d", off, got, want)
		}
	}
}
