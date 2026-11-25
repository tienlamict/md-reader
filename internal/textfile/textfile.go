// Package textfile converts between file bytes and editor text while keeping
// the file's format: the editor always works with "\n" and no BOM, and saving
// restores the original line endings, byte-order mark and encoding.
package textfile

import (
	"bytes"
	"errors"
	"slices"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Encodings that round-trip exactly.
const (
	UTF8    = "utf-8"
	UTF8BOM = "utf-8-bom"
	UTF16LE = "utf-16le"
	UTF16BE = "utf-16be"
)

// Line endings.
const (
	LF   = "\n"
	CRLF = "\r\n"
)

// Format describes how a file is stored on disk.
type Format struct {
	Encoding   string `json:"encoding"`
	LineEnding string `json:"lineEnding"`
}

// DefaultFormat is used for new files: UTF-8 without BOM and Windows line endings.
var DefaultFormat = Format{Encoding: UTF8, LineEnding: CRLF}

// ErrNotUTF8 means the file uses a legacy encoding that cannot be edited safely.
var ErrNotUTF8 = errors.New("file không ở dạng UTF-8 hoặc UTF-16 nên chưa sửa được (lưu lại sẽ làm hỏng chữ)")

var (
	bomUTF8    = []byte{0xEF, 0xBB, 0xBF}
	bomUTF16LE = []byte{0xFF, 0xFE}
	bomUTF16BE = []byte{0xFE, 0xFF}
)

// Decode returns the text with "\n" line endings and the file's format.
func Decode(data []byte) (string, Format, error) {
	var s string
	var f Format
	switch {
	case bytes.HasPrefix(data, bomUTF8):
		f.Encoding, s = UTF8BOM, string(data[3:])
	case bytes.HasPrefix(data, bomUTF16LE):
		f.Encoding, s = UTF16LE, decodeUTF16(data[2:], false)
	case bytes.HasPrefix(data, bomUTF16BE):
		f.Encoding, s = UTF16BE, decodeUTF16(data[2:], true)
	default:
		f.Encoding, s = UTF8, string(data)
	}
	if !utf8.ValidString(s) {
		return "", Format{}, ErrNotUTF8
	}

	crlf := strings.Count(s, "\r\n")
	lf := strings.Count(s, "\n") - crlf
	f.LineEnding = LF
	if crlf > lf {
		f.LineEnding = CRLF
	}
	if crlf == 0 && lf == 0 {
		f.LineEnding = DefaultFormat.LineEnding
	}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return s, f, nil
}

// Encode turns editor text back into file bytes in the given format.
// Mixed line endings in the original file are normalized to f.LineEnding.
func Encode(text string, f Format) []byte {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	if f.LineEnding == CRLF {
		text = strings.ReplaceAll(text, "\n", "\r\n")
	}
	switch f.Encoding {
	case UTF8BOM:
		return slices.Concat(bomUTF8, []byte(text))
	case UTF16LE:
		return slices.Concat(bomUTF16LE, encodeUTF16(text, false))
	case UTF16BE:
		return slices.Concat(bomUTF16BE, encodeUTF16(text, true))
	default:
		return []byte(text)
	}
}

// DecodeLossy is for viewing only: it never fails, replacing invalid bytes.
func DecodeLossy(data []byte) string {
	s, _, err := Decode(data)
	if err == nil {
		return s
	}
	return strings.ToValidUTF8(strings.ReplaceAll(string(data), "\r\n", "\n"), "�")
}

func decodeUTF16(b []byte, bigEndian bool) string {
	u := make([]uint16, len(b)/2)
	for i := range u {
		if bigEndian {
			u[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
		} else {
			u[i] = uint16(b[2*i+1])<<8 | uint16(b[2*i])
		}
	}
	return string(utf16.Decode(u))
}

func encodeUTF16(s string, bigEndian bool) []byte {
	u := utf16.Encode([]rune(s))
	b := make([]byte, 2*len(u))
	for i, v := range u {
		if bigEndian {
			b[2*i], b[2*i+1] = byte(v>>8), byte(v)
		} else {
			b[2*i], b[2*i+1] = byte(v), byte(v>>8)
		}
	}
	return b
}
