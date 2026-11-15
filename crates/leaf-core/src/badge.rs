//! The volume number stamped onto a cover, for the reader's library grid.
//!
//! Plenty of manga covers say which volume they are only in small print, or not
//! in Latin script at all; on a Kindle's shelf, at thumbnail size and in grey,
//! a run of one series is a wall of near-identical art. A large number in a
//! corner is what tells them apart.
//!
//! It is drawn as a shout balloon — a spiky burst with a heavy outline and a
//! screentone shadow — lettered in brush strokes, so it reads as part of the
//! medium rather than as a sticker from a file manager. Everything is black,
//! white and a dot pattern, which is also what survives an e-ink screen intact.
//!
//! The digits are drawn here rather than with a font crate: ten glyphs is all
//! that is ever needed, and it keeps a font file and its licence out of the
//! build. Each digit is a few strokes whose width follows a brush — a blob
//! where it lands, a swell through the middle, a taper as it lifts — rendered
//! from distance to the pixel, which antialiases for free at any cover size.
//!
//! Deliberately not here: deciding *whether* to badge, or which image is the
//! cover. That belongs to the writer, which knows what the reader will use.

use image::{Rgb, RgbImage};

/// Height of the digits, as a fraction of the cover's width. Width rather than
/// height because covers vary more in aspect than in how wide they look on a
/// shelf.
const DIGIT_HEIGHT: f32 = 0.13;
/// Gap between the burst's spikes and the cover's edges, as a fraction of width.
const MARGIN: f32 = 0.02;
/// The burst's tilt. A balloon set dead level looks typeset; a few degrees off
/// looks drawn.
const TILT_DEGREES: f32 = -7.0;

/// Number of spikes around the burst.
const SPIKES: usize = 16;
/// Spike lengths, cycled around the burst. Irregular on purpose: evenly sized
/// spikes look like a gear or a price sticker, not a shout.
const SPIKE_REACH: [f32; 7] = [1.22, 1.08, 1.3, 1.12, 1.18, 1.04, 1.26];
/// How far the valleys between spikes sit from the centre, relative to the
/// ellipse that holds the lettering.
const VALLEY: f32 = 0.97;

/// Outline thickness, as a fraction of the digit height.
const OUTLINE: f32 = 0.07;
/// Screentone shadow: offset from the burst and dot pitch, both as fractions of
/// the digit height.
const SHADOW_OFFSET: (f32, f32) = (0.13, 0.16);
const TONE_PITCH: f32 = 0.085;

/// Brush width at its fullest, in glyph units; a glyph is 1.6 units tall.
const BRUSH: f32 = 0.5;
const GLYPH_HEIGHT: f32 = 1.6;
/// Forward lean of the lettering: x shift per unit of height.
const SLANT: f32 = 0.16;
/// Space between digits, measured between their inked edges, in glyph units.
const LETTER_GAP: f32 = 0.12;
/// Small per-digit rotations, cycled, in degrees. Hand lettering never sits
/// perfectly on a line, and a run of identical angles is what gives a font
/// away.
const WOBBLE: [f32; 5] = [-3.0, 2.5, -1.5, 3.5, -2.5];

type Point = (f32, f32);
type Stroke = Vec<Point>;

/// One straight piece of a brush stroke, with how far along the whole stroke
/// (0 to 1) each end lies, so the width can follow the brush.
struct Piece {
    a: Point,
    b: Point,
    from: f32,
    to: f32,
}

