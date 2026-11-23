// Package config persists user preferences and the last session in
// %APPDATA%\md-reader\config.json.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Theme values.
const (
	ThemeSystem = "system"
	ThemeLight  = "light"
	ThemeDark   = "dark"
)

// MaxRecent is how many recently opened files are remembered.
const MaxRecent = 10

// Zoom limits for the document view.
const (
	MinZoom = 0.5
	MaxZoom = 3.0
)

// Session is the window state restored on the next start.
type Session struct {
	Tabs        []string `json:"tabs"`
	Active      string   `json:"active"`
	Folder      string   `json:"folder"`
	ShowSidebar bool     `json:"showSidebar"`
	ShowTOC     bool     `json:"showToc"`
	Zoom        float64  `json:"zoom"`
}

// Config holds the user's preferences.
type Config struct {
	Theme   string   `json:"theme"`
	Recent  []string `json:"recent"`
	Session Session  `json:"session"`
}

// Default returns the configuration used when nothing is saved yet.
func Default() Config {
	return Config{
		Theme:   ThemeSystem,
		Recent:  []string{},
		Session: Session{Tabs: []string{}, ShowSidebar: true, ShowTOC: true, Zoom: 1},
	}
}

// ValidTheme reports whether t is a known theme value.
func ValidTheme(t string) bool {
	return t == ThemeSystem || t == ThemeLight || t == ThemeDark
}

// DefaultPath is the config file location for the current user.
func DefaultPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "md-reader", "config.json"), nil
}

// Load reads the config at path. A missing or unreadable file yields the
// defaults, and invalid values are replaced by their defaults.
func Load(path string) Config {
	data, err := os.ReadFile(path)
	if err != nil {
		return Default()
	}
	cfg := Default()
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Default()
	}
	cfg.normalize()
	return cfg
}

func (c *Config) normalize() {
	if !ValidTheme(c.Theme) {
		c.Theme = ThemeSystem
	}
	if c.Recent == nil {
		c.Recent = []string{}
	}
	if len(c.Recent) > MaxRecent {
		c.Recent = c.Recent[:MaxRecent]
	}
	if c.Session.Tabs == nil {
		c.Session.Tabs = []string{}
	}
	c.Session.Zoom = ClampZoom(c.Session.Zoom)
}

// ClampZoom keeps a zoom factor within limits; 0 or garbage becomes 1.
func ClampZoom(z float64) float64 {
	switch {
	case z != z || z == 0: // NaN or unset
		return 1
	case z < MinZoom:
		return MinZoom
	case z > MaxZoom:
		return MaxZoom
	}
	return z
}

// Save writes the config atomically (temp file + rename).
func Save(path string, cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// AddRecent moves path to the front of list (Windows paths compare
// case-insensitively) and trims the list to MaxRecent entries.
func AddRecent(list []string, path string) []string {
	out := []string{path}
	for _, p := range list {
		if !strings.EqualFold(p, path) && len(out) < MaxRecent {
			out = append(out, p)
		}
	}
	return out
}
