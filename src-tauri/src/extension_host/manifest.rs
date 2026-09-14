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
}