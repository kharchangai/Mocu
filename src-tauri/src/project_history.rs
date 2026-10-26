use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use walkdir::{DirEntry, WalkDir};

#[derive(Clone)]
struct IgnoreRule {
    negated: bool,
    directory_only: bool,
    has_slash: bool,
    regex: Regex,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousFile {
    pub hash: String,
    pub size: u64,
    #[serde(default)]
    pub mtime: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub path: String,
    pub hash: String,
    pub size: u64,
    pub mtime: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChange {
    path: String,
    kind: &'static str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryChange {
    path: String,
    kind: &'static str,
    status: &'static str,
}

#[derive(Serialize)]
pub struct ScannedProject {
    pub files: Vec<ScannedFile>,
    pub directories: Vec<String>,
    pub changes: Vec<serde_json::Value>,
}

fn glob_regex(pattern: &str) -> Result<Regex, String> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut source = String::from("(?i)^");
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' => {
                if i + 1 < chars.len() && chars[i + 1] == '*' {
                    i += 1;
                    if i + 1 < chars.len() && chars[i + 1] == '/' {
                        i += 1;
                        source.push_str("(?:.*/)?");
                    } else {
                        source.push_str(".*");
                    }
                } else {
                    source.push_str("[^/]*");
                }
            }
            '?' => source.push_str("[^/]"),
            c => source.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    source.push('$');
    Regex::new(&source).map_err(|error| format!("Invalid .mocuignore rule: {error}"))
}

fn compile_rules(text: &str) -> Result<Vec<IgnoreRule>, String> {
    text.lines()
        .filter_map(|raw| {
            let mut line = raw.trim().to_string();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let negated = line.starts_with('!') && !line.starts_with("\\!");
            if negated {
                line.remove(0);
            }
            line = line.replace("\\!", "!").replace("\\#", "#");
            if line.is_empty() {
                return None;
            }
            let directory_only = line.ends_with('/');
            line = line
                .trim_start_matches('/')
                .trim_end_matches('/')
                .to_string();
            let has_slash = line.contains('/');
            Some(glob_regex(&line).map(|regex| IgnoreRule {
                negated,
                directory_only,
                has_slash,
                regex,
            }))
        })
        .collect()
}

fn ignored(relative: &str, is_directory: bool, rules: &[IgnoreRule]) -> bool {
    if relative.is_empty()
        || relative == ".mocu"
        || relative.starts_with(".mocu/")
        || relative == ".git"
        || relative.starts_with(".git/")
    {
        return true;
    }
    let segments: Vec<&str> = relative.split('/').collect();
    let mut is_ignored = false;
    for rule in rules {
        let matched = if rule.has_slash {
            rule.regex.is_match(relative)
                || (is_directory && rule.regex.is_match(&format!("{relative}/")))
                || (0..segments.len().saturating_sub(1)).any(|index| {
                    let parent = segments[..=index].join("/");
                    rule.regex.is_match(&parent) || rule.regex.is_match(&format!("{parent}/"))
                })
        } else {
            segments.iter().enumerate().any(|(index, segment)| {
                let is_parent_directory = index + 1 < segments.len() || is_directory;
                rule.regex.is_match(segment) && (!rule.directory_only || is_parent_directory)
            })
        };
        if matched {
            is_ignored = !rule.negated;
        }
    }
    is_ignored
}

