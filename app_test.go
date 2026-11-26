package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestParseArgs(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "a.md")
	if err := os.WriteFile(doc, []byte("# a"), 0o644); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(dir, "docs")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}

	got := parseArgs([]string{"a.md", "--flag", "missing.md", "docs", doc}, dir)
	want := StartupArgs{Files: []string{doc, doc}, Folder: sub}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}

	if got := parseArgs(nil, dir); got.Files == nil || len(got.Files) != 0 || got.Folder != "" {
		t.Errorf("empty args: got %+v", got)
	}
}