/// Draw `number` in a shout balloon in the cover's top-right corner.
///
/// Top-right because a Kindle's library grid puts its own markers along the
/// bottom of a cover (progress, "new"), and series logos sit top-centre or
/// top-left far more often than in that corner.
pub fn stamp(image: &mut RgbImage, number: u32) {
    let (width, height) = image.dimensions();
    if width < 64 || height < 64 {
        return;
    }
    let w = width as f32;

    // Lettering, laid out around the origin in pixels before tilting.
    let digit_h = w * DIGIT_HEIGHT;
    let digits: Vec<Vec<Stroke>> = number.to_string().bytes().map(|b| digit(b - b'0')).collect();
    let (pieces, brush, text_w) = set_line(&digits, digit_h);

    // The ellipse that holds the lettering. Text is a rectangle and the
    // ellipse only has to clear its corners at the valley line, so this is
    // somewhat less than the rectangle's circumscribed ellipse.
    let half_w = text_w / 2.0 + digit_h * 0.18;
    let half_h = digit_h / 2.0 + digit_h * 0.12;
    let rx = half_w * 1.28 / VALLEY;
    let ry = half_h * 1.28 / VALLEY;
    let burst = burst(rx, ry);

    let reach = SPIKE_REACH.iter().cloned().fold(0.0, f32::max);
    let outline = digit_h * OUTLINE;
    let shadow = (digit_h * SHADOW_OFFSET.0, digit_h * SHADOW_OFFSET.1);
    let pitch = (digit_h * TONE_PITCH).max(2.0);

    // Placed so the longest spike and the shadow stay on the cover whatever the
    // tilt; the bounding circle is a cheap, safe stand-in for the rotated shape.
    let extent_x = rx * reach + shadow.0.abs();
    let extent_y = ry * reach + shadow.1.abs();
    let radius = extent_x.max(extent_y);
    let margin = w * MARGIN;
    let cx = w - margin - extent_x;
    let cy = margin + extent_y;

    let (sin, cos) = TILT_DEGREES.to_radians().sin_cos();
    let x0 = (cx - radius).floor().max(0.0) as u32;
    let x1 = (cx + radius).ceil().min(w) as u32;
    let y0 = (cy - radius).floor().max(0.0) as u32;
    let y1 = (cy + radius).ceil().min(height as f32) as u32;

    for y in y0..y1 {
        for x in x0..x1 {
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            // Into the balloon's own frame: undo the tilt.
            let (dx, dy) = (px - cx, py - cy);
            let local = (dx * cos + dy * sin, -dx * sin + dy * cos);

            let d_burst = polygon_distance(local, &burst);
            let d_shadow = polygon_distance((local.0 - shadow.0, local.1 - shadow.1), &burst);
            let in_shadow = coverage(d_shadow);
            let in_burst = coverage(d_burst);
            if in_shadow <= 0.0 && in_burst <= 0.0 {
                continue;
            }

            let tone = screentone((px, py), pitch);
            let paper = coverage(d_burst + outline);
            let ink = if paper > 0.0 {
                coverage(brush_distance(local, &pieces, brush)) * paper
            } else {
                0.0
            };

            let pixel = image.get_pixel_mut(x, y);
            *pixel = Rgb(pixel.0.map(|v| {
                // Shadow: white paper with a dot tone printed on it.
                let v = mix(v as f32, 255.0, in_shadow);
                let v = mix(v, 0.0, in_shadow * tone);
                // Balloon: black outline, white inside, black lettering.
                let v = mix(v, 0.0, in_burst);
                let v = mix(v, 255.0, paper);
                mix(v, 0.0, ink).round().clamp(0.0, 255.0) as u8
            }));
        }
    }
}

