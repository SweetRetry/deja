// Deterministic image analysis: PNG decode (what sips hands us), OKLab
// conversion, k-means for the dominant colors, and a dHash for "find similar".
use crate::ColorShare;

pub fn fnv64(bytes: &[u8]) -> u64 {
  let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
  for byte in bytes {
    hash ^= *byte as u64;
    hash = hash.wrapping_mul(0x100_0000_01b3);
  }
  hash
}

#[derive(Clone, Copy, Debug)]
pub struct Rgb {
  pub r: f64,
  pub g: f64,
  pub b: f64,
}

impl Rgb {
  fn hex(self) -> String {
    let to = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", to(self.r), to(self.g), to(self.b))
  }
}

#[derive(Clone, Copy, Debug)]
pub struct Oklab {
  pub l: f64,
  pub a: f64,
  pub b: f64,
}

fn to_linear(v: f64) -> f64 {
  if v <= 0.04045 {
    v / 12.92
  } else {
    ((v + 0.055) / 1.055).powf(2.4)
  }
}

fn from_linear(v: f64) -> f64 {
  if v <= 0.003_130_8 {
    v * 12.92
  } else {
    1.055 * v.powf(1.0 / 2.4) - 0.055
  }
}

pub fn to_oklab(c: Rgb) -> Oklab {
  let (r, g, b) = (to_linear(c.r), to_linear(c.g), to_linear(c.b));
  let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
  let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
  let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
  Oklab {
    l: 0.210_454_255_3 * l + 0.793_617_785_0 * m - 0.004_072_046_8 * s,
    a: 1.977_998_495_1 * l - 2.428_592_205_0 * m + 0.450_593_709_9 * s,
    b: 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766_0 * s,
  }
}

