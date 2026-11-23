// Package watcher reports when open documents change on disk.
//
// Editors often save by writing a temp file and renaming it over the
// original, so the watcher observes the parent folders (not the files) and
// debounces bursts of events into one notification per file.
package watcher

import (
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Watcher calls onChange(path) shortly after a watched file is modified,
// replaced or removed.
type Watcher struct {
	fs       *fsnotify.Watcher
	onChange func(path string)
	delay    time.Duration

	mu     sync.Mutex
	files  map[string]string // normalized path -> path as given
	dirs   map[string]bool   // normalized dir -> watched
	timers map[string]*time.Timer
	closed bool
}

// New starts a watcher. delay is the debounce interval.
func New(onChange func(path string), delay time.Duration) (*Watcher, error) {
	fs, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		fs:       fs,
		onChange: onChange,
		delay:    delay,
		files:    map[string]string{},
		dirs:     map[string]bool{},
		timers:   map[string]*time.Timer{},
	}
	go w.loop()
	return w, nil
}

func norm(p string) string {
	return strings.ToLower(filepath.Clean(p))
}

// SetFiles replaces the set of watched files.
func (w *Watcher) SetFiles(paths []string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}

	files := map[string]string{}
	dirs := map[string]bool{}
	for _, p := range paths {
		files[norm(p)] = p
		dirs[norm(filepath.Dir(p))] = true
	}

	var firstErr error
	for d := range w.dirs {
		if !dirs[d] {
			_ = w.fs.Remove(d)
		}
	}
	for d := range dirs {
		if !w.dirs[d] {
			if err := w.fs.Add(d); err != nil {
				delete(dirs, d) // folder vanished; nothing to watch
				if firstErr == nil {
					firstErr = err
				}
			}
		}
	}
	for key, t := range w.timers {
		if _, keep := files[key]; !keep {
			t.Stop()
			delete(w.timers, key)
		}
	}
	w.files, w.dirs = files, dirs
	return firstErr
}

// Close stops watching.
func (w *Watcher) Close() error {
	w.mu.Lock()
	w.closed = true
	for _, t := range w.timers {
		t.Stop()
	}
	w.mu.Unlock()
	return w.fs.Close()
}

func (w *Watcher) loop() {
	for {
		select {
		case ev, ok := <-w.fs.Events:
			if !ok {
				return
			}
			if ev.Op&(fsnotify.Write|fsnotify.Create|fsnotify.Rename|fsnotify.Remove) != 0 {
				w.schedule(ev.Name)
			}
		case _, ok := <-w.fs.Errors:
			if !ok {
				return
			}
		}
	}
}

func (w *Watcher) schedule(name string) {
	key := norm(name)
	w.mu.Lock()
	defer w.mu.Unlock()
	path, ok := w.files[key]
	if !ok || w.closed {
		return
	}
	if t, ok := w.timers[key]; ok {
		t.Reset(w.delay)
		return
	}
	w.timers[key] = time.AfterFunc(w.delay, func() {
		w.mu.Lock()
		delete(w.timers, key)
		_, stillWatched := w.files[key]
		w.mu.Unlock()
		if stillWatched {
			w.onChange(path)
		}
	})
}
