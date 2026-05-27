use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Manager;

const MAX_ZIP_ENTRIES: usize = 256;
const MAX_PET_JSON_BYTES: u64 = 256 * 1024;
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 200 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 100 * 1024 * 1024;
const MAX_SPRITESHEET_BYTES: usize = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_SECS: u64 = 60;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FrameAnimation {
    pub row: u32,
    pub frames: u32,
    #[serde(rename = "frameDurations")]
    pub frame_durations: Vec<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PetManifest {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub description: String,
    #[serde(rename = "spritesheetPath")]
    pub spritesheet_path: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub animations: BTreeMap<String, FrameAnimation>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProjectPet {
    #[serde(flatten)]
    pub manifest: PetManifest,
    pub dir: String,
    #[serde(rename = "spritesheetFile")]
    pub spritesheet_file: String,
}

#[derive(Debug, Deserialize)]
pub struct DebugImageReference {
    pub name: String,
    #[serde(rename = "base64")]
    pub base64_data: String,
}

#[derive(Debug, Deserialize)]
pub struct DebugGenerationInput {
    pub references: Vec<DebugImageReference>,
    pub prompt: String,
}

#[derive(Debug, Deserialize)]
pub struct GeneratedImageInput {
    #[serde(rename = "base64")]
    pub base64_data: String,
}

fn pets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let pets = data_dir.join("pets");
    fs::create_dir_all(&pets).map_err(|e| format!("Failed to create pets dir: {}", e))?;
    Ok(pets)
}

fn repo_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        let root = PathBuf::from(manifest_dir)
            .parent()
            .map(Path::to_path_buf)
            .filter(|path| path.exists());
        if let Some(root) = root {
            return Ok(root);
        }
    }

    std::env::current_dir()
        .ok()
        .filter(|path| path.join("package.json").exists())
        .or_else(|| app.path().app_data_dir().ok())
        .ok_or_else(|| "Failed to resolve project directory".to_string())
}

fn project_pets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let pets = repo_root_dir(app)?.join("pets");
    fs::create_dir_all(&pets).map_err(|e| format!("Failed to create project pets dir: {}", e))?;
    Ok(pets)
}

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let downloads = project_pets_dir(app)?.join("downloads");
    fs::create_dir_all(&downloads)
        .map_err(|e| format!("Failed to create downloads dir: {}", e))?;
    Ok(downloads)
}

fn sanitize_id(id: &str) -> Result<String, String> {
    let cleaned: String = id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if cleaned.is_empty() {
        Err("Invalid pet id".to_string())
    } else {
        Ok(cleaned)
    }
}

fn normalize_relative_path(path: &Path) -> Result<PathBuf, String> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part
                    .to_str()
                    .ok_or_else(|| "Invalid path encoding".to_string())?;
                if part.is_empty()
                    || part.contains('\0')
                    || part.contains(':')
                    || part == "__MACOSX"
                {
                    return Err("Unsafe path".to_string());
                }
                normalized.push(part);
            }
            Component::CurDir => {}
            _ => return Err("Unsafe path".to_string()),
        }
    }

    if normalized.as_os_str().is_empty() {
        Err("Unsafe empty path".to_string())
    } else {
        Ok(normalized)
    }
}

fn normalize_manifest_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Empty manifest path".to_string());
    }
    normalize_relative_path(Path::new(path))
}

fn is_ignored_zip_entry(name: &str) -> bool {
    let normalized = name.replace('\\', "/");
    normalized == "__MACOSX" || normalized.starts_with("__MACOSX/")
}

fn find_pet_json_entry(
    archive: &mut zip::ZipArchive<fs::File>,
) -> Result<(usize, Option<PathBuf>), String> {
    let mut wrapped = None;

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        if file.is_dir() || is_ignored_zip_entry(file.name()) {
            continue;
        }
        let Some(path) = file.enclosed_name() else {
            return Err("Unsafe zip path".to_string());
        };
        let path = normalize_relative_path(&path)?;

        if path == Path::new("pet.json") {
            return Ok((i, None));
        }

        if path.file_name().and_then(|name| name.to_str()) == Some("pet.json") {
            if let Some(parent) = path.parent() {
                if parent.components().count() == 1 {
                    wrapped = Some((i, parent.to_path_buf()));
                }
            }
        }
    }

    wrapped
        .map(|(index, root)| (index, Some(root)))
        .ok_or_else(|| "No pet.json found in zip".to_string())
}