pub fn from_oklab(lab: Oklab) -> Rgb {
  let l = (lab.l + 0.396_337_777_4 * lab.a + 0.215_803_757_3 * lab.b).powi(3);
  let m = (lab.l - 0.105_561_345_8 * lab.a - 0.063_854_172_8 * lab.b).powi(3);
  let s = (lab.l - 0.089_484_177_5 * lab.a - 1.291_485_548_0 * lab.b).powi(3);
  Rgb {
    r: from_linear(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
    g: from_linear(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
    b: from_linear(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701_0 * s),
  }
}

pub fn distance(x: Oklab, y: Oklab) -> f64 {
  ((x.l - y.l).powi(2) + (x.a - y.a).powi(2) + (x.b - y.b).powi(2)).sqrt()
}

/// Whether an image's palette carries a colour, judged the way people name
/// colours. Plain Oklab distance with one radius let a grey of the right
/// lightness pass as dark blue and mustard pass as grass green, so:
/// a chromatic target matches colours within 25° of hue (the swatches sit 45°
/// apart, so neighbours barely overlap) and 0.18 of lightness (brown is a dark
/// orange) that are themselves colourful; a neutral target matches greys of
/// nearby lightness. Neutrals sit
/// in the shadows and backgrounds of most photos, so they must cover more of
/// the image to count. Tuned by eye on the 199-image assets folder.
pub fn palette_matches(colors: &[ColorShare], hex: &str) -> bool {
  const NEUTRAL: f64 = 0.04;
  let Some(want) = hex_to_oklab(hex) else { return false };
  let chroma = |c: Oklab| c.a.hypot(c.b);
  let hue = |c: Oklab| c.b.atan2(c.a).to_degrees();
  let neutral_target = chroma(want) < NEUTRAL;
  let covered: f64 = colors
    .iter()
    .filter(|color| {
      let Some(have) = hex_to_oklab(&color.hex) else { return false };
      if neutral_target {
        chroma(have) < 0.05 && (have.l - want.l).abs() < 0.15
      } else {
        let hue_gap = ((hue(have) - hue(want) + 540.0) % 360.0 - 180.0).abs();
        chroma(have) >= 0.06 && hue_gap < 25.0 && (have.l - want.l).abs() < 0.18
      }
    })
    .map(|color| color.share)
    .sum();
  covered >= if neutral_target { 0.35 } else { 0.20 }
}

pub fn hex_to_oklab(hex: &str) -> Option<Oklab> {
  let raw = hex.trim_start_matches('#');
  if raw.len() != 6 {
    return None;
  }
  let channel = |i: usize| u8::from_str_radix(&raw[i..i + 2], 16).ok().map(|v| v as f64 / 255.0);
  Some(to_oklab(Rgb {
    r: channel(0)?,
    g: channel(2)?,
    b: channel(4)?,
  }))
}

#[derive(Debug)]
pub struct Image {
  pub width: u32,
  pub height: u32,
  pub rgb: Vec<u8>,
}

/// Minimal PNG decoder for what `sips` writes: 8-bit, non-interlaced,
/// color types 0, 2, 4 and 6.
pub fn decode_png(bytes: &[u8]) -> Option<Image> {
  if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
    return None;
  }
  let mut offset = 8;
  let mut width = 0u32;
  let mut height = 0u32;
  let mut depth = 0u8;
  let mut color_type = 0u8;
  let mut idat: Vec<u8> = Vec::new();
  while offset + 8 <= bytes.len() {
    let len = u32::from_be_bytes(bytes[offset..offset + 4].try_into().ok()?) as usize;
    let kind = &bytes[offset + 4..offset + 8];
    let body = bytes.get(offset + 8..offset + 8 + len)?;
    match kind {
      b"IHDR" => {
        width = u32::from_be_bytes(body[0..4].try_into().ok()?);
        height = u32::from_be_bytes(body[4..8].try_into().ok()?);
        depth = body[8];
        color_type = body[9];
        if body[12] != 0 {
          return None;
        }
      }
      b"IDAT" => idat.extend_from_slice(body),
      b"IEND" => break,
      _ => {}
    }
    offset += 12 + len;
  }
  if depth != 8 || width == 0 || height == 0 {
    return None;
  }
  let channels = match color_type {
    0 | 3 => 1,
    2 => 3,
    4 => 2,
    6 => 4,
    _ => return None,
  };
  let raw = miniz_oxide::inflate::decompress_to_vec_zlib(&idat).ok()?;
  let stride = width as usize * channels;
  if raw.len() < (stride + 1) * height as usize {
    return None;
  }
  let mut pixels = vec![0u8; stride * height as usize];
  let mut previous = vec![0u8; stride];
  for row in 0..height as usize {
    let start = row * (stride + 1);
    let filter = raw[start];
    let line = &raw[start + 1..start + 1 + stride];
    let mut current = vec![0u8; stride];
    for i in 0..stride {
      let left = if i >= channels { current[i - channels] } else { 0 };
      let up = previous[i];
      let up_left = if i >= channels { previous[i - channels] } else { 0 };
      let value = match filter {
        0 => line[i],
        1 => line[i].wrapping_add(left),
        2 => line[i].wrapping_add(up),
        3 => line[i].wrapping_add(((left as u16 + up as u16) / 2) as u8),
        4 => {
          let p = left as i16 + up as i16 - up_left as i16;
          let (pa, pb, pc) = (
            (p - left as i16).abs(),
            (p - up as i16).abs(),
            (p - up_left as i16).abs(),
          );
          let predictor = if pa <= pb && pa <= pc {
            left
          } else if pb <= pc {
            up
          } else {
            up_left
          };
          line[i].wrapping_add(predictor)
        }
        _ => return None,
      };
      current[i] = value;
    }
    pixels[row * stride..(row + 1) * stride].copy_from_slice(&current);
    previous = current;
  }
  let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
  for pixel in pixels.chunks_exact(channels) {
    match channels {
      1 => rgb.extend_from_slice(&[pixel[0], pixel[0], pixel[0]]),
      2 => rgb.extend_from_slice(&[pixel[0], pixel[0], pixel[0]]),
      3 => rgb.extend_from_slice(&pixel[0..3]),
      _ => rgb.extend_from_slice(&pixel[0..3]),
    }
  }
  Some(Image { width, height, rgb })
}

/// Average the image down to `side` x `side`, which is all the analysis needs.
pub fn thumbnail(image: &Image, side: u32) -> Vec<Rgb> {
  let mut out = Vec::with_capacity((side * side) as usize);
  let (w, h) = (image.width as usize, image.height as usize);
  for ty in 0..side as usize {
    for tx in 0..side as usize {
      let x0 = tx * w / side as usize;
      let x1 = (((tx + 1) * w) / side as usize).max(x0 + 1).min(w);
      let y0 = ty * h / side as usize;
      let y1 = (((ty + 1) * h) / side as usize).max(y0 + 1).min(h);
      let mut sum = [0f64; 3];
      let mut count = 0f64;
      for y in y0..y1 {
        for x in x0..x1 {
          let i = (y * w + x) * 3;
          sum[0] += image.rgb[i] as f64;
          sum[1] += image.rgb[i + 1] as f64;
          sum[2] += image.rgb[i + 2] as f64;
          count += 1.0;
        }
      }
      let scale = if count > 0.0 { 255.0 * count } else { 255.0 };
      out.push(Rgb {
        r: sum[0] / scale,
        g: sum[1] / scale,
        b: sum[2] / scale,
      });
    }
  }
  out
}

struct Lcg(u64);

impl Lcg {
  fn next(&mut self) -> f64 {
    self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
    (self.0 >> 11) as f64 / (1u64 << 53) as f64
  }
}

/// k-means in OKLab over the 32x32 sample. Colors under 10% are dropped, so a
/// monochrome poster reports one color and a sunset reports three.
pub fn dominant_colors(sample: &[Rgb], min_share: f64, max_colors: usize) -> Vec<ColorShare> {
  if sample.is_empty() {
    return Vec::new();
  }
  let labs: Vec<Oklab> = sample.iter().map(|c| to_oklab(*c)).collect();
  let k = 6.min(labs.len());
  let mut rng = Lcg(0x5eed_1234);
  let mut centers: Vec<Oklab> = Vec::with_capacity(k);
  centers.push(labs[0]);
  while centers.len() < k {
    let random = (rng.next() * (labs.len() - 1) as f64) as usize;
    centers.push(labs[random.min(labs.len() - 1)]);
  }
  for _ in 0..12 {
    let mut groups: Vec<Vec<usize>> = vec![Vec::new(); centers.len()];
    for (i, lab) in labs.iter().enumerate() {
      let mut best = 0;
      let mut best_distance = f64::MAX;
      for (j, center) in centers.iter().enumerate() {
        let d = distance(*lab, *center);
        if d < best_distance {
          best_distance = d;
          best = j;
        }
      }
      groups[best].push(i);
    }
    for (j, group) in groups.iter().enumerate() {
      if group.is_empty() {
        continue;
      }
      let mut sum = Oklab { l: 0.0, a: 0.0, b: 0.0 };
      for i in group {
        sum.l += labs[*i].l;
        sum.a += labs[*i].a;
        sum.b += labs[*i].b;
      }
      let n = group.len() as f64;
      centers[j] = Oklab { l: sum.l / n, a: sum.a / n, b: sum.b / n };
    }
  }
  let mut buckets: Vec<(Oklab, f64)> = Vec::new();
  for lab in &labs {
    let mut best = 0;
    let mut best_distance = f64::MAX;
    for (j, center) in centers.iter().enumerate() {
      let d = distance(*lab, *center);
      if d < best_distance {
        best_distance = d;
        best = j;
      }
    }
    buckets.push((centers[best], 0.0));
  }
  let total = labs.len() as f64;
  let mut merged: Vec<(Oklab, f64)> = Vec::new();
  for (center, _) in buckets {
    match merged.iter_mut().find(|(c, _)| distance(*c, center) < 0.03) {
      Some((_, share)) => *share += 1.0 / total,
      None => merged.push((center, 1.0 / total)),
    }
  }
  merged.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
  merged
    .into_iter()
    .filter(|(_, share)| *share >= min_share)
    .take(max_colors)
    .map(|(lab, share)| ColorShare {
      hex: from_oklab(lab).hex(),
      share: (share * 1000.0).round() / 1000.0,
    })
    .collect()
}

/// 64-bit dHash over the 32x32 average. 64 hex chars? No: 16.
pub fn dhash(sample: &[Rgb], side: u32) -> String {
  if sample.len() != (side * side) as usize || side < 9 {
    return String::new();
  }
  let gray: Vec<f64> = sample
    .iter()
    .map(|c| 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b)
    .collect();
  let mut bits = 0u64;
  for y in 0..8usize {
    for x in 0..8usize {
      let left = gray[y * side as usize + x];
      let right = gray[y * side as usize + x + 1];
      bits = (bits << 1) | u64::from(left > right);
    }
  }
  format!("{bits:016x}")
}

pub fn hamming(a: &str, b: &str) -> u32 {
  if a.len() != b.len() || a.is_empty() {
    return 64;
  }
  match (u64::from_str_radix(a, 16), u64::from_str_radix(b, 16)) {
    (Ok(x), Ok(y)) => (x ^ y).count_ones(),
    _ => 64,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn palette(colors: &[(&str, f64)]) -> Vec<ColorShare> {
    colors.iter().map(|(hex, share)| ColorShare { hex: hex.to_string(), share: *share }).collect()
  }

  #[test]
  fn grey_portrait_is_not_dark_blue() {
    // A black-and-white photo from the assets folder.
    let grey = palette(&[("#444444", 0.25), ("#363636", 0.20), ("#575757", 0.17)]);
    assert!(!palette_matches(&grey, "#3065be"));
    assert!(palette_matches(&grey, "#3a3a3a"), "it is a dark grey picture");
  }

  #[test]
  fn mustard_is_not_green_but_fern_is() {
    let mustard = palette(&[("#946825", 0.23), ("#b1832a", 0.22), ("#ca9947", 0.20)]);
    assert!(!palette_matches(&mustard, "#4f9b3e"));
    let fern = palette(&[("#3f6b1c", 0.45), ("#20351a", 0.20)]);
    assert!(palette_matches(&fern, "#4f9b3e"));
  }

  #[test]
  fn brown_and_orange_are_told_apart_by_lightness() {
    let walnut = palette(&[("#6b4226", 0.50)]);
    let tangerine = palette(&[("#ef8a2c", 0.50)]);
    assert!(palette_matches(&walnut, "#774826"));
    assert!(!palette_matches(&walnut, "#e87f25"));
    assert!(palette_matches(&tangerine, "#e87f25"));
    assert!(!palette_matches(&tangerine, "#774826"));
  }

  #[test]
  fn a_shadow_does_not_make_a_picture_dark() {
    let shadowed = palette(&[("#d9d2c5", 0.50), ("#1c1c1e", 0.20)]);
    assert!(!palette_matches(&shadowed, "#1b1b1f"));
    let night = palette(&[("#0b0b0d", 0.55), ("#2a2a2e", 0.15)]);
    assert!(palette_matches(&night, "#1b1b1f"));
  }

  #[test]
  fn oklab_roundtrip_keeps_color() {
    let start = Rgb { r: 0.2, g: 0.5, b: 0.8 };
    let back = from_oklab(to_oklab(start));
    assert!((back.r - start.r).abs() < 0.002);
    assert!((back.g - start.g).abs() < 0.002);
    assert!((back.b - start.b).abs() < 0.002);
  }

  #[test]
  fn hex_to_oklab_matches_rgb_path() {
    let lab = hex_to_oklab("#ffffff").expect("valid hex");
    assert!((lab.l - 1.0).abs() < 0.01);
    assert!(hex_to_oklab("bogus").is_none());
  }

  #[test]
  fn flat_image_reports_one_color_and_zero_hash() {
    let sample = vec![Rgb { r: 1.0, g: 1.0, b: 1.0 }; 32 * 32];
    let colors = dominant_colors(&sample, 0.10, 3);
    assert_eq!(colors.len(), 1, "flat image should collapse to one color");
    assert_eq!(colors[0].share, 1.0);
    assert_eq!(dhash(&sample, 32), "0000000000000000");
  }

  #[test]
  fn hamming_reads_distance() {
    assert_eq!(hamming("0000000000000000", "0000000000000000"), 0);
    assert_eq!(hamming("0000000000000001", "0000000000000000"), 1);
    assert_eq!(hamming("", "0000000000000000"), 64);
  }
}
