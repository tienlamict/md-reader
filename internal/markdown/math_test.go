package markdown

import (
	"strings"
	"testing"
)

func TestMath(t *testing.T) {
	cases := []struct {
		name, src string
		want      []string // substrings that must appear
		notWant   []string
	}{
		{"inline", "Năng lượng $E = mc^2$ nhé.",
			[]string{`<span class="math math-inline">E = mc^2</span>`}, nil},
		{"underscores are not emphasis", "$a_1 * b_2 * c_3$",
			[]string{`<span class="math math-inline">a_1 * b_2 * c_3</span>`}, []string{"<em>"}},
		{"backtick form", "$`x < y`$",
			[]string{`<span class="math math-inline">x &lt; y</span>`}, nil},
		{"money stays text", "Giá $5 và $10.",
			[]string{"Giá $5 và $10."}, []string{"math"}},
		{"space after opening dollar", "a $ b$ c",
			[]string{"a $ b$ c"}, []string{"math"}},
		{"escaped dollar", `\$x$`,
			[]string{"$x$"}, []string{"math"}},
		{"inline display", "xem $$\\sum_i x_i$$ đó",
			[]string{`<span class="math math-display">\sum_i x_i</span>`}, nil},
		{"lone double dollar", "a $$ b",
			[]string{"a $$ b"}, []string{"math"}},
		{"display block", "$$\n\\frac{a}{b}\n= c_1\n$$\n\nsau",
			[]string{"<div class=\"math math-display\">\\frac{a}{b}\n= c_1</div>", "<p>sau</p>"}, nil},
		{"one-line block", "$$x^2$$\n",
			[]string{`<div class="math math-display">x^2</div>`}, nil},
		{"block interrupts paragraph", "trước\n$$\ny\n$$",
			[]string{"<p>trước</p>", `<div class="math math-display">y</div>`}, nil},
		{"math code block", "```math\n\\alpha < \\beta\n```",
			[]string{`<div class="math math-display">\alpha &lt; \beta</div>`}, []string{"chroma"}},
		{"html in formula is escaped", "$<script>$",
			[]string{"&lt;script&gt;"}, []string{"<script"}},
		{"double backslash kept in block", "$$\na \\\\ b\n$$",
			[]string{`<div class="math math-display">a \\ b</div>`}, nil},
		{"double backslash kept in math fence", "```math\na \\\\ b\n```",
			[]string{`<div class="math math-display">a \\ b</div>`}, nil},
		{"code span wins", "`$x$`",
			[]string{"<code>$x$</code>"}, []string{"math"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			html := render(t, c.src).HTML
			for _, w := range c.want {
				if !strings.Contains(html, w) {
					t.Errorf("want %q in:\n%s", w, html)
				}
			}
			for _, w := range c.notWant {
				if strings.Contains(html, w) {
					t.Errorf("did not want %q in:\n%s", w, html)
				}
			}
		})
	}
}

func TestMathInHeading(t *testing.T) {
	h := render(t, "## Công thức $x^2$\n").Headings
	if len(h) != 1 || h[0].Text != "Công thức x^2" || h[0].ID != "công-thức-x2" {
		t.Errorf("got %+v", h)
	}
}

func TestMermaid(t *testing.T) {
	html := render(t, "```mermaid\ngraph TD\n  A-->B\n```\n").HTML
	want := "<div class=\"mermaid-block\"><pre class=\"mermaid-source\">graph TD\n  A--&gt;B</pre></div>"
	if !strings.Contains(html, want) {
		t.Errorf("want %q in:\n%s", want, html)
	}
	if strings.Contains(html, "chroma") {
		t.Errorf("mermaid source was highlighted:\n%s", html)
	}
}
