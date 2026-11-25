package markdown

import (
	"bytes"
	"html"
	"slices"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// GitHub math syntax:
//
//	inline:  $E = mc^2$   $`a_1 * b_2`$
//	display: $$ … $$ (on their own lines, or $$x$$ on one line) and ```math blocks
//
// The TeX source is emitted HTML-escaped inside
// <span class="math math-inline"> / <div class="math math-display">
// and typeset by KaTeX in the frontend. Parsing it here keeps Markdown from
// turning "_" or "*" inside formulas into emphasis.

// KindMathInline and KindMathBlock are the AST node kinds for math.
var (
	KindMathInline = ast.NewNodeKind("MathInline")
	KindMathBlock  = ast.NewNodeKind("MathBlock")
)

// MathInline is a formula inside a paragraph.
type MathInline struct {
	ast.BaseInline
	TeX     []byte
	Display bool // written as $$…$$ inside a line
}

func (n *MathInline) Kind() ast.NodeKind { return KindMathInline }

func (n *MathInline) Dump(src []byte, level int) {
	ast.DumpHelper(n, src, level, map[string]string{"TeX": string(n.TeX)}, nil)
}

// MathBlock is a display formula; its TeX source is in Lines().
type MathBlock struct {
	ast.BaseBlock
	closed bool
	fenced bool // came from a ```math code block
	open   int  // offset+1 of the opening $$ (0 when unknown)
}

func (n *MathBlock) Kind() ast.NodeKind { return KindMathBlock }

func (n *MathBlock) IsRaw() bool { return true }

func (n *MathBlock) Dump(src []byte, level int) {
	ast.DumpHelper(n, src, level, nil, nil)
}

// ---------- inline ----------

type mathInlineParser struct{}

func (p *mathInlineParser) Trigger() []byte { return []byte{'$'} }

func (p *mathInlineParser) Parse(_ ast.Node, block text.Reader, _ parser.Context) ast.Node {
	line, seg := block.PeekLine()

	// $$…$$ inside a line: display formula.
	if bytes.HasPrefix(line, []byte("$$")) {
		if end := bytes.Index(line[2:], []byte("$$")); end > 0 {
			block.Advance(2 + end + 2)
			return &MathInline{TeX: clone(line[2 : 2+end]), Display: true}
		}
		// Not math: keep both dollars as text so the second one does not
		// start a formula on its own.
		block.Advance(2)
		return ast.NewTextSegment(seg.WithStop(seg.Start + 2))
	}

	// $`…`$ form, for formulas that contain characters Markdown would eat.
	if bytes.HasPrefix(line, []byte("$`")) {
		if end := bytes.Index(line[2:], []byte("`$")); end >= 0 {
			block.Advance(2 + end + 2)
			return &MathInline{TeX: clone(line[2 : 2+end])}
		}
		return nil
	}

	// $…$: no space after the opening dollar, none before the closing one,
	// and no digit right after it (so "costs $5 and $10" stays text).
	if len(line) < 3 || util.IsSpace(line[1]) {
		return nil
	}
	for i := 1; i < len(line); i++ {
		switch c := line[i]; {
		case c == '\\':
			i++ // skip the escaped character, e.g. \$ or \\
		case c == '$':
			if util.IsSpace(line[i-1]) || (i+1 < len(line) && line[i+1] >= '0' && line[i+1] <= '9') {
				continue
			}
			block.Advance(i + 1)
			return &MathInline{TeX: clone(line[1:i])}
		}
	}
	return nil
}

func clone(b []byte) []byte {
	return slices.Clone(b)
}

// ---------- block ----------

type mathBlockParser struct{}

func (p *mathBlockParser) Trigger() []byte { return []byte{'$'} }

func (p *mathBlockParser) Open(_ ast.Node, reader text.Reader, pc parser.Context) (ast.Node, parser.State) {
	line, seg := reader.PeekLine()
	pos := pc.BlockOffset()
	if pos < 0 || !bytes.HasPrefix(line[pos:], []byte("$$")) {
		return nil, parser.NoChildren
	}
	node := &MathBlock{open: seg.Start + pos + 1}
	start := seg.Start + pos + 2
	rest := line[pos+2:]
	trimmed := bytes.TrimRight(rest, " \t\r\n")

	// $$x$$ on a single line.
	if len(trimmed) >= 2 && bytes.HasSuffix(trimmed, []byte("$$")) {
		node.Lines().Append(text.NewSegment(start, start+len(trimmed)-2))
		node.closed = true
	} else if len(bytes.TrimSpace(rest)) > 0 {
		node.Lines().Append(text.NewSegment(start, seg.Stop))
	}
	reader.AdvanceToEOL()
	return node, parser.NoChildren
}

func (p *mathBlockParser) Continue(node ast.Node, reader text.Reader, _ parser.Context) parser.State {
	n := node.(*MathBlock)
	if n.closed {
		return parser.Close
	}
	line, seg := reader.PeekLine()
	if line == nil {
		return parser.Close
	}
	trimmed := bytes.TrimRight(line, " \t\r\n")
	if bytes.HasSuffix(trimmed, []byte("$$")) {
		if content := trimmed[:len(trimmed)-2]; len(bytes.TrimSpace(content)) > 0 {
			n.Lines().Append(text.NewSegment(seg.Start, seg.Start+len(content)))
		}
		reader.AdvanceToEOL()
		return parser.Close
	}
	seg.ForceNewline = true
	n.Lines().Append(seg)
	reader.AdvanceToEOL()
	return parser.Continue | parser.NoChildren
}

func (p *mathBlockParser) Close(ast.Node, text.Reader, parser.Context) {}

func (p *mathBlockParser) CanInterruptParagraph() bool { return true }

func (p *mathBlockParser) CanAcceptIndentedLine() bool { return false }

// ---------- rendering ----------

type mathRenderer struct{}

func (r *mathRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindMathInline, r.renderInline)
	reg.Register(KindMathBlock, r.renderBlock)
}

func (r *mathRenderer) renderInline(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	m := n.(*MathInline)
	class := "math math-inline"
	if m.Display {
		class = "math math-display"
	}
	_, _ = w.WriteString(`<span class="` + class + `">` + html.EscapeString(string(m.TeX)) + `</span>`)
	return ast.WalkSkipChildren, nil
}

func (r *mathRenderer) renderBlock(w util.BufWriter, src []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(`<div class="math math-display"` + lineAttrHTML(n) + `>` + html.EscapeString(linesText(n, src)) + "</div>\n")
	return ast.WalkSkipChildren, nil
}

// linesText joins the raw source lines of a block node.
func linesText(n ast.Node, src []byte) string {
	var b bytes.Buffer
	lines := n.Lines()
	for i := range lines.Len() {
		seg := lines.At(i)
		b.Write(seg.Value(src))
	}
	return string(bytes.TrimRight(b.Bytes(), "\r\n"))
}
