package markdown

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/yuin/goldmark/ast"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
)

// headingIDTransformer assigns GitHub-style anchor IDs to headings
// ("Hello World!" -> "hello-world", duplicates -> "x", "x-1", "x-2").
// Unlike goldmark's built-in generator it keeps non-ASCII letters,
// so Vietnamese headings get readable anchors like GitHub does.
type headingIDTransformer struct{}

func (t *headingIDTransformer) Transform(doc *ast.Document, reader text.Reader, _ parser.Context) {
	src := reader.Source()
	seen := map[string]int{}
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		h, ok := n.(*ast.Heading)
		if !ok || !entering {
			return ast.WalkContinue, nil
		}
		if id := uniqueSlug(slugify(plainText(h, src)), seen); id != "" {
			h.SetAttributeString("id", []byte(id))
		}
		return ast.WalkSkipChildren, nil
	})
}

// slugify mirrors github-slugger: lowercase, drop punctuation/symbols,
// turn each space into "-".
func slugify(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r == ' ':
			b.WriteByte('-')
		case r == '-' || r == '_' || unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsMark(r):
			b.WriteRune(r)
		}
	}
	return b.String()
}

func uniqueSlug(base string, seen map[string]int) string {
	if base == "" {
		return ""
	}
	slug := base
	if _, dup := seen[slug]; dup {
		for {
			seen[base]++
			slug = base + "-" + strconv.Itoa(seen[base])
			if _, taken := seen[slug]; !taken {
				break
			}
		}
	}
	seen[slug] = 0
	return slug
}

// taskListTransformer adds the classes GitHub (and github-markdown-css)
// use for task lists: ul.contains-task-list > li.task-list-item.
type taskListTransformer struct{}

func (t *taskListTransformer) Transform(doc *ast.Document, _ text.Reader, _ parser.Context) {
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if _, ok := n.(*east.TaskCheckBox); !ok || !entering {
			return ast.WalkContinue, nil
		}
		// TaskCheckBox -> Paragraph/TextBlock -> ListItem -> List
		item := n.Parent().Parent()
		if li, ok := item.(*ast.ListItem); ok {
			li.SetAttributeString("class", []byte("task-list-item"))
			if list, ok := li.Parent().(*ast.List); ok {
				list.SetAttributeString("class", []byte("contains-task-list"))
			}
		}
		return ast.WalkContinue, nil
	})
}
