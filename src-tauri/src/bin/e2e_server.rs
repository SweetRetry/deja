// Local HTTP front for the same dispatch the Tauri command uses, so Playwright
// can drive the real Rust backend instead of a JavaScript stand-in. `/mcp` goes
// to the MCP server's handler, so its tools run against the same vault.
use deja_lib::http;
use serde_json::{json, Value};
use std::io::Write;
use std::net::{TcpListener, TcpStream};

fn main() {
  let port: u16 = std::env::var("DEJA_E2E_PORT")
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

fn handle(stream: TcpStream) {
  // Peeked rather than read, so the MCP handler can parse the request itself.
  let mut head = [0u8; 64];
  let seen = stream.peek(&mut head).unwrap_or(0);
  let line = String::from_utf8_lossy(&head[..seen]);
  if line.split_whitespace().nth(1).is_some_and(|path| path.split('?').next().unwrap_or("").ends_with("/mcp")) {
    return deja_lib::mcp::serve(&stream);
  }
  let Some(request) = http::read(&stream) else { return };

  let payload: Value = if request.method == "GET" && request.path.ends_with("/health") {
    json!({ "ok": true })
  } else {
    let name = request.path.rsplit('/').next().unwrap_or("").to_string();
    let args: Value = serde_json::from_slice(&request.body).unwrap_or(json!({}));
    match deja_lib::dispatch(&name, &args) {
      Ok(data) => json!({ "ok": true, "data": data }),
      Err(error) => json!({ "ok": false, "error": error }),
    }
  };

  let text = serde_json::to_string(&payload).unwrap_or_else(|_| "{\"ok\":false}".into());
  http::respond(
    &stream,
    "200 OK",
    &[("Content-Type", "application/json; charset=utf-8"), ("Access-Control-Allow-Origin", "*")],
    text.as_bytes(),
  );
}
