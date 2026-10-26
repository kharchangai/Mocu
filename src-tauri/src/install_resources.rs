use std::{fs, io, path::Path};

use tauri::{AppHandle, Manager};

const RESOURCE_FOLDERS: [(&str, &str); 5] = [
    ("agents", "agents"),
    ("docs", "docs"),
    ("skills", "skills"),
    ("extensions-default", "extensions-default"),
    ("extension-system", "extension-system"),
];

pub fn initialize(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_data = app.path().app_data_dir()?;
    let bundled_resources = app.path().resource_dir()?.join("install-resources");
    let app_version = app.package_info().version.to_string();

    sync_resources_for_version(&bundled_resources, &app_data, &app_version)
}

const INSTALLED_RESOURCES_VERSION_FILE: &str = ".install-resources-version";

fn sync_resources_for_version(
    bundled_resources: &Path,
    app_data: &Path,
    app_version: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let version_file = app_data.join(INSTALLED_RESOURCES_VERSION_FILE);
    if fs::read_to_string(&version_file)
        .map(|installed_version| installed_version.trim() == app_version)
        .unwrap_or(false)
    {
        return Ok(());
    }

    if !bundled_resources.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "Bundled install resources directory was not found: {}",
                bundled_resources.display()
            ),
        )
        .into());
    }

    fs::create_dir_all(app_data)?;

    for (source_name, destination_name) in RESOURCE_FOLDERS {
        let source = bundled_resources.join(source_name);
        let destination = app_data.join(destination_name);

        if !source.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!(
                    "Bundled resource folder was not found: {}",
                    source.display()
                ),
            )
            .into());
        }

        copy_bundled_files(&source, &destination, destination_name == "agents")?;
    }

    // Mark this app version only after every resource folder has synced, so an
    // interrupted/failed sync is retried on the next launch.
    fs::write(version_file, app_version)?;
    Ok(())
}

fn copy_bundled_files(
    source: &Path,
    destination: &Path,
    preserve_existing_files: bool,
) -> io::Result<()> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        // Omit local state and dependency caches from development resources,
        // matching the filtered resources used by packaged builds.
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        if file_type.is_dir()
            && ["node_modules", ".mocu", "__pycache__", "target", ".venv"]
                .contains(&name_text.as_ref())
        {
            continue;
        }
        if name_text.ends_with(".egg-info")
            || name_text.ends_with(".pyc")
            || name_text.starts_with("docs.db-")
            || name_text == "docs.db"
        {
            continue;
        }

        // Do not copy symbolic links from bundled resources.
        if file_type.is_symlink() {
            continue;
        }

        let target = destination.join(&name);

        if file_type.is_dir() {
            copy_bundled_files(&entry.path(), &target, preserve_existing_files)?;
        } else if file_type.is_file() && (!preserve_existing_files || !target.exists()) {
            // Update bundled resources only when the app version changes.
            fs::copy(entry.path(), target)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{copy_bundled_files, sync_resources_for_version, RESOURCE_FOLDERS};
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_root(test_name: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("mocu-{test_name}-{unique}"))
    }

    #[test]
    fn syncs_once_per_app_version_and_updates_when_version_changes() {
        let root = temporary_root("resource-version-test");
        let source = root.join("bundled");
        let app_data = root.join("app-data");
        for (source_name, _) in RESOURCE_FOLDERS {
            fs::create_dir_all(source.join(source_name)).unwrap();
        }
        fs::write(source.join("skills/sample.md"), "bundled v1").unwrap();
        fs::write(source.join("extensions-default/sample.txt"), "extension v1").unwrap();

        sync_resources_for_version(&source, &app_data, "1.0.0").unwrap();
        fs::write(app_data.join("skills/sample.md"), "user edit").unwrap();
        fs::write(source.join("skills/sample.md"), "bundled v2").unwrap();
        fs::write(source.join("extensions-default/sample.txt"), "extension v2").unwrap();

        // Same app version: do not overwrite user files or refresh bundled data.
        sync_resources_for_version(&source, &app_data, "1.0.0").unwrap();
        assert_eq!(
            fs::read_to_string(app_data.join("skills/sample.md")).unwrap(),
            "user edit"
        );
        assert_eq!(
            fs::read_to_string(app_data.join("extensions-default/sample.txt")).unwrap(),
            "extension v1"
        );

        // New app version: bundled files are refreshed.
        sync_resources_for_version(&source, &app_data, "1.1.0").unwrap();
        assert_eq!(
            fs::read_to_string(app_data.join("skills/sample.md")).unwrap(),
            "bundled v2"
        );
        assert_eq!(
            fs::read_to_string(app_data.join("extensions-default/sample.txt")).unwrap(),
            "extension v2"
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_existing_agents_and_seeds_new_bundled_agents() {
        let root = temporary_root("agent-seed-test");
        let source = root.join("bundled");
        let destination = root.join("app-data");

        fs::create_dir_all(source.join("Writer")).unwrap();
        fs::create_dir_all(source.join("New Agent")).unwrap();
        fs::create_dir_all(destination.join("Writer")).unwrap();
        fs::write(source.join("Writer/Writer.json"), "bundled version").unwrap();
        fs::write(
            destination.join("Writer/Writer.json"),
            "user-edited version",
        )
        .unwrap();
        fs::write(source.join("New Agent/New Agent.json"), "new default").unwrap();

        copy_bundled_files(&source, &destination, true).unwrap();

        assert_eq!(
            fs::read_to_string(destination.join("Writer/Writer.json")).unwrap(),
            "user-edited version"
        );
        assert_eq!(
            fs::read_to_string(destination.join("New Agent/New Agent.json")).unwrap(),
            "new default"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
