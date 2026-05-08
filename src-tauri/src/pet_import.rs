use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use tauri::AppHandle;

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

#[tauri::command]
pub fn import_pet_zip(app: AppHandle, zip_path: String) -> Result<PetManifest, String> {
    let zip_file =
        fs::File::open(&zip_path).map_err(|e| format!("Failed to open zip: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|e| format!("Failed to read zip: {}", e))?;

    // Read pet.json from zip to get the pet id
    let mut pet_json_content = String::new();
    {
        let mut pet_json = archive
            .by_name("pet.json")
            .map_err(|_| "No pet.json found in zip".to_string())?;
        pet_json
            .read_to_string(&mut pet_json_content)
            .map_err(|e| format!("Failed to read pet.json: {}", e))?;
    }

    let manifest: PetManifest =
        serde_json::from_str(&pet_json_content).map_err(|e| format!("Invalid pet.json: {}", e))?;

    let dest = pets_dir(&app)?.join(&manifest.id);
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("Failed to remove existing pet: {}", e))?;
    }
    fs::create_dir_all(&dest).map_err(|e| format!("Failed to create pet dir: {}", e))?;

    // Extract all files
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let name = file.name().to_string();

        // Skip directories and __MACOSX
        if name.ends_with('/') || name.starts_with("__MACOSX") {
            continue;
        }

        // Strip top-level directory if present (e.g., "xiaoxin/pet.json" -> "pet.json")
        let relative = if let Some(pos) = name.find('/') {
            &name[pos + 1..]
        } else {
            &name
        };

        if relative.is_empty() {
            continue;
        }

        let out_path = dest.join(relative);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create dir: {}", e))?;
        }

        let mut out_file =
            fs::File::create(&out_path).map_err(|e| format!("Failed to create file: {}", e))?;
        std::io::copy(&mut file, &mut out_file)
            .map_err(|e| format!("Failed to write file: {}", e))?;
    }

    log::info!("Imported pet: {} ({})", manifest.display_name, manifest.id);
    Ok(manifest)
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
