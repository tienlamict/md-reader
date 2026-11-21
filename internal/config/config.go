// Package config persists user preferences in %APPDATA%\md-reader\config.json.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Theme values.
const (
	ThemeSystem = "system"
	ThemeLight  = "light"
	ThemeDark   = "dark"
)

// Config holds the user's preferences.
type Config struct {
	Theme string `json:"theme"`
}

// Default returns the configuration used when nothing is saved yet.
func Default() Config {
	return Config{Theme: ThemeSystem}
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
// defaults, and unknown values are replaced by their defaults.
func Load(path string) Config {
	cfg := Default()
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Default()
	}
	if !ValidTheme(cfg.Theme) {
		cfg.Theme = ThemeSystem
	}
	return cfg
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