/// Lay a line of digits out at `height` pixels tall, centred on the origin.
/// Returns the brush pieces, the brush's full half-width and the inked width,
/// all in pixels.
fn set_line(glyphs: &[Vec<Stroke>], height: f32) -> (Vec<Piece>, f32, f32) {
    let scale = height / (GLYPH_HEIGHT + BRUSH);
    let half = BRUSH / 2.0;

    // Lean and wobble each digit first, so the spacing below is measured on
    // the shapes as they will actually be drawn.
    let shaped: Vec<Vec<Stroke>> = glyphs
        .iter()
        .enumerate()
        .map(|(i, strokes)| {
            let (sin, cos) = WOBBLE[i % WOBBLE.len()].to_radians().sin_cos();
            let centre = (0.5, GLYPH_HEIGHT / 2.0);
            strokes
                .iter()
                .map(|s| {
                    s.iter()
                        .map(|&(x, y)| {
                            let (dx, dy) = (x - centre.0, y - centre.1);
                            let (x, y) =
                                (centre.0 + dx * cos - dy * sin, centre.1 + dx * sin + dy * cos);
                            (x + (GLYPH_HEIGHT - y) * SLANT, y)
                        })
                        .collect()
                })
                .collect()
        })
        .collect();

    // By inked bounds, so a "1" takes the room a "1" needs and not an "8"'s.
    let mut placed: Vec<Stroke> = Vec::new();
    let mut cursor = 0.0f32;
    for strokes in &shaped {
        let (min_x, max_x) = x_bounds(strokes);
        let shift = cursor - min_x + half;
        placed.extend(strokes.iter().map(|s| s.iter().map(|&(x, y)| (x + shift, y)).collect()));
        cursor += (max_x - min_x) + BRUSH + LETTER_GAP;
    }
    let ink_w = cursor - LETTER_GAP;

    let origin = (-ink_w * scale / 2.0, -(GLYPH_HEIGHT * scale) / 2.0);
    let mut pieces = Vec::new();
    for stroke in &placed {
        let pts: Vec<Point> = stroke
            .iter()
            .map(|&(x, y)| (origin.0 + x * scale, origin.1 + y * scale))
            .collect();
        let lengths: Vec<f32> = pts.windows(2).map(|w| distance(w[0], w[1])).collect();
        let total: f32 = lengths.iter().sum::<f32>().max(f32::EPSILON);
        let mut run = 0.0;
        for (w, len) in pts.windows(2).zip(&lengths) {
            pieces.push(Piece { a: w[0], b: w[1], from: run / total, to: (run + len) / total });
            run += len;
        }
    }
    (pieces, half * scale, ink_w * scale)
}

/// Width of the brush, as a fraction of its fullest, `s` of the way along a
/// stroke: a blob where it lands, a pinch just after, a swell through the
/// middle and a taper as it lifts off the paper.
fn brush_profile(s: f32) -> f32 {
    // Clamped because sin(π) comes out a hair below zero in f32, and a
    // fractional power of a negative number is NaN.
    let body = 0.5 + 0.5 * (std::f32::consts::PI * s).sin().max(0.0).powf(0.7);
    let landing = 0.38 * (-(s / 0.07).powi(2)).exp();
    let lift = 1.0 - 0.3 * ((s - 0.82) / 0.18).clamp(0.0, 1.0);
    (body + landing) * lift
}

/// Signed distance to the brush strokes: negative inside the ink.
fn brush_distance(p: Point, pieces: &[Piece], brush: f32) -> f32 {
    pieces
        .iter()
        .map(|piece| {
            let (d, t) = segment_projection(p, piece.a, piece.b);
            d - brush * brush_profile(piece.from + (piece.to - piece.from) * t)
        })
        .fold(f32::INFINITY, f32::min)
}

/// The balloon's outline: spikes alternating with valleys around an ellipse.
fn burst(rx: f32, ry: f32) -> Vec<Point> {
    (0..SPIKES * 2)
        .map(|i| {
            // Offset from 3 o'clock so a spike, not a valley, points into the
            // cover's corner.
            let angle = (i as f32 / (SPIKES * 2) as f32) * std::f32::consts::TAU - 0.6;
            let r = if i % 2 == 0 { SPIKE_REACH[(i / 2) % SPIKE_REACH.len()] } else { VALLEY };
            (rx * r * angle.cos(), ry * r * angle.sin())
        })
        .collect()
}

/// Ink coverage of a 45° dot screen at `p`, the classic screentone angle.
fn screentone(p: Point, pitch: f32) -> f32 {
    let (u, v) = ((p.0 + p.1) / std::f32::consts::SQRT_2, (p.1 - p.0) / std::f32::consts::SQRT_2);
    let (fu, fv) = (u / pitch - (u / pitch).round(), v / pitch - (v / pitch).round());
    let d = (fu * fu + fv * fv).sqrt() * pitch;
    coverage(d - pitch * 0.3)
}

/// How much of a pixel lies inside a shape, from its signed distance.
fn coverage(signed_distance: f32) -> f32 {
    (0.5 - signed_distance).clamp(0.0, 1.0)
}

fn mix(from: f32, to: f32, amount: f32) -> f32 {
    from + (to - from) * amount
}