fn extract_pet_zip(zip_path: &Path, dest: &Path) -> Result<PetManifest, String> {
    let result = (|| {
        let zip_file =
            fs::File::open(zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(zip_file).map_err(|e| format!("Failed to read zip: {}", e))?;

        if archive.len() > MAX_ZIP_ENTRIES {
            return Err("Pet zip has too many files".to_string());
        }

        let (pet_json_index, package_root) = find_pet_json_entry(&mut archive)?;
        let mut pet_json_content = String::new();
        {
            let mut pet_json = archive
                .by_index(pet_json_index)
                .map_err(|_| "No pet.json found in zip".to_string())?;
            if pet_json.size() > MAX_PET_JSON_BYTES {
                return Err("pet.json is too large".to_string());
            }
            let mut limited = (&mut pet_json).take(MAX_PET_JSON_BYTES + 1);
            limited
                .read_to_string(&mut pet_json_content)
                .map_err(|e| format!("Failed to read pet.json: {}", e))?;
            if pet_json_content.len() as u64 > MAX_PET_JSON_BYTES {
                return Err("pet.json is too large".to_string());
            }
        }

        let manifest: PetManifest = serde_json::from_str(&pet_json_content)
            .map_err(|e| format!("Invalid pet.json: {}", e))?;
        sanitize_id(&manifest.id)?;
        let spritesheet_path = normalize_manifest_path(&manifest.spritesheet_path)?;

        if dest.exists() {
            fs::remove_dir_all(dest)
                .map_err(|e| format!("Failed to remove existing pet temp dir: {}", e))?;
        }
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create pet dir: {}", e))?;

        let mut total_uncompressed = 0_u64;
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("Failed to read zip entry: {}", e))?;
            let name = file.name().to_string();

            if file.is_dir() || is_ignored_zip_entry(&name) {
                continue;
            }
            if file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("Zip symlinks are not supported".to_string());
            }
            if file.size() > MAX_FILE_BYTES {
                return Err(format!("Zip entry is too large: {}", name));
            }

            let Some(path) = file.enclosed_name() else {
                return Err("Unsafe zip path".to_string());
            };
            let path = normalize_relative_path(&path)?;
            let relative = match &package_root {
                Some(root) => {
                    if !path.starts_with(root) {
                        continue;
                    }
                    let stripped = path
                        .strip_prefix(root)
                        .map_err(|_| "Unsafe zip path".to_string())?;
                    if stripped.as_os_str().is_empty() {
                        continue;
                    }
                    normalize_relative_path(stripped)?
                }
                None => path,
            };

            total_uncompressed = total_uncompressed
                .checked_add(file.size())
                .ok_or_else(|| "Pet zip is too large".to_string())?;
            if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES {
                return Err("Pet zip is too large".to_string());
            }

            let out_path = dest.join(&relative);
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir: {}", e))?;
            }

            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create file: {}", e))?;
            let written = std::io::copy(&mut (&mut file).take(MAX_FILE_BYTES + 1), &mut out_file)
                .map_err(|e| format!("Failed to write file: {}", e))?;
            if written > MAX_FILE_BYTES {
                let _ = fs::remove_file(&out_path);
                return Err(format!("Zip entry is too large: {}", name));
            }
        }

        if !dest.join("pet.json").is_file() {
            return Err("pet.json was not extracted".to_string());
        }
        if !dest.join(&spritesheet_path).is_file() {
            return Err("Pet spritesheet was not found".to_string());
        }

        Ok(manifest)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(dest);
    }

    result
}

#[tauri::command]
pub fn import_pet_zip(app: AppHandle, zip_path: String) -> Result<PetManifest, String> {
    let temp = pets_dir(&app)?.join("__import_tmp");
    let manifest = extract_pet_zip(Path::new(&zip_path), &temp)?;
    let final_id = sanitize_id(&manifest.id)?;
    let dest = pets_dir(&app)?.join(&final_id);
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("Failed to remove existing pet: {}", e))?;
    }
    fs::rename(&temp, &dest).map_err(|e| format!("Failed to finalize pet import: {}", e))?;

    log::info!("Imported pet: {} ({})", manifest.display_name, manifest.id);
    Ok(manifest)
}

