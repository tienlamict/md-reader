package markdown

import (
	"bytes"
	"html"

	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// ```mermaid blocks become <div class="mermaid-block"><pre class="mermaid-source">…</pre></div>
// (the frontend replaces the source with the rendered SVG), and ```math
// blocks become display math. Both must skip syntax highlighting.

// KindMermaid is the AST node kind of a mermaid diagram.
var KindMermaid = ast.NewNodeKind("Mermaid")

// Mermaid is a diagram; its source is in Lines().
type Mermaid struct {
	ast.BaseBlock
}

func (n *Mermaid) Kind() ast.NodeKind { return KindMermaid }

func (n *Mermaid) IsRaw() bool { return true }

func (n *Mermaid) Dump(src []byte, level int) {
	ast.DumpHelper(n, src, level, nil, nil)
}

type fencedTransformer struct{}

func (t *fencedTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	src := reader.Source()
	var blocks []*ast.FencedCodeBlock
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if fcb, ok := n.(*ast.FencedCodeBlock); ok && entering {
			blocks = append(blocks, fcb)
		}
		return ast.WalkContinue, nil
	})

	for _, fcb := range blocks {
		var repl ast.Node
		switch string(bytes.ToLower(fcb.Language(src))) {
		case "mermaid":
			repl = &Mermaid{}
		case "math":
			repl = &MathBlock{}
		default:
			continue
		}
		repl.SetLines(fcb.Lines())
		fcb.Parent().ReplaceChild(fcb.Parent(), fcb, repl)
	}
}

type mermaidRenderer struct{}

func (r *mermaidRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	reg.Register(KindMermaid, r.render)
}

func (r *mermaidRenderer) render(w util.BufWriter, src []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
	if !entering {
		return ast.WalkContinue, nil
	}
	_, _ = w.WriteString(`<div class="mermaid-block"><pre class="mermaid-source">` +
		html.EscapeString(linesText(n, src)) + "</pre></div>\n")
	return ast.WalkSkipChildren, nil
}
