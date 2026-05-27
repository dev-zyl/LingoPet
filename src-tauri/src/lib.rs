mod pet_import;

use serde::Serialize;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg(windows)]
use windows::{
    core::HRESULT,
    Win32::{
        Media::Audio::{
            eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
            Endpoints::IAudioMeterInformation,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
    },
};

const API_KEY_SERVICE: &str = "VibePet";
const API_KEY_ACCOUNT: &str = "pet_api_key";
#[cfg(windows)]
const RPC_E_CHANGED_MODE: HRESULT = HRESULT(0x80010106u32 as i32);
#[cfg(windows)]
const SYSTEM_AUDIO_PEAK_THRESHOLD: f32 = 0.0015;

fn api_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(API_KEY_SERVICE, API_KEY_ACCOUNT)
        .map_err(|e| format!("Failed to open credential storage: {e}"))
}

#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    api_key_entry()?
        .set_password(&key)
        .map_err(|e| format!("Failed to save API key: {e}"))
}

#[tauri::command]
fn get_api_key() -> Result<Option<String>, String> {
    match api_key_entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read API key: {error}")),
    }
}

#[tauri::command]
fn has_api_key() -> Result<bool, String> {
    get_api_key().map(|key| key.is_some())
}

#[tauri::command]
fn delete_api_key() -> Result<(), String> {
    match api_key_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to delete API key: {error}")),
    }
}

