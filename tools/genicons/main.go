// Command genicons draws the application and file-type icons:
//
//	build/appicon.png          1024×1024 app icon (used by Wails)
//	build/windows/icon.ico     app icon, all Windows sizes
//	build/mdFile.png           1024×1024 file icon (required by Wails)
//	build/windows/mdFile.ico   icon for .md files in Explorer
//
// Shapes are drawn with signed distance functions, so every size is rendered
// directly (sharp at 16 px) with anti-aliased edges. Standard library only.
//
// Run from the repository root:  go run ./tools/genicons
package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"os"
	"path/filepath"
)

// All shapes use a 1024×1024 design canvas.
const canvas = 1024.0

type vec struct{ x, y float64 }

func (a vec) sub(b vec) vec       { return vec{a.x - b.x, a.y - b.y} }
func (a vec) dot(b vec) float64   { return a.x*b.x + a.y*b.y }
func (a vec) scale(s float64) vec { return vec{a.x * s, a.y * s} }
func (a vec) length() float64     { return math.Hypot(a.x, a.y) }

// shape returns a signed distance (negative inside) in canvas units.
type shape func(p vec) float64

func roundedRect(x0, y0, x1, y1, r float64) shape {
	cx, cy := (x0+x1)/2, (y0+y1)/2
	hx, hy := (x1-x0)/2-r, (y1-y0)/2-r
	return func(p vec) float64 {
		dx := math.Abs(p.x-cx) - hx
		dy := math.Abs(p.y-cy) - hy
		outside := math.Hypot(math.Max(dx, 0), math.Max(dy, 0))
		return outside + math.Min(math.Max(dx, dy), 0) - r
	}
}

func segmentDist(p, a, b vec) float64 {
	pa, ba := p.sub(a), b.sub(a)
	h := math.Max(0, math.Min(1, pa.dot(ba)/ba.dot(ba)))
	return pa.sub(ba.scale(h)).length()
}

// stroke is a polyline with round caps and joins.
func stroke(width float64, pts ...vec) shape {
	return func(p vec) float64 {
		d := math.Inf(1)
		for i := 0; i+1 < len(pts); i++ {
			d = math.Min(d, segmentDist(p, pts[i], pts[i+1]))
		}
		return d - width/2
	}
}

// polygon is a filled polygon, optionally with rounded corners (radius r).
func polygon(r float64, pts ...vec) shape {
	return func(p vec) float64 {
		d := math.Inf(1)
		inside := false
		for i, j := 0, len(pts)-1; i < len(pts); j, i = i, i+1 {
			a, b := pts[j], pts[i]
			d = math.Min(d, segmentDist(p, a, b))
			if (a.y > p.y) != (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x {
				inside = !inside
			}
		}
		if inside {
			d = -d
		}
		return d - r
	}
}

func union(shapes ...shape) shape {
	return func(p vec) float64 {
		d := math.Inf(1)
		for _, s := range shapes {
			d = math.Min(d, s(p))
		}
		return d
	}
}

// transform places a shape drawn on the canvas at offset (ox, oy) scaled by s.
func transform(sh shape, s, ox, oy float64) shape {
	return func(p vec) float64 {
		return sh(vec{(p.x - ox) / s, (p.y - oy) / s}) * s
	}
}

// layer is a shape painted with a colour (which may vary with position).
type layer struct {
	shape shape
	color func(p vec) color.NRGBA
	// outline > 0 paints only a band of this width centred on the edge.
	outline float64
}

func solid(c color.NRGBA) func(vec) color.NRGBA { return func(vec) color.NRGBA { return c } }

func verticalGradient(top, bottom color.NRGBA, y0, y1 float64) func(vec) color.NRGBA {
	return func(p vec) color.NRGBA {
		t := math.Max(0, math.Min(1, (p.y-y0)/(y1-y0)))
		mix := func(a, b uint8) uint8 { return uint8(math.Round(float64(a) + (float64(b)-float64(a))*t)) }
		return color.NRGBA{mix(top.R, bottom.R), mix(top.G, bottom.G), mix(top.B, bottom.B), 255}
	}
}

func render(size int, layers []layer) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	k := canvas / float64(size) // canvas units per pixel
	for y := range size {
		for x := range size {
			p := vec{(float64(x) + 0.5) * k, (float64(y) + 0.5) * k}
			var r, g, b, a float64 // premultiplied
			for _, l := range layers {
				d := l.shape(p)
				if l.outline > 0 {
					d = math.Abs(d) - l.outline/2
				}
				cov := math.Max(0, math.Min(1, 0.5-d/k)) // d in pixels → coverage
				if cov == 0 {
					continue
				}
				c := l.color(p)
				ca := cov * float64(c.A) / 255
				r = float64(c.R)/255*ca + r*(1-ca)
				g = float64(c.G)/255*ca + g*(1-ca)
				b = float64(c.B)/255*ca + b*(1-ca)
				a = ca + a*(1-ca)
			}
			if a > 0 {
				img.SetNRGBA(x, y, color.NRGBA{
					R: uint8(math.Round(r / a * 255)),
					G: uint8(math.Round(g / a * 255)),
					B: uint8(math.Round(b / a * 255)),
					A: uint8(math.Round(a * 255)),
				})
			}
		}
	}
	return img
}