#[tauri::command]
pub fn import_pet_zip_to_project(app: AppHandle, zip_path: String) -> Result<ProjectPet, String> {
    let pets = project_pets_dir(&app)?;
    let tmp_name = format!(
        ".tmp-import-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    );
    let tmp = pets.join(tmp_name);
    let manifest = extract_pet_zip(Path::new(&zip_path), &tmp)?;
    let final_id = sanitize_id(&manifest.id)?;
    let dest = pets.join(&final_id);
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("Failed to replace existing pet: {}", e))?;
    }
    fs::rename(&tmp, &dest).map_err(|e| format!("Failed to finalize pet import: {}", e))?;
    project_pet_from_dir(dest)
}

#[tauri::command]
pub fn get_project_pets_dir(app: AppHandle) -> Result<String, String> {
    project_pets_dir(&app)?
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid project pets path".to_string())
}

#[tauri::command]
pub async fn download_pet_to_project(
    app: AppHandle,
    pet_id: String,
    download_url: String,
) -> Result<ProjectPet, String> {
    let pet_id = sanitize_id(&pet_id)?;
    let url = reqwest::Url::parse(&download_url)
        .map_err(|e| format!("Invalid download URL: {}", e))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Download URL must use http or https".to_string());
    }

    let zip_path = downloads_dir(&app)?.join(format!("{pet_id}.zip"));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to download pet: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_DOWNLOAD_BYTES)
    {
        return Err("Download is too large".to_string());
    }

    let download_result = (|| -> Result<fs::File, String> {
        fs::File::create(&zip_path).map_err(|e| format!("Failed to save zip: {}", e))
    })();
    let mut zip_file = match download_result {
        Ok(file) => file,
        Err(error) => return Err(error),
    };

    let mut downloaded = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?
    {
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "Download is too large".to_string())?;
        if downloaded > MAX_DOWNLOAD_BYTES {
            let _ = fs::remove_file(&zip_path);
            return Err("Download is too large".to_string());
        }
        if let Err(error) = zip_file.write_all(&chunk) {
            let _ = fs::remove_file(&zip_path);
            return Err(format!("Failed to save zip: {}", error));
        }
    }

    drop(zip_file);

    let app_for_import = app.clone();
    let pet_id_for_import = pet_id.clone();
    let zip_path_for_import = zip_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let pets = project_pets_dir(&app_for_import)?;
        let tmp = pets.join(format!(".tmp-{pet_id_for_import}"));
        let manifest = extract_pet_zip(&zip_path_for_import, &tmp)?;
        let final_id = sanitize_id(&manifest.id)?;
        let dest = pets.join(&final_id);
        if dest.exists() {
            fs::remove_dir_all(&dest)
                .map_err(|e| format!("Failed to replace existing pet: {}", e))?;
        }
        fs::rename(&tmp, &dest).map_err(|e| format!("Failed to finalize download: {}", e))?;
        project_pet_from_dir(dest)
    })
    .await
    .map_err(|e| format!("Download task failed: {}", e))?
}

