// Package links resolves hrefs and image sources found in a Markdown document
// to what the viewer should do with them: scroll to an anchor, open a URL in
// the browser, open another Markdown file in the app, or point at a local file.
package links

import (
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Kind tells the frontend how to handle a link.
type Kind string

const (
	KindNone     Kind = ""         // nothing to do (blocked scheme, empty href…)
	KindAnchor   Kind = "anchor"   // #fragment inside the current document
	KindExternal Kind = "external" // http(s)/mailto, opened in the system browser
	KindMarkdown Kind = "markdown" // another Markdown file, opened in the app
	KindFile     Kind = "file"     // any other local file or folder
)

// Target is the resolved form of an href.
type Target struct {
	Kind     Kind   `json:"kind"`
	Path     string `json:"path,omitempty"`     // absolute local path (markdown/file)
	Fragment string `json:"fragment,omitempty"` // decoded #fragment, without '#'
	URL      string `json:"url,omitempty"`      // external URL
}

var markdownExt = map[string]bool{".md": true, ".markdown": true, ".mdown": true, ".mkd": true}

// IsMarkdown reports whether the path has a Markdown file extension.
func IsMarkdown(path string) bool {
	return markdownExt[strings.ToLower(filepath.Ext(path))]
}

var windowsAbs = regexp.MustCompile(`^[a-zA-Z]:[\\/]`)

// Resolve interprets href as written inside the Markdown file at docPath.
func Resolve(docPath, href string) Target {
	href = strings.TrimSpace(href)
	if href == "" {
		return Target{}
	}
	if strings.HasPrefix(href, "#") {
		return Target{Kind: KindAnchor, Fragment: unescape(href[1:])}
	}

	// "C:\docs\a.md" would otherwise parse as scheme "c".
	if windowsAbs.MatchString(href) {
		p, frag, _ := strings.Cut(href, "#")
		return local(filepath.Clean(p), unescape(frag))
	}

	u, err := url.Parse(href)
	if err != nil {
		return Target{}
	}
	switch strings.ToLower(u.Scheme) {
	case "":
		// relative or root-relative path, handled below
	case "http", "https", "mailto":
		return Target{Kind: KindExternal, URL: href}
	case "file":
		p := strings.TrimPrefix(u.Path, "/")
		if !windowsAbs.MatchString(p) {
			return Target{}
		}
		return local(filepath.Clean(filepath.FromSlash(p)), u.Fragment)
	default:
		// javascript:, data:, vbscript:, custom protocols… are never followed.
		return Target{}
	}

	if u.Host != "" { // protocol-relative "//example.com/x"
		return Target{Kind: KindExternal, URL: "https:" + href}
	}
	if u.Path == "" {
		if u.Fragment != "" {
			return Target{Kind: KindAnchor, Fragment: u.Fragment}
		}
		return Target{}
	}

	rel := filepath.FromSlash(u.Path)
	var abs string
	if strings.HasPrefix(u.Path, "/") {
		// Like GitHub: a leading "/" means the repository root.
		abs = filepath.Join(repoRoot(filepath.Dir(docPath)), rel)
	} else {
		abs = filepath.Join(filepath.Dir(docPath), rel)
	}
	return local(abs, u.Fragment)
}

func local(path, fragment string) Target {
	if fi, err := os.Stat(path); err == nil && fi.IsDir() {
		// A link to a folder shows its README, as GitHub does.
		for _, name := range []string{"README.md", "readme.md", "README.markdown"} {
			readme := filepath.Join(path, name)
			if st, err := os.Stat(readme); err == nil && !st.IsDir() {
				return Target{Kind: KindMarkdown, Path: readme, Fragment: fragment}
			}
		}
		return Target{Kind: KindFile, Path: path}
	}
	if IsMarkdown(path) {
		return Target{Kind: KindMarkdown, Path: path, Fragment: fragment}
	}
	return Target{Kind: KindFile, Path: path, Fragment: fragment}
}

// repoRoot walks up from dir to the nearest folder containing .git.
// It falls back to dir when the document is not inside a repository.
func repoRoot(dir string) string {
	for d := dir; ; {
		if _, err := os.Stat(filepath.Join(d, ".git")); err == nil {
			return d
		}
		parent := filepath.Dir(d)
		if parent == d {
			return dir
		}
		d = parent
	}
}

func unescape(s string) string {
	if v, err := url.PathUnescape(s); err == nil {
		return v
	}
	return s
}
