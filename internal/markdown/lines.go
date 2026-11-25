package markdown

import (
	"sort"
	"strconv"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// Source line annotations: top-level blocks and list items get
// data-line="N" (1-based line in the Markdown file). The editor uses them to
// keep the editor and the live preview scrolled to the same place.

const lineAttr = "data-line"

// lineIndex maps byte offsets to 1-based line numbers.
type lineIndex []int // offsets where each line starts

func newLineIndex(src []byte) lineIndex {
	idx := lineIndex{0}
	for i, b := range src {
		if b == '\n' {
			idx = append(idx, i+1)
		}
	}
	return idx
}

func (idx lineIndex) line(offset int) int {
	return sort.Search(len(idx), func(i int) bool { return idx[i] > offset })
}

// firstOffset returns the source offset where a block starts, looking into
// its children for container blocks (lists, block quotes, tables…).
func firstOffset(n ast.Node) (int, bool) {
	if n.Type() == ast.TypeBlock && n.Lines().Len() > 0 {
		return n.Lines().At(0).Start, true
	}
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		if off, ok := firstOffset(c); ok {
			return off, true
		}
		if t, ok := c.(*ast.Text); ok {
			return t.Segment.Start, true
		}
	}
	return 0, false
}

func blockLine(n ast.Node, idx lineIndex) (int, bool) {
	off, ok := firstOffset(n)
	if !ok {
		return 0, false
	}
	line := idx.line(off)
	// Fenced code keeps only its content lines; point at the opening fence.
	switch n.(type) {
	case *ast.FencedCodeBlock, *Mermaid:
		if line > 1 {
			line--
		}
	case *MathBlock:
		mb := n.(*MathBlock)
		if mb.open > 0 {
			return idx.line(mb.open - 1), true
		}
		if mb.fenced && line > 1 {
			line--
		}
	}
	return line, true
}

type lineTransformer struct{}

func (t *lineTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	idx := newLineIndex(reader.Source())
	mark := func(n ast.Node) {
		if line, ok := blockLine(n, idx); ok {
			n.SetAttributeString(lineAttr, []byte(strconv.Itoa(line)))
		}
	}
	for c := doc.FirstChild(); c != nil; c = c.NextSibling() {
		mark(c)
	}
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if _, ok := n.(*ast.ListItem); ok && entering {
			mark(n)
		}
		return ast.WalkContinue, nil
	})
}

// lineAttrHTML returns ` data-line="N"` for nodes that have one, for the
// custom renderers (alerts, math, mermaid) that write their own tags.
func lineAttrHTML(n ast.Node) string {
	if v, ok := n.AttributeString(lineAttr); ok {
		if b, ok := v.([]byte); ok {
			return ` data-line="` + string(b) + `"`
		}
	}
	return ""
}
