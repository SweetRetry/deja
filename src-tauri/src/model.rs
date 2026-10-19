// Client and lifecycle for the Python embedding sidecar. The model lives in
// another process on purpose: the vault indexer can stall, crash or be paused
// without dragging the app down, and the memory goes away when it idles out.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// 5187 unless DEJA_MODEL_PORT says otherwise, so a test backend can run its
/// own model next to a dev app instead of borrowing the app's.
fn port() -> u16 {
  std::env::var("DEJA_MODEL_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(5187)
}
/// Measured in sidecar/eval: 512 beats 256 by ~0.03 mAP on the 148-image set.
pub const DIM: usize = 512;

#[derive(Serialize)]
pub struct Item {
  pub id: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub text: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub image: Option<String>,
}

pub fn sidecar_dir() -> Option<PathBuf> {
  if let Ok(dir) = std::env::var("DEJA_SIDECAR") {
    let path = PathBuf::from(dir);
    if path.join("embed_server.py").exists() {
      return Some(path);
    }
  }
  let mut candidates = vec![PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../sidecar"))];
  if let Ok(cwd) = std::env::current_dir() {
    candidates.push(cwd.join("sidecar"));
  }
  candidates.into_iter().find(|path| path.join("embed_server.py").exists())
}

fn python(dir: &PathBuf) -> PathBuf {
  let venv = dir.join(".venv/bin/python");
  if venv.exists() {
    venv
  } else {
    PathBuf::from("python3")
  }
}

fn request(path: &str, body: Option<&str>, timeout: Duration) -> Result<Value, String> {
  let payload = body.unwrap_or("");
  let port = port();
  let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| format!("sidecar is not running: {e}"))?;
  stream.set_read_timeout(Some(timeout)).map_err(|e| e.to_string())?;
  stream.set_write_timeout(Some(timeout)).map_err(|e| e.to_string())?;
  let head = if body.is_none() {
    format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
  } else {
    format!(
      "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
      payload.len()
    )
  };
  stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
  stream.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
  let mut raw = Vec::new();
  stream.read_to_end(&mut raw).map_err(|e| e.to_string())?;
  let text = String::from_utf8_lossy(&raw);
  let (headers, body) = text.split_once("\r\n\r\n").ok_or("sidecar returned nothing")?;
  let status: u16 = headers
    .lines()
    .next()
    .and_then(|line| line.split_whitespace().nth(1))
    .and_then(|code| code.parse().ok())
    .unwrap_or(0);
  // The sidecar always answers with a Content-Length body (embed_server.py
  // _send_json), never chunked, so the body is the bytes after the headers.
  if status != 200 {
    return Err(format!("sidecar said {status}: {body}"));
  }
  serde_json::from_str(body).map_err(|e| format!("sidecar sent invalid json: {e}"))
}

pub fn healthy() -> bool {
  state() == State::Ready
}

/// The model process has four states and every caller goes through them.
/// Without this, parallel callers each spawned a process: two lost the port and
/// three copies of a 1.2 GB model sat in memory.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum State {
  Stopped,
  Starting,
  Ready,
  Failed,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Transition {
  Spawn,
  BecameReady,
  BecameUnhealthy,
  Failed,
}

pub fn advance(state: State, transition: Transition) -> State {
  match (state, transition) {
    (State::Starting, Transition::BecameReady) => State::Ready,
    (State::Ready, Transition::BecameUnhealthy) => State::Stopped,
    (State::Starting, Transition::Failed) => State::Failed,
    (State::Stopped | State::Failed, Transition::Spawn) => State::Starting,
    // A spawn while starting or ready would be a second model process.
    (other, _) => other,
  }
}

static STATE: std::sync::Mutex<State> = std::sync::Mutex::new(State::Stopped);

/// The write end of the model's stdin. It is never written to; when this
/// process exits for any reason the OS closes it, the model reads EOF and exits.
/// Without it a restarted app found the old model still on the port and kept
/// talking to stale code.
static LIFELINE: std::sync::Mutex<Option<std::process::ChildStdin>> = std::sync::Mutex::new(None);

fn current() -> State {
  STATE.lock().map(|guard| *guard).unwrap_or(State::Stopped)
}

fn set(state: State) {
  if let Ok(mut guard) = STATE.lock() {
    *guard = state;
  }
}

fn health_probe() -> bool {
  request("/health", None, Duration::from_millis(600)).is_ok()
}

/// Health is cached in the state: a stopped model answers without a request,
/// and a start in progress never answers "healthy" early.
pub fn state() -> State {
  refresh(&health_probe)
}

/// `state` with the probe passed in, so a test can stand in for the sidecar.
fn refresh(healthy: &dyn Fn() -> bool) -> State {
  match STATE.try_lock() {
    Ok(mut guard) => {
      if *guard == State::Ready && !healthy() {
        *guard = advance(*guard, Transition::BecameUnhealthy);
      }
      *guard
    }
    // Another caller is probing right now; answer as if the model were still
    // coming up, which no caller acts on.
    Err(_) => State::Starting,
  }
}

/// For callers that need the model now: ready stays ready, a model that idled
/// out is started again, and a start in progress or a failed one is not
/// waited on (the caller falls back to keywords; a failure is retried by the user).
pub fn ready_or_restart() -> bool {
  match state() {
    State::Ready => true,
    State::Stopped => ensure_started(Duration::from_secs(60)).is_ok(),
    State::Starting | State::Failed => false,
  }
}

/// Frees the model's memory now. Closing its stdin is the sidecar's exit
/// signal; a start in progress is left alone and idles out on its own.
pub fn stop() {
  if let Ok(mut guard) = STATE.lock() {
    if *guard == State::Starting {
      return;
    }
    *guard = State::Stopped;
  }
  if let Ok(mut lifeline) = LIFELINE.lock() {
    lifeline.take();
  }
}

/// Starts the sidecar if needed and waits until it answers. Returns the time
/// the model took to come up, in milliseconds.
pub fn ensure_started(timeout: Duration) -> Result<u128, String> {
  start(timeout, &spawn_sidecar, &health_probe)
}

/// `ensure_started` with its two effects passed in: how to spawn the process
/// and how to ask whether it answers.
fn start(timeout: Duration, spawn: &dyn Fn() -> Result<(), String>, healthy: &dyn Fn() -> bool) -> Result<u128, String> {
  match refresh(healthy) {
    State::Ready => return Ok(0),
    State::Starting => {
      // Another caller owns the spawn; wait for it instead of starting a second.
      let started = Instant::now();
      while started.elapsed() < timeout {
        if refresh(healthy) == State::Ready {
          return Ok(0);
        }
        std::thread::sleep(Duration::from_millis(250));
      }
      return Err("another caller is still starting the model".into());
    }
    _ => {}
  }
  set(advance(current(), Transition::Spawn));
  spawn()?;
  let started = Instant::now();
  while started.elapsed() < timeout {
    if healthy() {
      set(advance(current(), Transition::BecameReady));
      return Ok(started.elapsed().as_millis());
    }
    std::thread::sleep(Duration::from_millis(250));
  }
  set(advance(current(), Transition::Failed));
  Err(format!("model did not answer within {}s", timeout.as_secs()))
}

/// Launches embed_server.py with its output in model.log and its stdin held
/// by LIFELINE.
fn spawn_sidecar() -> Result<(), String> {
  let dir = sidecar_dir().ok_or("sidecar/embed_server.py not found")?;
  // Keep the model's own output: when it dies, this file says why.
  let log_dir = crate::data_dir();
  let _ = std::fs::create_dir_all(&log_dir);
  let log = std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(log_dir.join("model.log"))
    .ok();
  let mut child = Command::new(python(&dir))
    .arg(dir.join("embed_server.py"))
    .arg("--port")
    .arg(port().to_string())
    .arg("--dim")
    .arg(DIM.to_string())
    .arg("--idle-timeout")
    .arg(crate::settings::get().model_idle_secs.to_string())
    .arg("--exit-with-stdin")
    .current_dir(&dir)
    .stdin(Stdio::piped())
    .stdout(match &log {
      Some(file) => Stdio::from(file.try_clone().map_err(|e| e.to_string())?),
      None => Stdio::null(),
    })
    .stderr(match &log {
      Some(file) => Stdio::from(file.try_clone().map_err(|e| e.to_string())?),
      None => Stdio::null(),
    })
    .spawn()
    .map_err(|e| format!("cannot start the model process: {e}"))?;
  if let Ok(mut lifeline) = LIFELINE.lock() {
    *lifeline = child.stdin.take();
  }
  std::thread::spawn(move || {
    let _ = child.wait();
  });
  Ok(())
}

#[derive(Deserialize)]
struct EmbedResponse {
  vectors: Vec<VectorRow>,
}

#[derive(Deserialize)]
struct VectorRow {
  id: String,
  vector: Vec<f32>,
}

pub fn embed(items: &[Item]) -> Result<Vec<(String, Vec<f32>)>, String> {
  if items.is_empty() {
    return Ok(Vec::new());
  }
  let body = serde_json::to_string(&json!({ "items": items, "dim": DIM })).map_err(|e| e.to_string())?;
  if std::env::var("DEJA_DEBUG_EMBED").is_ok() {
    let log = crate::data_dir().join("embed-client.log");
    let _ = std::fs::OpenOptions::new().create(true).append(true).open(&log).map(|mut file| {
      use std::io::Write;
      let _ = writeln!(file, "items={} bytes={} {}", items.len(), body.len(), &body[..body.len().min(400)]);
    });
  }
  let value = request("/embed", Some(&body), Duration::from_secs(120))?;
  let parsed: EmbedResponse =
    serde_json::from_value(value).map_err(|e| format!("sidecar sent an unexpected shape: {e}"))?;
  Ok(parsed.vectors.into_iter().map(|row| (row.id, row.vector)).collect())
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
  if a.len() != b.len() || a.is_empty() {
    return 0.0;
  }
  let mut dot = 0.0;
  let mut na = 0.0;
  let mut nb = 0.0;
  for i in 0..a.len() {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if na == 0.0 || nb == 0.0 {
    return 0.0;
  }
  dot / (na.sqrt() * nb.sqrt())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn cosine_is_one_for_same_direction() {
    assert!((cosine(&[1.0, 0.0], &[0.5, 0.0]) - 1.0).abs() < 1e-6);
    assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
    assert_eq!(cosine(&[], &[]), 0.0);
  }

  #[test]
  fn one_start_at_a_time_is_a_state_rule() {
    assert_eq!(advance(State::Stopped, Transition::Spawn), State::Starting);
    assert_eq!(advance(State::Starting, Transition::Spawn), State::Starting, "no second process");
    assert_eq!(advance(State::Ready, Transition::Spawn), State::Ready, "ready never spawns again");
    assert_eq!(advance(State::Starting, Transition::BecameReady), State::Ready);
    assert_eq!(advance(State::Ready, Transition::BecameUnhealthy), State::Stopped, "an idle exit is noticed");
  }

  #[test]
  fn a_failed_start_can_be_retried() {
    let failed = advance(State::Starting, Transition::Failed);
    assert_eq!(failed, State::Failed);
    assert_eq!(advance(failed, Transition::Spawn), State::Starting);
    assert_eq!(advance(failed, Transition::BecameReady), failed, "only a spawn leaves failed");
  }
}
