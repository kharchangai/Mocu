//! Durable records for long-running extension commands.
//!
//! Some extension commands (notably the pi bridge `ask`) run for many
//! minutes. While they run, the whole agent loop lives in the frontend
//! webview — if that webview reloads or crashes, the pending Tauri invoke
//! callback is lost and the extension's final result would never reach the
//! chat, even though the extension process keeps working on the Rust side.
//!
//! To survive that, every agent-initiated extension command gets a job id.
//! The manager records `running` before waiting and the final outcome
//! (`completed` / `failed` / `timeout`) afterwards, and persists the store
//! to disk. After a reload the frontend can query a job, wait for it to
//! finish, and append the recovered result to the conversation.

use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// One tracked extension command execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub job_id: String,
    pub extension_id: String,
    pub command: String,
    /// `running` | `completed` | `failed` | `timeout`
    pub status: String,
    /// Extension output when `completed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// Error message when `failed` or `timeout`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<u64>,
}

/// In-memory job table mirrored into a JSON file under the app data dir.
pub struct JobStore {
    jobs: Mutex<HashMap<String, JobRecord>>,
    /// Resolved lazily on first use (needs an `AppHandle`).
    dir: OnceLock<PathBuf>,
}

impl Default for JobStore {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            dir: OnceLock::new(),
        }
    }
}

impl JobStore {
    fn persist(&self, jobs: &HashMap<String, JobRecord>) {
        let Some(dir) = self.dir.get() else {
            return;
        };

        let Ok(snapshot) = serde_json::to_string(&jobs.values().collect::<Vec<_>>()) else {
            return;
        };

        let _ = fs::create_dir_all(dir);
        let _ = fs::write(dir.join("extension-jobs.json"), snapshot);
    }

    /// Resolve (once) the directory used for persistence.
    pub fn ensure_dir(&self, app_handle: &AppHandle) {
        if self.dir.get().is_some() {
            return;
        }

        if let Ok(dir) = app_handle.path().app_data_dir() {
            let _ = self.dir.set(dir);
        }
    }

    /// Record that a job started waiting for its extension command.
    pub fn begin(
        &self,
        app_handle: &AppHandle,
        job_id: &str,
        extension_id: &str,
        command: &str,
    ) {
        self.ensure_dir(app_handle);

        let Ok(mut jobs) = self.jobs.lock() else {
            return;
        };

        jobs.insert(
            job_id.to_string(),
            JobRecord {
                job_id: job_id.to_string(),
                extension_id: extension_id.to_string(),
                command: command.to_string(),
                status: "running".to_string(),
                result: None,
                error: None,
                started_at: now_millis(),
                completed_at: None,
            },
        );

        self.persist(&jobs);
    }

    /// Record the final outcome of a job.
    pub fn finish(
        &self,
        job_id: &str,
        status: &str,
        result: Option<Value>,
        error: Option<String>,
    ) {
        let Ok(mut jobs) = self.jobs.lock() else {
            return;
        };

        if let Some(record) = jobs.get_mut(job_id) {
            record.status = status.to_string();
            record.result = result;
            record.error = error;
            record.completed_at = Some(now_millis());

            self.persist(&jobs);
        }
    }

    /// Read a job without removing it.
    pub fn get(&self, job_id: &str) -> Option<JobRecord> {
        self.jobs.lock().ok()?.get(job_id).cloned()
    }

    /// Read a job and remove it from the store.
    pub fn take(&self, job_id: &str) -> Option<JobRecord> {
        let mut jobs = self.jobs.lock().ok()?;
        let record = jobs.remove(job_id);

        if record.is_some() {
            self.persist(&jobs);
        }

        record
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
