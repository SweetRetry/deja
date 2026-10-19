// Re-saves each picture in a folder at other sizes, then prints how far each
// re-save lands from its original, and how far apart distinct originals sit,
// on cell-by-cell OKLab gaps of a box-averaged grid taken from a 512px sample.
// Run: cargo run --example dupe_probe -- <dir>
use deja_lib::color;
use std::path::{Path, PathBuf};

const SIDES: [u32; 2] = [64, 128];

fn sample(path: &Path, work: &Path) -> Option<(color::Image, f64)> {
  let out = work.join("s.png");
  let (w, h) = deja_lib::files::sips_size(path);
  let mut cmd = std::process::Command::new("sips");
  if w?.max(h?) > 512 {
    cmd.args(["-Z", "512"]);
  }
  let ok = cmd.args(["-s", "format", "png"]).arg(path).arg("--out").arg(&out).output().ok()?;
  if !ok.status.success() {
    return None;
  }
  let image = color::decode_png(&std::fs::read(&out).ok()?)?;
  let aspect = image.width as f64 / image.height as f64;
  Some((image, aspect))
}

fn grid(image: &color::Image, side: u32) -> Vec<color::Oklab> {
  color::thumbnail(image, side).into_iter().map(color::to_oklab).collect()
}

struct Print {
  image: color::Image,
  grids: Vec<Vec<color::Oklab>>,
  aspect: f64,
}

fn print(path: &Path, work: &Path) -> Option<Print> {
  let (image, aspect) = sample(path, work)?;
  Some(Print { grids: SIDES.iter().map(|n| grid(&image, *n)).collect(), image, aspect })
}

/// Per grid: mean, 95th, 99th percentile and max gap. Last grid is at the
/// smaller picture's own resolution.
fn gaps(a: &Print, b: &Print) -> String {
  let side = a.image.width.max(a.image.height).min(b.image.width.max(b.image.height));
  let own = [grid(&a.image, side), grid(&b.image, side)];
  a.grids
    .iter()
    .chain(std::iter::once(&own[0]))
    .zip(b.grids.iter().chain(std::iter::once(&own[1])))
    .map(|(x, y)| {
      let mut d: Vec<f64> = x.iter().zip(y).map(|(p, q)| color::distance(*p, *q)).collect();
      d.sort_by(|p, q| p.partial_cmp(q).unwrap());
      let mean = d.iter().sum::<f64>() / d.len() as f64;
      format!("{mean:.4} {:.4} {:.4} {:.4}", d[d.len() * 95 / 100], d[d.len() * 99 / 100], d[d.len() - 1])
    })
    .collect::<Vec<_>>()
    .join(" ")
}

fn main() {
  let dir = PathBuf::from(std::env::args().nth(1).expect("dir"));
  let work = std::env::temp_dir().join(format!("dupe-probe-{}", std::process::id()));
  std::fs::create_dir_all(&work).unwrap();
  let mut originals: Vec<(PathBuf, Print)> = Vec::new();
  for entry in walk(&dir) {
    let Some(p) = print(&entry, &work) else { continue };
    let (w, h) = deja_lib::files::sips_size(&entry);
    let long = w.unwrap_or(0).max(h.unwrap_or(0));
    for (label, side, format) in [("x0.25 jpg", long / 4, "jpeg"), ("200px png", 200, "png")] {
      let out = work.join(format!("v.{format}"));
      let ok = std::process::Command::new("sips").args(["-Z", &side.to_string(), "-s", "format", format]).arg(&entry).arg("--out").arg(&out).output().unwrap();
      if !ok.status.success() {
        continue;
      }
      if let Some(q) = print(&out, &work) {
        println!("resave\t{}\t{label}\t{:.4}\t{}", entry.display(), (p.aspect / q.aspect - 1.0).abs(), gaps(&p, &q));
      }
    }
    originals.push((entry, p));
  }
  for i in 0..originals.len() {
    for j in i + 1..originals.len() {
      let (a, b) = (&originals[i], &originals[j]);
      if (a.1.aspect / b.1.aspect - 1.0).abs() >= 0.02 {
        continue;
      }
      println!("pair\t{}|{}\t-\t{:.4}\t{}", a.0.display(), b.0.display(), (a.1.aspect / b.1.aspect - 1.0).abs(), gaps(&a.1, &b.1));
    }
  }
  let _ = std::fs::remove_dir_all(&work);
}

fn walk(dir: &Path) -> Vec<PathBuf> {
  let mut out = Vec::new();
  for e in std::fs::read_dir(dir).unwrap().flatten() {
    let p = e.path();
    if p.is_dir() {
      out.extend(walk(&p));
    } else if matches!(p.extension().and_then(|x| x.to_str()).map(|x| x.to_lowercase()).as_deref(), Some("jpg" | "jpeg" | "png" | "webp")) {
      out.push(p);
    }
  }
  out.sort();
  out
}