fn entry_path(root: &Path, entry: &DirEntry) -> Option<String> {
    let relative = entry.path().strip_prefix(root).ok()?;
    let value = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    Some(value)
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Cannot read project file {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot hash project file {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    let hash = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((hash, size))
}

fn save_snapshot(root: &Path, snapshot_root: &Path, file: &ScannedFile) -> Result<(), String> {
    let relative = Path::new(&file.path);
    if relative.is_absolute()
        || relative.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(format!(
            "Refusing to snapshot invalid project path: {}",
            file.path
        ));
    }
    let source_path = root.join(relative);
    let target_path = snapshot_root.join(relative);
    let parent = target_path
        .parent()
        .ok_or_else(|| format!("Invalid snapshot path: {}", file.path))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Cannot create snapshot directory {}: {error}",
            parent.display()
        )
    })?;

    let mut source = File::open(&source_path).map_err(|error| {
        format!(
            "Cannot read project file {}: {error}",
            source_path.display()
        )
    })?;
    let mut target = File::create(&target_path)
        .map_err(|error| format!("Cannot write snapshot {}: {error}", target_path.display()))?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let read = source.read(&mut buffer).map_err(|error| {
            format!(
                "Cannot copy project file {}: {error}",
                source_path.display()
            )
        })?;
        if read == 0 {
            break;
        }
        target
            .write_all(&buffer[..read])
            .map_err(|error| format!("Cannot write snapshot {}: {error}", target_path.display()))?;
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    let hash = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    if hash != file.hash || size != file.size {
        let _ = fs::remove_file(&target_path);
        return Err(format!(
            "File changed while Mocu was recording it: {}",
            file.path
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn project_history_scan(
    project_path: String,
    rules_text: String,
    previous_files: HashMap<String, PreviousFile>,
    previous_directories: Vec<String>,
    snapshot_root: String,
) -> Result<ScannedProject, String> {
    // Filesystem traversal, hashing, and changed-file snapshot copies run on a
    // blocking pool; independent file reads/copies are parallelized with Rayon.
    tauri::async_runtime::spawn_blocking(move || {
        scan_project(
            &project_path,
            &rules_text,
            previous_files,
            previous_directories,
            &snapshot_root,
        )
    })
    .await
    .map_err(|error| format!("Project scan task failed: {error}"))?
}

fn scan_project(
    project_path: &str,
    rules_text: &str,
    previous_files: HashMap<String, PreviousFile>,
    previous_directories: Vec<String>,
    snapshot_root: &str,
) -> Result<ScannedProject, String> {
    let root = PathBuf::from(project_path);
    if !root.is_dir() {
        return Err(format!(
            "Project directory does not exist: {}",
            root.display()
        ));
    }
    let rules = compile_rules(rules_text)?;
    let mut directories = Vec::new();
    let mut files = Vec::new();
    let walker = WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let Some(relative) = entry_path(&root, entry) else {
                return false;
            };
            !entry.file_type().is_symlink()
                && !ignored(&relative, entry.file_type().is_dir(), &rules)
        });

    for item in walker {
        let entry = item.map_err(|error| format!("Cannot scan project directory: {error}"))?;
        if entry.depth() == 0 {
            continue;
        }
        let relative = entry_path(&root, &entry).ok_or_else(|| {
            format!(
                "Cannot determine relative path for {}",
                entry.path().display()
            )
        })?;
        if entry.file_type().is_dir() {
            directories.push(relative);
        } else if entry.file_type().is_file() {
            files.push((relative, entry.path().to_path_buf()));
        }
    }

    let hashed: Result<Vec<ScannedFile>, String> = files
        .into_par_iter()
        .map(|(relative, path)| {
            let metadata = fs::metadata(&path)
                .map_err(|error| format!("Cannot stat project file {}: {error}", path.display()))?;
            let size = metadata.len();
            let mtime = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos().to_string());
            let previous = previous_files.get(&relative);
            let unchanged_metadata = previous.is_some_and(|previous| {
                previous.size == size && mtime.is_some() && previous.mtime == mtime
            });
            let hash = if unchanged_metadata {
                previous.expect("checked above").hash.clone()
            } else {
                hash_file(&path)?.0
            };
            Ok(ScannedFile {
                path: relative,
                hash,
                size,
                mtime,
            })
        })
        .collect();
    let mut files = hashed?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    directories.sort();

    let current_paths: HashSet<&str> = files.iter().map(|file| file.path.as_str()).collect();
    let mut changes = Vec::new();
    let mut changed_files = Vec::new();
    for file in &files {
        let previous = previous_files.get(&file.path);
        if previous.is_none_or(|state| state.hash != file.hash) {
            let status = if previous.is_some() {
                "modified"
            } else {
                "added"
            };
            changes.push(
                serde_json::to_value(FileChange {
                    path: file.path.clone(),
                    kind: "file",
                    status,
                    hash: Some(file.hash.clone()),
                    size: Some(file.size),
                })
                .map_err(|error| format!("Cannot serialize file change: {error}"))?,
            );
            changed_files.push(file);
        }
    }
    for path in previous_files.keys() {
        if !current_paths.contains(path.as_str()) {
            changes.push(
                serde_json::to_value(FileChange {
                    path: path.clone(),
                    kind: "file",
                    status: "deleted",
                    hash: None,
                    size: None,
                })
                .map_err(|error| format!("Cannot serialize file change: {error}"))?,
            );
        }
    }

    let current_directories: HashSet<&str> = directories.iter().map(String::as_str).collect();
    let previous_directory_set: HashSet<&str> =
        previous_directories.iter().map(String::as_str).collect();
    for path in &directories {
        if !previous_directory_set.contains(path.as_str()) {
            changes.push(
                serde_json::to_value(DirectoryChange {
                    path: path.clone(),
                    kind: "directory",
                    status: "added",
                })
                .map_err(|error| format!("Cannot serialize directory change: {error}"))?,
            );
        }
    }
    for path in &previous_directories {
        if !current_directories.contains(path.as_str()) {
            changes.push(
                serde_json::to_value(DirectoryChange {
                    path: path.clone(),
                    kind: "directory",
                    status: "deleted",
                })
                .map_err(|error| format!("Cannot serialize directory change: {error}"))?,
            );
        }
    }
    changes.sort_by(|left, right| {
        left.get("path")
            .and_then(serde_json::Value::as_str)
            .cmp(&right.get("path").and_then(serde_json::Value::as_str))
    });

    if !changed_files.is_empty() {
        let snapshots = PathBuf::from(snapshot_root);
        let saved: Result<Vec<()>, String> = changed_files
            .into_par_iter()
            .map(|file| save_snapshot(&root, &snapshots, file))
            .collect();
        saved?;
    }

    Ok(ScannedProject {
        files,
        directories,
        changes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_gitignore_style_rules_and_internal_paths() {
        let rules = compile_rules("node_modules/\n*.log\n!keep.log\nsrc/generated/**").unwrap();
        assert!(ignored("node_modules/pkg/index.js", false, &rules));
        assert!(ignored("debug.log", false, &rules));
        assert!(!ignored("keep.log", false, &rules));
        assert!(ignored("src/generated/file.ts", false, &rules));
        assert!(ignored(".mocu/history/index.json", false, &[]));
        assert!(ignored(".git/config", false, &[]));
    }
}