// markdownMark is the "M↓" sign, centred on the canvas.
func markdownMark() shape {
	const w = 84 // stroke width
	m := stroke(w, vec{207, 690}, vec{207, 340}, vec{347, 510}, vec{487, 340}, vec{487, 690})
	stem := stroke(w, vec{697, 340}, vec{697, 600})
	head := polygon(14, vec{567, 548}, vec{827, 548}, vec{697, 700})
	return union(m, stem, head)
}

var (
	white    = color.NRGBA{255, 255, 255, 255}
	blue     = color.NRGBA{9, 105, 218, 255}
	blueTop  = color.NRGBA{56, 139, 253, 255}
	border   = color.NRGBA{140, 149, 159, 255}
	foldFill = color.NRGBA{208, 215, 222, 255}
)

func appIcon() []layer {
	return []layer{
		{shape: roundedRect(64, 64, 960, 960, 200), color: verticalGradient(blueTop, blue, 64, 960)},
		{shape: markdownMark(), color: solid(white)},
	}
}

func fileIcon() []layer {
	page := polygon(24, vec{200, 72}, vec{620, 72}, vec{824, 276}, vec{824, 952}, vec{200, 952})
	fold := polygon(16, vec{620, 72}, vec{620, 276}, vec{824, 276})
	return []layer{
		{shape: page, color: solid(white)},
		{shape: page, color: solid(border), outline: 36},
		{shape: fold, color: solid(foldFill)},
		{shape: fold, color: solid(border), outline: 36},
		{shape: transform(markdownMark(), 0.58, 215, 330), color: solid(blue)},
	}
}

func encodePNG(img image.Image) []byte {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		log.Fatal(err)
	}
	return buf.Bytes()
}

// writeICO stores PNG-compressed images (supported since Windows Vista).
func writeICO(path string, layers []layer, sizes []int) {
	var pngs [][]byte
	for _, s := range sizes {
		pngs = append(pngs, encodePNG(render(s, layers)))
	}
	var buf bytes.Buffer
	le := binary.LittleEndian
	_ = binary.Write(&buf, le, [3]uint16{0, 1, uint16(len(sizes))}) // reserved, type=icon, count
	offset := 6 + 16*len(sizes)
	for i, s := range sizes {
		dim := uint8(s)
		if s >= 256 {
			dim = 0 // 0 means 256
		}
		buf.Write([]byte{dim, dim, 0, 0})                // width, height, palette, reserved
		_ = binary.Write(&buf, le, [2]uint16{1, 32})     // planes, bits per pixel
		_ = binary.Write(&buf, le, uint32(len(pngs[i]))) // data size
		_ = binary.Write(&buf, le, uint32(offset))       // data offset
		offset += len(pngs[i])
	}
	for _, p := range pngs {
		buf.Write(p)
	}
	writeFile(path, buf.Bytes())
}

func writeFile(path string, data []byte) {
	if err := os.WriteFile(path, data, 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("wrote %s (%d bytes)", filepath.ToSlash(path), len(data))
}

func main() {
	sizes := []int{16, 20, 24, 32, 40, 48, 64, 96, 128, 256}
	writeFile(filepath.Join("build", "appicon.png"), encodePNG(render(1024, appIcon())))
	writeICO(filepath.Join("build", "windows", "icon.ico"), appIcon(), sizes)
	// Wails requires build/<iconName>.png for each file association even when
	// the .ico already exists (it only generates the .ico if missing).
	writeFile(filepath.Join("build", "mdFile.png"), encodePNG(render(1024, fileIcon())))
	writeICO(filepath.Join("build", "windows", "mdFile.ico"), fileIcon(), sizes)
}
