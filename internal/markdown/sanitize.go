package markdown

import (
	"regexp"

	"github.com/microcosm-cc/bluemonday"
)

// policy is GitHub-like: user HTML is allowed but scripts, event handlers,
// styles and javascript: URLs are stripped. bluemonday policies are safe for
// concurrent use once built.
var policy = newPolicy()

func newPolicy() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()

	// Classes produced by the renderer (chroma, alerts, task lists, footnotes,
	// language-xxx on code blocks).
	p.AllowAttrs("class").Globally()
	// Heading anchors may contain non-ASCII letters (e.g. Vietnamese).
	p.AllowAttrs("id").Matching(regexp.MustCompile(`^[\p{L}\p{N}\p{M}_:.\-]+$`)).Globally()
	p.AllowAttrs("role", "aria-hidden", "tabindex").Globally()
	// Source line numbers used to sync the editor with the preview.
	p.AllowAttrs("data-line").Matching(regexp.MustCompile(`^[0-9]+$`)).Globally()

	// Task list checkboxes.
	p.AllowElements("input")
	p.AllowAttrs("type").Matching(regexp.MustCompile(`^checkbox$`)).OnElements("input")
	p.AllowAttrs("checked", "disabled").OnElements("input")

	// Table alignment.
	p.AllowAttrs("align").Matching(regexp.MustCompile(`^(left|center|right)$`)).OnElements("th", "td", "p", "div", "img")

	// Collapsible sections and other HTML commonly used in READMEs.
	p.AllowElements("details", "summary", "kbd", "picture", "source")
	p.AllowAttrs("open").OnElements("details")
	p.AllowAttrs("srcset", "media", "type").OnElements("source")
	p.AllowAttrs("width", "height").OnElements("img")

	// Octicon SVGs in alert titles (no scripting attributes allowed).
	p.AllowElements("svg", "path")
	p.AllowAttrs("viewbox", "version", "width", "height").OnElements("svg")
	p.AllowAttrs("d", "fill-rule").OnElements("path")

	p.AllowDataURIImages()
	p.RequireNoFollowOnLinks(false)
	return p
}

func sanitize(html string) string {
	return policy.Sanitize(html)
}