/// Signed distance to a closed polygon: negative inside.
fn polygon_distance(p: Point, vertices: &[Point]) -> f32 {
    let mut nearest = f32::INFINITY;
    let mut inside = false;
    let mut j = vertices.len() - 1;
    for i in 0..vertices.len() {
        let (a, b) = (vertices[i], vertices[j]);
        nearest = nearest.min(segment_projection(p, a, b).0);
        if (a.1 > p.1) != (b.1 > p.1) && p.0 < (b.0 - a.0) * (p.1 - a.1) / (b.1 - a.1) + a.0 {
            inside = !inside;
        }
        j = i;
    }
    if inside {
        -nearest
    } else {
        nearest
    }
}

/// Distance from `p` to the segment `a`–`b`, and how far along it (0 to 1) the
/// nearest point lies.
fn segment_projection(p: Point, a: Point, b: Point) -> (f32, f32) {
    let (abx, aby) = (b.0 - a.0, b.1 - a.1);
    let (apx, apy) = (p.0 - a.0, p.1 - a.1);
    let len2 = abx * abx + aby * aby;
    let t = if len2 == 0.0 { 0.0 } else { ((apx * abx + apy * aby) / len2).clamp(0.0, 1.0) };
    (distance(p, (a.0 + abx * t, a.1 + aby * t)), t)
}

fn distance(a: Point, b: Point) -> f32 {
    ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt()
}

fn x_bounds(strokes: &[Stroke]) -> (f32, f32) {
    strokes
        .iter()
        .flatten()
        .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), &(x, _)| (lo.min(x), hi.max(x)))
}

/// An elliptical arc as a polyline. Angles in degrees, y pointing down, so 90°
/// is the bottom of the ellipse and 270° the top.
fn arc(cx: f32, cy: f32, rx: f32, ry: f32, from: f32, to: f32) -> Stroke {
    let steps = (((to - from).abs() / 8.0).ceil() as usize).max(2);
    (0..=steps)
        .map(|i| {
            let a = (from + (to - from) * i as f32 / steps as f32).to_radians();
            (cx + rx * a.cos(), cy + ry * a.sin())
        })
        .collect()
}

/// A gentle curve from `a` to `b`, bowed sideways by `bow`. Brush lettering has
/// almost no truly straight strokes.
fn bowed(a: Point, b: Point, bow: f32) -> Stroke {
    let (nx, ny) = (-(b.1 - a.1), b.0 - a.0);
    let len = (nx * nx + ny * ny).sqrt().max(f32::EPSILON);
    (0..=8)
        .map(|i| {
            let t = i as f32 / 8.0;
            let lift = bow * 4.0 * t * (1.0 - t);
            (a.0 + (b.0 - a.0) * t + nx / len * lift, a.1 + (b.1 - a.1) * t + ny / len * lift)
        })
        .collect()
}

