package textfile

import (
	"bytes"
	"errors"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		text string
		f    Format
	}{
		{"utf-8 lf", []byte("# Tiêu đề\nnội dung\n"), "# Tiêu đề\nnội dung\n", Format{UTF8, LF}},
		{"utf-8 crlf", []byte("a\r\nb\r\n"), "a\nb\n", Format{UTF8, CRLF}},
		{"utf-8 bom", append([]byte{0xEF, 0xBB, 0xBF}, "x\r\ny"...), "x\ny", Format{UTF8BOM, CRLF}},
		{"no newline at end", []byte("a\nb"), "a\nb", Format{UTF8, LF}},
		{"single line uses default", []byte("chỉ một dòng"), "chỉ một dòng", Format{UTF8, CRLF}},
		{"utf-16le", []byte{0xFF, 0xFE, 'a', 0, '\r', 0, '\n', 0, 0xEA, 0x00}, "a\nê", Format{UTF16LE, CRLF}},
		{"utf-16be", []byte{0xFE, 0xFF, 0, 'a', 0, '\n', 0x1E, 0xBF}, "a\nế", Format{UTF16BE, LF}},
		{"utf-16 surrogate pair", []byte{0xFF, 0xFE, 0x3D, 0xD8, 0x00, 0xDE}, "😀", Format{UTF16LE, CRLF}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			text, f, err := Decode(c.data)
			if err != nil {
				t.Fatal(err)
			}
			if text != c.text || f != c.f {
				t.Fatalf("Decode = %q %+v, want %q %+v", text, f, c.text, c.f)
			}
			if got := Encode(text, f); !bytes.Equal(got, c.data) {
				t.Errorf("Encode = %v, want %v", got, c.data)
			}
		})
	}
}

func TestMixedLineEndingsUseMajority(t *testing.T) {
	text, f, err := Decode([]byte("a\r\nb\r\nc\nd"))
	if err != nil {
		t.Fatal(err)
	}
	if f.LineEnding != CRLF || text != "a\nb\nc\nd" {
		t.Fatalf("got %q %+v", text, f)
	}
	if got := string(Encode(text, f)); got != "a\r\nb\r\nc\r\nd" {
		t.Errorf("Encode = %q", got)
	}
}

func TestEditedTextKeepsFormat(t *testing.T) {
	_, f, _ := Decode([]byte("a\r\nb\r\n"))
	if got := string(Encode("a\nb\nmới\n", f)); got != "a\r\nb\r\nmới\r\n" {
		t.Errorf("got %q", got)
	}
}

func TestNotUTF8(t *testing.T) {
	legacy := []byte{'T', 0xEA, 'n'} // "Tên" in Windows-1258
	if _, _, err := Decode(legacy); !errors.Is(err, ErrNotUTF8) {
		t.Fatalf("err = %v, want ErrNotUTF8", err)
	}
	if got := DecodeLossy(legacy); got != "T�n" {
		t.Errorf("DecodeLossy = %q", got)
	}
}
