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

    /// Declared extension capabilities; the UI host checks these for host APIs.
    #[serde(default)]
    pub permissions: Vec<String>,

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

    /// Allows the command to request user interaction in Mocu chat.
    #[serde(default)]
    pub interactive: bool,

    /// Per-command execution timeout in seconds. Omitted -> default (900s).
    /// `0` -> no timeout (wait until the extension answers).
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::ExtensionManifest;

    #[test]
    fn deserializes_agent_permission() {
        let manifest: ExtensionManifest = serde_json::from_value(serde_json::json!({
            "id": "com.example.agent-extension",
            "name": "Agent extension",
            "description": "Calls saved agents",
            "version": "1.0.0",
            "runtime": "node",
            "entry": "index.js",
            "permissions": ["agents.invoke"]
        }))
        .expect("manifest should deserialize");

        assert_eq!(manifest.permissions, ["agents.invoke"]);
    }

    #[test]
    fn defaults_permissions_for_older_manifests() {
        let manifest: ExtensionManifest = serde_json::from_value(serde_json::json!({
            "id": "com.example.legacy-extension",
            "name": "Legacy extension",
            "description": "Does not declare permissions",
            "version": "1.0.0",
            "runtime": "node",
            "entry": "index.js"
        }))
        .expect("legacy manifest should deserialize");

        assert!(manifest.permissions.is_empty());
    }
}
