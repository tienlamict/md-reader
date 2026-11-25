// Package markdown converts Markdown source into HTML that matches GitHub's
// rendering as closely as possible (GFM, syntax highlighting, alerts, emoji,
// footnotes, GitHub-style heading anchors) and sanitizes the result.
package markdown

import (
	"bytes"
	"strings"

	chromahtml "github.com/alecthomas/chroma/v2/formatters/html"
	"github.com/alecthomas/chroma/v2/styles"
	"github.com/yuin/goldmark"
	emoji "github.com/yuin/goldmark-emoji"
	highlighting "github.com/yuin/goldmark-highlighting/v2"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Heading is one entry of the document outline, used to build a TOC.
type Heading struct {
	Level int    `json:"level"`
	ID    string `json:"id"`
	Text  string `json:"text"`
}

// Result is the output of Render.
type Result struct {
	HTML     string    `json:"html"`
	Headings []Heading `json:"headings"`
}

// Renderer turns Markdown into sanitized, GitHub-flavoured HTML.
// It is safe for concurrent use.
type Renderer struct {
	md goldmark.Markdown
}

// New creates a Renderer configured to mimic GitHub.
func New() *Renderer {
	md := goldmark.New(
		goldmark.WithExtensions(
			extension.NewTable(extension.WithTableCellAlignMethod(extension.TableCellAlignAttribute)),
			extension.Strikethrough,
			extension.Linkify,
			extension.TaskList,
			extension.Footnote,
			emoji.Emoji,
			highlighting.NewHighlighting(
				highlighting.WithFormatOptions(chromahtml.WithClasses(true)),
			),
		),
		goldmark.WithParserOptions(
			parser.WithBlockParsers(util.Prioritized(&mathBlockParser{}, 690)),
			parser.WithInlineParsers(util.Prioritized(&mathInlineParser{}, 150)),
			parser.WithASTTransformers(
				util.Prioritized(&headingIDTransformer{}, 100),
				util.Prioritized(&alertTransformer{}, 200),
				util.Prioritized(&taskListTransformer{}, 300),
				util.Prioritized(&fencedTransformer{}, 400),
			),
		),
		goldmark.WithRendererOptions(
			// Raw HTML is allowed like on GitHub; the output is sanitized afterwards.
			html.WithUnsafe(),
			renderer.WithNodeRenderers(
				util.Prioritized(&alertRenderer{}, 500),
				util.Prioritized(&mathRenderer{}, 500),
				util.Prioritized(&mermaidRenderer{}, 500),
			),
		),
	)
	return &Renderer{md: md}
}

// Render converts Markdown source to sanitized HTML plus the heading outline.
func (r *Renderer) Render(src []byte) (Result, error) {
	doc := r.md.Parser().Parse(text.NewReader(src))

	var buf bytes.Buffer
	if err := r.md.Renderer().Render(&buf, src, doc); err != nil {
		return Result{}, err
	}

	return Result{
		HTML:     sanitize(buf.String()),
		Headings: collectHeadings(doc, src),
	}, nil
}

func collectHeadings(doc ast.Node, src []byte) []Heading {
	headings := []Heading{}
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		h, ok := n.(*ast.Heading)
		if !ok || !entering {
			return ast.WalkContinue, nil
		}
		id, _ := h.AttributeString("id")
		idStr, _ := id.([]byte)
		headings = append(headings, Heading{
			Level: h.Level,
			ID:    string(idStr),
			Text:  plainText(h, src),
		})
		return ast.WalkSkipChildren, nil
	})
	return headings
}

// plainText returns the visible text of an inline subtree (formatting removed).
func plainText(n ast.Node, src []byte) string {
	var b strings.Builder
	_ = ast.Walk(n, func(c ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch t := c.(type) {
		case *ast.Text:
			b.Write(t.Segment.Value(src))
			if t.SoftLineBreak() || t.HardLineBreak() {
				b.WriteByte(' ')
			}
		case *ast.String:
			b.Write(t.Value)
		case *MathInline:
			b.Write(t.TeX)
		case *ast.RawHTML:
			return ast.WalkSkipChildren, nil
		}
		return ast.WalkContinue, nil
	})
	return strings.TrimSpace(b.String())
}

// ThemeCSS holds the syntax-highlighting stylesheets for both themes.
// The frontend switches between them with the <style media> attribute.
type ThemeCSS struct {
	Light string `json:"light"`
	Dark  string `json:"dark"`
}

// HighlightCSS returns the CSS for syntax-highlighted code blocks
// (chroma's "github" and "github-dark" styles).
// The <pre> background comes from github-markdown-css: `.markdown-body pre`
// is more specific than chroma's `.chroma`, so no override is needed.
func HighlightCSS() ThemeCSS {
	f := chromahtml.New(chromahtml.WithClasses(true))
	css := func(style string) string {
		var b strings.Builder
		_ = f.WriteCSS(&b, styles.Get(style))
		return b.String()
	}
	return ThemeCSS{Light: css("github"), Dark: css("github-dark")}
}
