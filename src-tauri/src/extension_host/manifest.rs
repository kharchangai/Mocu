use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub runtime: ExtensionRuntime,
    pub entry: String,

    #[serde(default)]
    pub commands: Vec<ExtensionCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionRuntime {
    Node,
    Python,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCommand {
    pub id: String,
    pub title: String,

    #[serde(default)]
    pub description: Option<String>,

    /// When true, the command streams live progress to the chat via
    /// `mocu.extension.activity` notifications while it runs.
    #[serde(default)]
    pub streaming: bool,

    /// Per-command execution timeout in seconds. Omitted -> default (900s).
    /// `0` -> no timeout (wait until the extension answers).
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}