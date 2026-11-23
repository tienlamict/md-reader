package config

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestLoadSave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "config.json")

	if got := Load(path); !reflect.DeepEqual(got, Default()) {
		t.Errorf("missing file: got %+v, want defaults", got)
	}

	want := Default()
	want.Theme = ThemeDark
	want.Recent = []string{`C:\a.md`}
	want.Session = Session{Tabs: []string{`C:\a.md`, `C:\b.md`}, Active: `C:\b.md`, Folder: `C:\`, ShowTOC: true, Zoom: 1.25}
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	if got := Load(path); !reflect.DeepEqual(got, want) {
		t.Errorf("after save:\n got  %+v\n want %+v", got, want)
	}

	if err := os.WriteFile(path, []byte(`{"theme":"purple","session":{"zoom":9}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	got := Load(path)
	if got.Theme != ThemeSystem || got.Session.Zoom != MaxZoom {
		t.Errorf("invalid values not fixed: %+v", got)
	}

	if err := os.WriteFile(path, []byte(`not json`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Load(path); !reflect.DeepEqual(got, Default()) {
		t.Errorf("broken file: got %+v", got)
	}
}

func TestAddRecent(t *testing.T) {
	list := AddRecent(nil, `C:\a.md`)
	list = AddRecent(list, `C:\b.md`)
	list = AddRecent(list, `c:\A.MD`) // same file, different case
	if want := []string{`c:\A.MD`, `C:\b.md`}; !reflect.DeepEqual(list, want) {
		t.Errorf("got %v, want %v", list, want)
	}

	for i := range 20 {
		list = AddRecent(list, fmt.Sprintf(`C:\%d.md`, i))
	}
	if len(list) != MaxRecent || list[0] != `C:\19.md` {
		t.Errorf("trim failed: %v", list)
	}
}
