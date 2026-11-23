package watcher

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

const delay = 50 * time.Millisecond

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func expect(t *testing.T, ch <-chan string, want string) {
	t.Helper()
	select {
	case got := <-ch:
		if got != want {
			t.Fatalf("change for %q, want %q", got, want)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("no change reported for %q", want)
	}
}

func expectNone(t *testing.T, ch <-chan string) {
	t.Helper()
	select {
	case got := <-ch:
		t.Fatalf("unexpected change for %q", got)
	case <-time.After(10 * delay):
	}
}

func TestWatcher(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "doc.md")
	other := filepath.Join(dir, "other.md")
	write(t, doc, "v1")
	write(t, other, "x")

	ch := make(chan string, 10)
	w, err := New(func(p string) { ch <- p }, delay)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if err := w.SetFiles([]string{doc}); err != nil {
		t.Fatal(err)
	}

	t.Run("write is reported once", func(t *testing.T) {
		write(t, doc, "v2")
		write(t, doc, "v3")
		expect(t, ch, doc)
		expectNone(t, ch)
	})

	t.Run("unwatched file in same folder is ignored", func(t *testing.T) {
		write(t, other, "y")
		expectNone(t, ch)
	})

	t.Run("atomic save via rename", func(t *testing.T) {
		tmp := filepath.Join(dir, "doc.md.tmp")
		write(t, tmp, "v4")
		if err := os.Rename(tmp, doc); err != nil {
			t.Fatal(err)
		}
		expect(t, ch, doc)
	})

	t.Run("no events after unwatching", func(t *testing.T) {
		if err := w.SetFiles(nil); err != nil {
			t.Fatal(err)
		}
		write(t, doc, "v5")
		expectNone(t, ch)
	})
}
