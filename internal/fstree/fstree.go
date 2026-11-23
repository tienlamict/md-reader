// Package fstree lists folders for the sidebar file tree.
package fstree

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"md-reader/internal/links"
)

// Entry is one row of the file tree.
type Entry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
}

// skipDirs are folders that never contain documentation worth browsing.
var skipDirs = map[string]bool{"node_modules": true, "vendor": true, "bin": true, "obj": true}

// List returns the sub-folders and Markdown files of dir, folders first,
// each group sorted by name. Hidden entries (".git", ".vscode"…) are skipped.
func List(dir string) ([]Entry, error) {
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	entries := []Entry{}
	for _, it := range items {
		name := it.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		isDir := it.IsDir()
		if isDir && skipDirs[strings.ToLower(name)] {
			continue
		}
		if !isDir && !links.IsMarkdown(name) {
			continue
		}
		entries = append(entries, Entry{Name: name, Path: filepath.Join(dir, name), IsDir: isDir})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}
