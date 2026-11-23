package fstree

import (
	"os"
	"path/filepath"
	"testing"
)

func TestList(t *testing.T) {
	dir := t.TempDir()
	for _, f := range []string{"b.md", "A.markdown", "notes.txt", ".hidden.md", "zeta/x.md", "Alpha/y.md", ".git/HEAD", "node_modules/p/README.md"} {
		p := filepath.Join(dir, filepath.FromSlash(f))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	got, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	want := []Entry{
		{"Alpha", filepath.Join(dir, "Alpha"), true},
		{"zeta", filepath.Join(dir, "zeta"), true},
		{"A.markdown", filepath.Join(dir, "A.markdown"), false},
		{"b.md", filepath.Join(dir, "b.md"), false},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("entry %d = %+v, want %+v", i, got[i], want[i])
		}
	}

	if _, err := List(filepath.Join(dir, "missing")); err == nil {
		t.Error("expected error for missing dir")
	}
}
