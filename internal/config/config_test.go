package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadSave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "config.json")

	if got := Load(path); got != Default() {
		t.Errorf("missing file: got %+v, want defaults", got)
	}

	if err := Save(path, Config{Theme: ThemeDark}); err != nil {
		t.Fatal(err)
	}
	if got := Load(path); got.Theme != ThemeDark {
		t.Errorf("after save: got %+v", got)
	}

	if err := os.WriteFile(path, []byte(`{"theme":"purple"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Load(path); got.Theme != ThemeSystem {
		t.Errorf("invalid theme: got %+v", got)
	}

	if err := os.WriteFile(path, []byte(`not json`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Load(path); got != Default() {
		t.Errorf("broken file: got %+v", got)
	}
}