fn project_pet_from_dir(dir: PathBuf) -> Result<ProjectPet, String> {
    let pet_json = dir.join("pet.json");
    let content =
        fs::read_to_string(&pet_json).map_err(|e| format!("Failed to read pet.json: {}", e))?;
    let manifest: PetManifest =
        serde_json::from_str(&content).map_err(|e| format!("Invalid pet.json: {}", e))?;
    let spritesheet_path = normalize_manifest_path(&manifest.spritesheet_path)?;
    let spritesheet = dir.join(spritesheet_path);
    Ok(ProjectPet {
        manifest,
        dir: dir.to_string_lossy().to_string(),
        spritesheet_file: spritesheet.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn list_project_pets(app: AppHandle) -> Result<Vec<ProjectPet>, String> {
    let dir = project_pets_dir(&app)?;
    let mut pets = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read pets dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read pet entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() || path.file_name().and_then(|s| s.to_str()).unwrap_or("").starts_with('.') {
            continue;
        }
        if path.join("pet.json").exists() {
            match project_pet_from_dir(path) {
                Ok(pet) => pets.push(pet),
                Err(e) => log::warn!("Skipping invalid project pet: {}", e),
            }
        }
    }
    pets.sort_by(|a, b| a.manifest.display_name.cmp(&b.manifest.display_name));
    Ok(pets)
}

#[tauri::command]
pub fn delete_project_pet(app: AppHandle, pet_id: String) -> Result<(), String> {
    let pet_id = sanitize_id(&pet_id)?;
    let pets = project_pets_dir(&app)?;
    let dir = pets.join(&pet_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Failed to delete pet: {}", e))?;
    }
    let zip = downloads_dir(&app)?.join(format!("{pet_id}.zip"));
    if zip.exists() {
        let _ = fs::remove_file(zip);
    }
    Ok(())
}

#[tauri::command]
pub fn read_project_pet_spritesheet(app: AppHandle, pet_id: String) -> Result<Vec<u8>, String> {
    let pet_id = sanitize_id(&pet_id)?;
    let dir = project_pets_dir(&app)?.join(&pet_id);
    if !dir.is_dir() {
        return Err("Pet folder was not found".to_string());
    }

    let pet_json = dir.join("pet.json");
    let content =
        fs::read_to_string(&pet_json).map_err(|e| format!("Failed to read pet.json: {}", e))?;
    let manifest: PetManifest =
        serde_json::from_str(&content).map_err(|e| format!("Invalid pet.json: {}", e))?;
    let spritesheet_path = normalize_manifest_path(&manifest.spritesheet_path)?;
    let spritesheet = dir.join(spritesheet_path);
    let bytes =
        fs::read(&spritesheet).map_err(|e| format!("Failed to read spritesheet: {}", e))?;
    if bytes.len() > MAX_SPRITESHEET_BYTES {
        return Err("Spritesheet is too large".to_string());
    }
    Ok(bytes)
}

#[tauri::command]
pub fn read_project_pet_manifest(app: AppHandle, pet_id: String) -> Result<PetManifest, String> {
    let pet_id = sanitize_id(&pet_id)?;
    let dir = project_pets_dir(&app)?.join(&pet_id);
    if !dir.is_dir() {
        return Err("Pet folder was not found".to_string());
    }

    let pet_json = dir.join("pet.json");
    let content =
        fs::read_to_string(&pet_json).map_err(|e| format!("Failed to read pet.json: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid pet.json: {}", e))
}

#[tauri::command]
pub fn save_project_pet_spritesheet(
    app: AppHandle,
    pet_id: String,
    bytes: Vec<u8>,
    animations: BTreeMap<String, FrameAnimation>,
) -> Result<ProjectPet, String> {
    if bytes.is_empty() {
        return Err("Spritesheet is empty".to_string());
    }
    if bytes.len() > MAX_SPRITESHEET_BYTES {
        return Err("Spritesheet is too large".to_string());
    }

    let pet_id = sanitize_id(&pet_id)?;
    let dir = project_pets_dir(&app)?.join(&pet_id);
    if !dir.is_dir() {
        return Err("Pet folder was not found".to_string());
    }

    let pet_json = dir.join("pet.json");
    let content =
        fs::read_to_string(&pet_json).map_err(|e| format!("Failed to read pet.json: {}", e))?;
    let mut manifest: PetManifest =
        serde_json::from_str(&content).map_err(|e| format!("Invalid pet.json: {}", e))?;

    let file_name = "spritesheet_edited.webp";
    fs::write(dir.join(file_name), bytes)
        .map_err(|e| format!("Failed to save spritesheet: {}", e))?;
    manifest.spritesheet_path = file_name.to_string();
    manifest.animations = animations;

    let next_content = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize pet.json: {}", e))?;
    fs::write(&pet_json, format!("{next_content}\n"))
        .map_err(|e| format!("Failed to update pet.json: {}", e))?;

    project_pet_from_dir(dir)
}

#[tauri::command]
pub fn open_pet_folder(app: AppHandle, pet_id: Option<String>) -> Result<(), String> {
    let path = match pet_id {
        Some(id) => project_pets_dir(&app)?.join(sanitize_id(&id)?),
        None => project_pets_dir(&app)?,
    };
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create folder: {}", e))?;

    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_project_pet_dir(app: AppHandle, pet_id: String) -> Result<String, String> {
    let dir = project_pets_dir(&app)?.join(sanitize_id(&pet_id)?);
    if !dir.exists() {
        return Err(format!("Project pet not found: {}", pet_id));
    }
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid project pet path".to_string())
}

#[tauri::command]
pub fn save_project_pet_generation_references(
    app: AppHandle,
    pet_id: String,
    input: DebugGenerationInput,
) -> Result<Vec<String>, String> {
    let dir = project_pets_dir(&app)?.join(sanitize_id(&pet_id)?);
    if !dir.exists() {
        return Err(format!("Project pet not found: {}", pet_id));
    }

    let mut saved = Vec::new();
    let prompt_path = dir.join("ai_input_prompt.txt");
    fs::write(&prompt_path, input.prompt)
        .map_err(|e| format!("Failed to write generation prompt: {e}"))?;
    saved.push(prompt_path.to_string_lossy().to_string());

    for reference in input.references {
        let name = sanitize_debug_reference_name(&reference.name)?;
        let bytes = decode_base64(&reference.base64_data)?;
        if bytes.len() > MAX_FILE_BYTES as usize {
            return Err(format!("Reference image is too large: {name}"));
        }
        let path = dir.join(name);
        fs::write(&path, bytes).map_err(|e| format!("Failed to write reference image: {e}"))?;
        saved.push(path.to_string_lossy().to_string());
    }
    Ok(saved)
}

#[tauri::command]
pub fn save_project_pet_generated_images(
    app: AppHandle,
    pet_id: String,
    images: Vec<GeneratedImageInput>,
) -> Result<Vec<String>, String> {
    let dir = project_pets_dir(&app)?.join(sanitize_id(&pet_id)?);
    if !dir.is_dir() {
        return Err(format!("Project pet not found: {}", pet_id));
    }
    if images.is_empty() {
        return Ok(Vec::new());
    }

    let pet_json = dir.join("pet.json");
    let content =
        fs::read_to_string(&pet_json).map_err(|e| format!("Failed to read pet.json: {}", e))?;
    let manifest: PetManifest =
        serde_json::from_str(&content).map_err(|e| format!("Invalid pet.json: {}", e))?;
    let name = generated_image_name_prefix(&manifest);
    let mut saved = Vec::new();

    for (index, image) in images.into_iter().enumerate() {
        let bytes = decode_base64(&image.base64_data)?;
        if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES as usize {
            return Err("Generated image is empty or too large".to_string());
        }
        let file_name = format!("{name}_{:02}.png", index + 1);
        let path = dir.join(&file_name);
        fs::write(&path, bytes).map_err(|e| format!("Failed to write generated image: {e}"))?;
        saved.push(path.to_string_lossy().to_string());
    }
    Ok(saved)
}

fn generated_image_name_prefix(manifest: &PetManifest) -> String {
    let cleaned: String = manifest
        .display_name
        .trim()
        .chars()
        .filter(|ch| !matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !ch.is_control())
        .collect::<String>()
        .trim_end_matches(&[' ', '.'][..])
        .to_string();
    if cleaned.is_empty() {
        manifest.id.clone()
    } else {
        cleaned
    }
}

fn sanitize_debug_reference_name(name: &str) -> Result<String, String> {
    let cleaned: String = name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_' || *ch == '.')
        .collect();
    if cleaned.is_empty() || !cleaned.ends_with(".png") {
        Err("Invalid debug reference filename".to_string())
    } else {
        Ok(cleaned)
    }
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut buffer = 0u32;
    let mut bits = 0u8;
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    for byte in input.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err("Invalid base64 reference image".to_string()),
        } as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_pets(app: AppHandle) -> Result<Vec<PetManifest>, String> {
    let dir = pets_dir(&app)?;
    let mut pets = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read pets dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let pet_json = entry.path().join("pet.json");
        if pet_json.exists() {
            let content =
                fs::read_to_string(&pet_json).map_err(|e| format!("Failed to read pet.json: {}", e))?;
            match serde_json::from_str::<PetManifest>(&content) {
                Ok(manifest) => pets.push(manifest),
                Err(e) => log::warn!("Skipping invalid pet at {:?}: {}", entry.path(), e),
            }
        }
    }

    Ok(pets)
}

#[tauri::command]
pub fn get_pet_dir(app: AppHandle, pet_id: String) -> Result<String, String> {
    let dir = pets_dir(&app)?.join(&pet_id);
    if !dir.exists() {
        return Err(format!("Pet not found: {}", pet_id));
    }
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid path".to_string())
}
