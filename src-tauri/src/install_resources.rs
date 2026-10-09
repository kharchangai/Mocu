use std::{fs, io, path::Path};

use tauri::{AppHandle, Manager};

const INSTALL_MARKER: &str = ".mocu-install-resources-v3";

const RESOURCE_FOLDERS: [(&str, &str); 5] = [
    ("agents", "agents"),
    ("docs", "docs"),
    ("skills", "skills"),
    ("extensions-default", "extensions-default"),
    ("extension-system", "extension-system"),
];

pub fn initialize(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_data = app.path().app_data_dir()?;
    let marker = app_data.join(INSTALL_MARKER);

    // Install bundled resources only once.
    if marker.is_file() {
        return Ok(());
    }

    let bundled_resources = app.path().resource_dir()?.join("install-resources");

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

    fs::create_dir_all(&app_data)?;

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

        copy_missing_files(&source, &destination)?;
    }

    // Create the marker only after all resources have been copied successfully.
    fs::write(marker, b"Mocu install resources initialized\n")?;

    Ok(())
}

fn copy_missing_files(source: &Path, destination: &Path) -> io::Result<()> {
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
            copy_missing_files(&entry.path(), &target)?;
        } else if file_type.is_file() {
            // Preserve any files that already exist in the user's AppData folder.
            if !target.exists() {
                fs::copy(entry.path(), target)?;
            }
        }
    }

    Ok(())
}