/// The strokes of one digit, in a box one unit wide and 1.6 tall, each drawn in
/// the direction a brush would travel.
fn digit(d: u8) -> Vec<Stroke> {
    match d {
        // Started at the top and closed with a little overlap, as a brush does.
        0 => vec![arc(0.5, 0.8, 0.48, 0.8, 250.0, 625.0)],
        1 => vec![
            bowed((0.12, 0.38), (0.5, 0.02), -0.04),
            bowed((0.5, 0.02), (0.5, 1.6), 0.05),
        ],
        2 => {
            let mut s = arc(0.5, 0.45, 0.46, 0.43, 200.0, 395.0);
            s.extend(bowed((0.86, 0.72), (0.02, 1.55), -0.08).into_iter().skip(1));
            vec![s, bowed((0.0, 1.58), (1.0, 1.5), 0.05)]
        }
        3 => vec![
            arc(0.48, 0.42, 0.44, 0.4, 205.0, 440.0),
            arc(0.48, 1.18, 0.52, 0.42, 265.0, 515.0),
        ],
        4 => vec![
            {
                let mut s = bowed((0.55, 0.0), (0.02, 1.08), 0.04);
                s.push((1.0, 1.03));
                s
            },
            bowed((0.78, 0.45), (0.74, 1.6), 0.04),
        ],
        5 => vec![
            bowed((0.2, 0.02), (0.95, 0.0), 0.04),
            {
                let mut s = bowed((0.2, 0.04), (0.12, 0.74), 0.03);
                s.extend(arc(0.48, 1.1, 0.5, 0.5, 220.0, 505.0));
                s
            },
        ],
        6 => {
            let mut s = arc(1.1, 1.1, 1.05, 1.08, 255.0, 180.0);
            s.extend(arc(0.5, 1.12, 0.48, 0.46, 180.0, 535.0));
            vec![s]
        }
        7 => vec![{
            let mut s = bowed((0.0, 0.08), (0.98, 0.0), 0.05);
            s.extend(bowed((0.98, 0.0), (0.3, 1.6), 0.1).into_iter().skip(1));
            s
        }],
        8 => vec![{
            // One continuous figure-of-eight, the way it is actually written.
            let mut s = arc(0.5, 0.42, 0.4, 0.4, 60.0, -270.0);
            s.extend(arc(0.5, 1.2, 0.5, 0.4, 270.0, 630.0));
            s
        }],
        // A six turned upside down.
        9 => digit(6)
            .into_iter()
            .map(|s| s.into_iter().map(|(x, y)| (1.0 - x, GLYPH_HEIGHT - y)).collect())
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grey(width: u32, height: u32, level: u8) -> RgbImage {
        RgbImage::from_pixel(width, height, Rgb([level; 3]))
    }

    /// Bounding box of every pixel `stamp` changed.
    fn touched(img: &RgbImage, level: u8) -> (u32, u32, u32, u32) {
        let mut b = (u32::MAX, u32::MAX, 0, 0);
        for (x, y, p) in img.enumerate_pixels() {
            if p.0 != [level; 3] {
                b = (b.0.min(x), b.1.min(y), b.2.max(x), b.3.max(y));
            }
        }
        b
    }

    #[test]
    fn the_balloon_sits_in_the_top_right_and_leaves_the_rest_alone() {
        let mut img = grey(600, 900, 128);
        stamp(&mut img, 115);

        let (left, top, right, bottom) = touched(&img, 128);
        assert!(left > 200, "reaches too far left: {left}");
        assert!(bottom < 450, "reaches too far down: {bottom}");
        assert!(right < 600 && top > 0, "must stay on the cover");
        assert!(right > 520 && top < 40, "should sit in the corner: {right},{top}");
    }

    #[test]
    fn the_balloon_is_white_with_black_lettering() {
        let mut img = grey(600, 900, 128);
        stamp(&mut img, 115);

        let (left, top, right, bottom) = touched(&img, 128);
        let (mut dark, mut light) = (0, 0);
        for y in top..=bottom {
            for x in left..=right {
                match img.get_pixel(x, y).0[0] {
                    0..=40 => dark += 1,
                    215..=255 => light += 1,
                    _ => {}
                }
            }
        }
        assert!(light > dark, "balloon should be mostly paper: {light} vs {dark}");
        assert!(dark > 2000, "outline and lettering should be inked: {dark}");
    }

    #[test]
    fn a_longer_number_makes_a_wider_balloon() {
        let width_of = |n| {
            let mut img = grey(600, 900, 128);
            stamp(&mut img, n);
            let (left, _, right, _) = touched(&img, 128);
            right - left
        };
        assert!(width_of(115) > width_of(7));
    }

    #[test]
    fn a_black_cover_still_shows_the_balloon() {
        let mut img = grey(600, 900, 0);
        stamp(&mut img, 3);
        let white = img.pixels().filter(|p| p.0[0] > 200).count();
        assert!(white > 3000, "expected white paper inside the balloon: {white}");
    }

    #[test]
    fn the_brush_lands_heavy_and_lifts_thin() {
        assert!(brush_profile(0.0) > brush_profile(0.1), "a blob where the brush lands");
        assert!(brush_profile(0.5) > brush_profile(1.0), "a taper as it lifts");
        assert!(brush_profile(1.0) > 0.0, "but never to nothing");
    }

    #[test]
    fn every_digit_has_strokes() {
        for d in 0..=9 {
            assert!(!digit(d).is_empty(), "digit {d} has no strokes");
        }
    }

    #[test]
    fn a_tiny_image_is_left_alone_rather_than_scribbled_on() {
        let mut img = grey(32, 32, 128);
        stamp(&mut img, 1);
        assert!(img.pixels().all(|p| p.0 == [128; 3]));
    }
}
