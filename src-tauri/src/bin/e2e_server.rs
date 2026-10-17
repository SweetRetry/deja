// Local HTTP front for the same dispatch the Tauri command uses, so Playwright
// can drive the real Rust backend instead of a JavaScript stand-in.
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};

fn main() {
  let port: u16 = std::env::var("SHELF_E2E_PORT")
    .ok()
    .and_then(|value| value.parse().ok())
    .unwrap_or(5177);
  let listener = TcpListener::bind(("127.0.0.1", port)).expect("port 5177 is free");
  println!("ready {port}");
  let _ = std::io::stdout().flush();
  for stream in listener.incoming().flatten() {
    std::thread::spawn(move || handle(stream));
  }
}

fn handle(mut stream: TcpStream) {
  let Ok(mut reader) = stream.try_clone().map(BufReader::new) else {
    return;
  };
  let mut request_line = String::new();
  if reader.read_line(&mut request_line).is_err() {
    return;
  }
  let mut parts = request_line.split_whitespace();
  let method = parts.next().unwrap_or("").to_string();
  let path = parts.next().unwrap_or("").to_string();
  let mut length = 0usize;
  loop {
    let mut header = String::new();
    if reader.read_line(&mut header).unwrap_or(0) == 0 || header.trim().is_empty() {
      break;
    }
    if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
      length = value.trim().parse().unwrap_or(0);
    }
  }
  let mut body = vec![0u8; length];
  if length > 0 {
    let _ = reader.read_exact(&mut body);
  }

  let payload: Value = if method == "GET" && path.ends_with("/health") {
    json!({ "ok": true })
  } else {
    let name = path.rsplit('/').next().unwrap_or("").to_string();
    let args: Value = if body.is_empty() {
      json!({})
    } else {
      serde_json::from_slice(&body).unwrap_or(json!({}))
    };
    match shelf_lib::dispatch(&name, &args) {
      Ok(data) => json!({ "ok": true, "data": data }),
      Err(error) => json!({ "ok": false, "error": error }),
    }
  };

  let text = serde_json::to_string(&payload).unwrap_or_else(|_| "{\"ok\":false}".into());
  let response = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
    text.len(),
    text
  );
  let _ = stream.write_all(response.as_bytes());
  let _ = stream.flush();
}