#[tauri::command]
fn move_to_trash(paths: Vec<String>) -> Result<(), String> {
    trash::delete_all(&paths).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn is_windows_system_audio_playing() -> Result<bool, String> {
    let mut should_uninitialize_com = false;
    unsafe {
        let com_result = CoInitializeEx(None, COINIT_MULTITHREADED);
        if com_result.is_ok() {
            should_uninitialize_com = true;
        } else if com_result != RPC_E_CHANGED_MODE {
            return Err(format!("Failed to initialize COM: {com_result:?}"));
        }

        let result = (|| -> windows::core::Result<bool> {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let meter: IAudioMeterInformation = device.Activate(CLSCTX_ALL, None)?;
            Ok(meter.GetPeakValue()? > SYSTEM_AUDIO_PEAK_THRESHOLD)
        })()
        .map_err(|e| format!("Failed to read system audio level: {e}"));

        if should_uninitialize_com {
            CoUninitialize();
        }

        result
    }
}

#[tauri::command]
fn is_system_audio_playing() -> Result<bool, String> {
    #[cfg(windows)]
    {
        is_windows_system_audio_playing()
    }

    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn open_manager_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("config") {
        window.show().map_err(|e| e.to_string())?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "config", WebviewUrl::App("config/index.html".into()))
        .title("VibePet Manager")
        .inner_size(1000.0, 720.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn summon_pet_window(app: tauri::AppHandle, pet_id: String) -> Result<String, String> {
    let safe_id: String = pet_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if safe_id.is_empty() {
        return Err("Invalid pet id".to_string());
    }

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let label = format!("pet-{safe_id}-{millis}");
    let window_label = label.clone();
    let schedule_label = label.clone();
    let thread_app = app.clone();

    thread::spawn(move || {
        let app_for_window = thread_app.clone();
        if let Err(error) = thread_app.run_on_main_thread(move || {
            let pet_url = format!("pet/index.html?petId={safe_id}");
            if let Err(error) = WebviewWindowBuilder::new(
                &app_for_window,
                &window_label,
                WebviewUrl::App(pet_url.into()),
            )
            .title("VibePet")
            .inner_size(192.0, 256.0)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .always_on_top(true)
            .resizable(false)
            .skip_taskbar(true)
            .build()
            {
                log::error!("Failed to summon pet window {window_label}: {error}");
            }
        }) {
            log::error!("Failed to schedule pet window {schedule_label}: {error}");
        }
    });

    Ok(label)
}

#[derive(Debug, Serialize)]
struct SummonedPetWindow {
    label: String,
    #[serde(rename = "petId")]
    pet_id: String,
}

fn pet_id_from_window_label(label: &str) -> Option<String> {
    let rest = label.strip_prefix("pet-")?;
    let (pet_id, millis) = rest.rsplit_once('-')?;
    if pet_id.is_empty() || !millis.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(pet_id.to_string())
}

#[tauri::command]
fn list_summoned_pet_windows(app: tauri::AppHandle) -> Vec<SummonedPetWindow> {
    app.webview_windows()
        .into_keys()
        .filter_map(|label| {
            pet_id_from_window_label(&label).map(|pet_id| SummonedPetWindow { label, pet_id })
        })
        .collect()
}

#[tauri::command]
fn close_summoned_pet_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if pet_id_from_window_label(&label).is_none() {
        return Err("Invalid summoned pet window label".to_string());
    }
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_all_summoned_pet_windows(app: tauri::AppHandle) -> Result<(), String> {
    for window in app.webview_windows().into_values() {
        if pet_id_from_window_label(window.label()).is_some() {
            window.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn is_primary_pet_window_visible(app: tauri::AppHandle) -> Result<bool, String> {
    match app.get_webview_window("pet") {
        Some(window) => window.is_visible().map_err(|e| e.to_string()),
        None => Ok(false),
    }
}

#[tauri::command]
fn show_primary_pet_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("pet") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_primary_pet_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("pet") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn toggle_primary_pet_window(app: tauri::AppHandle) {
    match is_primary_pet_window_visible(app.clone()) {
        Ok(true) => {
            if let Err(error) = hide_primary_pet_window(app) {
                log::error!("Failed to hide primary pet window from tray: {error}");
            }
        }
        Ok(false) => {
            if let Err(error) = show_primary_pet_window(app) {
                log::error!("Failed to show primary pet window from tray: {error}");
            }
        }
        Err(error) => log::error!("Failed to read primary pet visibility from tray: {error}"),
    }
}

fn setup_system_tray(app: &tauri::App) -> tauri::Result<()> {
    let open_manager = MenuItem::with_id(app, "open_manager", "打开管理面板", true, None::<&str>)?;
    let toggle_pet = MenuItem::with_id(app, "toggle_pet", "显示/隐藏桌宠", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit_app", "退出 VibePet", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open_manager, &toggle_pet, &separator, &quit])?;
    let icon = app.default_window_icon().cloned();

    let mut tray_builder = TrayIconBuilder::with_id("vibepet")
        .tooltip("VibePet")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_manager" => {
                if let Err(error) = open_manager_window(app.clone()) {
                    log::error!("Failed to open manager from tray: {error}");
                }
            }
            "toggle_pet" => toggle_primary_pet_window(app.clone()),
            "quit_app" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Err(error) = open_manager_window(tray.app_handle().clone()) {
                    log::error!("Failed to open manager from tray click: {error}");
                }
            }
        });

    if let Some(icon) = icon {
        tray_builder = tray_builder.icon(icon);
    }

    let tray = tray_builder.build(app)?;
    app.manage(tray);
    Ok(())
}

#[derive(Debug, Serialize)]
struct DesktopPlatform {
    id: String,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(windows)]
#[tauri::command]
fn list_desktop_platforms() -> Result<Vec<DesktopPlatform>, String> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsIconic,
        IsWindowVisible,
    };

    unsafe extern "system" fn enum_window_platform(hwnd: HWND, lparam: LPARAM) -> BOOL {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return BOOL(1);
        }

        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return BOOL(1);
        }

        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 140 || height < 80 {
            return BOOL(1);
        }

        let mut class_buf = [0u16; 128];
        let class_len = GetClassNameW(hwnd, &mut class_buf);
        let class_name = String::from_utf16_lossy(&class_buf[..class_len.max(0) as usize]);
        let ignored_classes = [
            "Progman",
            "WorkerW",
            "Shell_TrayWnd",
            "Shell_SecondaryTrayWnd",
            "SysListView32",
            "Windows.UI.Core.CoreWindow",
        ];
        if ignored_classes.iter().any(|name| class_name == *name) {
            return BOOL(1);
        }

        let text_len = GetWindowTextLengthW(hwnd);
        if text_len <= 0 {
            return BOOL(1);
        }

        let mut title_buf = vec![0u16; text_len as usize + 1];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let title = String::from_utf16_lossy(&title_buf[..title_len.max(0) as usize]);
        if title.contains("VibePet") || class_name.contains("VibePet") {
            return BOOL(1);
        }

        let platforms = &mut *(lparam.0 as *mut Vec<DesktopPlatform>);
        let index = platforms.len();
        let edge_height = 18;

        // Top border: the pet can stand on top of an open window.
        platforms.push(DesktopPlatform {
            id: format!("app-window-top-{index}"),
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.top + edge_height,
        });

        // Bottom border, inside the window chrome/content area.
        platforms.push(DesktopPlatform {
            id: format!("app-window-bottom-{index}"),
            left: rect.left,
            top: rect.bottom - edge_height,
            right: rect.right,
            bottom: rect.bottom,
        });

        BOOL(1)
    }

    unsafe {
        let mut platforms = Vec::new();
        let _ = EnumWindows(
            Some(enum_window_platform),
            LPARAM(&mut platforms as *mut Vec<DesktopPlatform> as isize),
        );
        Ok(platforms)
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn list_desktop_platforms() -> Result<Vec<DesktopPlatform>, String> {
    Ok(Vec::new())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--silent"]),
        ))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            setup_system_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pet_import::import_pet_zip,
            pet_import::import_pet_zip_to_project,
            pet_import::list_pets,
            pet_import::get_pet_dir,
            pet_import::get_project_pets_dir,
            pet_import::download_pet_to_project,
            pet_import::list_project_pets,
            pet_import::delete_project_pet,
            pet_import::read_project_pet_manifest,
            pet_import::read_project_pet_spritesheet,
            pet_import::save_project_pet_spritesheet,
            pet_import::save_project_pet_generation_references,
            pet_import::save_project_pet_generated_images,
            pet_import::open_pet_folder,
            pet_import::get_project_pet_dir,
            set_api_key,
            get_api_key,
            has_api_key,
            delete_api_key,
            move_to_trash,
            is_system_audio_playing,
            list_desktop_platforms,
            open_manager_window,
            summon_pet_window,
            list_summoned_pet_windows,
            close_summoned_pet_window,
            close_all_summoned_pet_windows,
            is_primary_pet_window_visible,
            show_primary_pet_window,
            hide_primary_pet_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
