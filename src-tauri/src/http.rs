// The least HTTP/1.1 a local client needs: one request per connection, a
// Content-Length body, no chunking. Shared by the MCP server and the e2e
// backend, which only ever talk to processes on this machine.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;

/// Bodies past this are refused; nothing local sends more than a few KB.
const MAX_BODY: usize = 8 * 1024 * 1024;

pub struct Request {
  pub method: String,
  pub path: String,
  /// Names lowercased.
  pub headers: Vec<(String, String)>,
  pub body: Vec<u8>,
}

impl Request {
  pub fn header(&self, name: &str) -> Option<&str> {
    self.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
  }
}

pub fn read(stream: &TcpStream) -> Option<Request> {
  let mut reader = BufReader::new(stream.try_clone().ok()?);
  let mut line = String::new();
  reader.read_line(&mut line).ok()?;
  let mut parts = line.split_whitespace();
  let method = parts.next()?.to_string();
  let path = parts.next()?.to_string();
  let mut headers = Vec::new();
  loop {
    let mut header = String::new();
    if reader.read_line(&mut header).unwrap_or(0) == 0 || header.trim().is_empty() {
      break;
    }
    if let Some((name, value)) = header.split_once(':') {
      headers.push((name.trim().to_ascii_lowercase(), value.trim().to_string()));
    }
  }
  let length: usize = headers
    .iter()
    .find(|(name, _)| name == "content-length")
    .and_then(|(_, value)| value.parse().ok())
    .unwrap_or(0);
  if length > MAX_BODY {
    return None;
  }
  let mut body = vec![0u8; length];
  reader.read_exact(&mut body).ok()?;
  Some(Request { method, path, headers, body })
}

pub fn respond(mut stream: &TcpStream, status: &str, headers: &[(&str, &str)], body: &[u8]) {
  let mut head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
  for (name, value) in headers {
    head.push_str(&format!("{name}: {value}\r\n"));
  }
  head.push_str("\r\n");
  let _ = stream.write_all(head.as_bytes());
  let _ = stream.write_all(body);
  let _ = stream.flush();
}
