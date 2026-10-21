use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

pub const LOG_FILE_NAME: &str = "mocu-extension.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const MAX_ENTRY_BYTES: usize = 16 * 1024;

/// Appends structured, bounded diagnostics to the installed extension folder.
/// Clones share a lock so process output and command lifecycle entries cannot
/// interleave or rotate the log concurrently.
#[derive(Clone)]
pub struct ExtensionLogger {
    extension_id: String,
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl ExtensionLogger {
    pub fn new(extension_id: impl Into<String>, extension_root: PathBuf) -> Self {
        Self {
            extension_id: extension_id.into(),
            path: extension_root.join(LOG_FILE_NAME),
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// Log writing is best-effort: diagnostic failures must never prevent an
    /// extension command from running or returning its own result.
    pub fn log(&self, level: &str, event: &str, details: Value) {
        let Ok(_guard) = self.lock.lock() else {
            eprintln!(
                "[mocu] Extension '{}' diagnostic log lock is poisoned",
                self.extension_id
            );
            return;
        };

        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let entry = json!({
            "timestampUnixMs": timestamp_ms,
            "level": level,
            "event": event,
            "extensionId": self.extension_id,
            "details": sanitize_value(details),
        });

        let mut line = match serde_json::to_vec(&entry) {
            Ok(line) => line,
            Err(error) => {
                eprintln!("[mocu] Could not serialize extension diagnostic log entry: {error}");
                return;
            }
        };
        if line.len() > MAX_ENTRY_BYTES {
            line.truncate(MAX_ENTRY_BYTES - 1);
            // Truncation may cut JSON, so replace the oversized record with a
            // valid compact entry rather than writing malformed JSONL.
            line = serde_json::to_vec(&json!({
                "timestampUnixMs": timestamp_ms,
                "level": "warning",
                "event": "diagnostic_entry_truncated",
                "extensionId": self.extension_id,
            }))
            .unwrap_or_default();
        }
        line.push(b'\n');

        if let Err(error) = self.append_line(&line) {
            eprintln!(
                "[mocu] Could not write extension '{}' diagnostics to {}: {error}",
                self.extension_id,
                self.path.display()
            );
        }
    }

    fn append_line(&self, line: &[u8]) -> std::io::Result<()> {
        if let Ok(metadata) = fs::symlink_metadata(&self.path) {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "diagnostic log path is not a regular file",
                ));
            }

            if metadata.len().saturating_add(line.len() as u64) > MAX_LOG_BYTES {
                let backup = self.path.with_file_name(format!("{LOG_FILE_NAME}.1"));
                match fs::remove_file(&backup) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error),
                }
                fs::rename(&self.path, backup)?;
            }
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(line)
    }
}

fn sanitize_value(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(redact_secret_assignments(text)),
        Value::Array(values) => Value::Array(values.into_iter().map(sanitize_value).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .map(|(key, value)| {
                    let sensitive = [
                        "api_key",
                        "apikey",
                        "api-key",
                        "token",
                        "password",
                        "secret",
                        "authorization",
                    ]
                    .iter()
                    .any(|marker| key.to_ascii_lowercase().contains(marker));
                    let value = if sensitive {
                        Value::String("[REDACTED]".into())
                    } else {
                        sanitize_value(value)
                    };
                    (key, value)
                })
                .collect(),
        ),
        other => other,
    }
}

fn redact_secret_assignments(mut text: String) -> String {
    for marker in [
        "api_key",
        "apikey",
        "api-key",
        "token",
        "password",
        "secret",
        "authorization",
    ] {
        let mut search_from = 0;
        loop {
            let lower = text.to_ascii_lowercase();
            if search_from >= lower.len() {
                break;
            }
            let Some(relative) = lower[search_from..].find(marker) else {
                break;
            };
            let start = search_from + relative;
            let after_marker = start + marker.len();
            let Some(delimiter_offset) = text[after_marker..].find(['=', ':']) else {
                search_from = after_marker;
                continue;
            };
            let value_start = after_marker + delimiter_offset + 1;
            let value_end = text[value_start..]
                .find(|character: char| {
                    character.is_whitespace()
                        || character == ','
                        || character == ';'
                        || character == '}'
                        || character == '"'
                })
                .map(|offset| value_start + offset)
                .unwrap_or(text.len());
            text.replace_range(value_start..value_end, "[REDACTED]");
            search_from = value_start + "[REDACTED]".len();
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::{redact_secret_assignments, sanitize_value, ExtensionLogger};
    use serde_json::json;
    use std::{fs, path::PathBuf};

    #[test]
    fn writes_structured_jsonl_entries() {
        let unique = format!(
            "mocu-extension-log-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        fs::create_dir_all(&root).unwrap();

        let logger = ExtensionLogger::new("com.example.test", PathBuf::from(&root));
        logger.log("info", "command_started", json!({ "command": "hello" }));

        let contents = fs::read_to_string(root.join(super::LOG_FILE_NAME)).unwrap();
        let entry: serde_json::Value = serde_json::from_str(contents.trim()).unwrap();
        assert_eq!(entry["extensionId"], "com.example.test");
        assert_eq!(entry["event"], "command_started");
        assert_eq!(entry["details"]["command"], "hello");

        assert_eq!(
            sanitize_value(json!({ "access_token": "top-secret", "message": "api_key=hidden" })),
            json!({ "access_token": "[REDACTED]", "message": "api_key=[REDACTED]" })
        );
        assert_eq!(
            redact_secret_assignments("TOKEN=abc API_KEY:xyz".into()),
            "TOKEN=[REDACTED] API_KEY:[REDACTED]"
        );
    }
}
