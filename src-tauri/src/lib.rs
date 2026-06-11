mod pet_import;

use serde::Serialize;
use std::fs;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    Emitter,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;

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

const API_KEY_SERVICE: &str = "LingoPet";
const API_KEY_ACCOUNT: &str = "pet_api_key";
const CODEXPET_API_BASE: &str = "https://codexpet.xyz";
const DEEP_LINK_INSTALL_EVENT: &str = "lingopet-install-result";
const DEEP_LINK_ACTION_IMPORT_EVENT: &str = "lingopet-action-import";
const PET_WINDOW_STATE_CHANGED_EVENT: &str = "pet-window-state-changed";
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

#[tauri::command]
fn write_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("Export file is empty".to_string());
    }
    fs::write(path, bytes).map_err(|e| format!("Failed to write export file: {e}"))
}

fn custom_tags_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(data_dir.join("custom_tags.json"))
}

#[tauri::command]
fn read_custom_tags(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = custom_tags_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| format!("Failed to read custom tags: {e}"))
}

#[tauri::command]
fn write_custom_tags(app: tauri::AppHandle, tags_json: String) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&tags_json)
        .map_err(|e| format!("Invalid custom tags JSON: {e}"))?;
    if !value.is_object() {
        return Err("Custom tags JSON must be an object".to_string());
    }
    let path = custom_tags_path(&app)?;
    fs::write(path, tags_json).map_err(|e| format!("Failed to write custom tags: {e}"))
}

#[derive(Debug, Clone)]
struct DeepLinkInstallRequest {
    slug: String,
    download_url: String,
    source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DeepLinkInstallEvent {
    status: String,
    #[serde(rename = "petId")]
    pet_id: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    message: String,
    source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DeepLinkActionImportEvent {
    #[serde(rename = "manifestUrl")]
    manifest_url: String,
    source: Option<String>,
}

fn parse_install_deep_link(raw_url: &str) -> Result<Option<DeepLinkInstallRequest>, String> {
    let url = reqwest::Url::parse(raw_url).map_err(|e| format!("Invalid deep link URL: {e}"))?;
    if url.scheme() != "lingopet" {
        return Ok(None);
    }

    let action = url
        .host_str()
        .filter(|host| !host.is_empty())
        .or_else(|| url.path().trim_start_matches('/').split('/').next())
        .unwrap_or("");
    if action != "install" {
        return Ok(None);
    }

    let mut slug = None;
    let mut download_url = None;
    let mut source = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "slug" | "petId" | "id" => slug = Some(value.to_string()),
            "url" | "downloadUrl" => download_url = Some(value.to_string()),
            "source" => source = Some(value.to_string()),
            _ => {}
        }
    }

    let slug = slug.ok_or_else(|| "Install link is missing slug".to_string())?;
    let safe_slug = sanitize_deep_link_slug(&slug)?;
    let download_url = download_url
        .unwrap_or_else(|| format!("{CODEXPET_API_BASE}/api/pets/{safe_slug}/download"));
    let parsed_download_url = reqwest::Url::parse(&download_url)
        .map_err(|e| format!("Invalid pet download URL: {e}"))?;
    if !matches!(parsed_download_url.scheme(), "http" | "https") {
        return Err("Pet download URL must use http or https".to_string());
    }

    Ok(Some(DeepLinkInstallRequest {
        slug: safe_slug,
        download_url,
        source,
    }))
}

fn parse_action_import_deep_link(raw_url: &str) -> Result<Option<DeepLinkActionImportEvent>, String> {
    let url = reqwest::Url::parse(raw_url).map_err(|e| format!("Invalid deep link URL: {e}"))?;
    if url.scheme() != "lingopet" {
        return Ok(None);
    }

    let action = url
        .host_str()
        .filter(|host| !host.is_empty())
        .or_else(|| url.path().trim_start_matches('/').split('/').next())
        .unwrap_or("");
    if action != "import-actions" {
        return Ok(None);
    }

    let mut manifest_url = None;
    let mut source = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "url" | "manifestUrl" => manifest_url = Some(value.to_string()),
            "source" => source = Some(value.to_string()),
            _ => {}
        }
    }

    let manifest_url = manifest_url.ok_or_else(|| "Action import link is missing url".to_string())?;
    let parsed_manifest_url = reqwest::Url::parse(&manifest_url)
        .map_err(|e| format!("Invalid action import manifest URL: {e}"))?;
    if parsed_manifest_url.scheme() != "https"
        && !is_dev_local_action_import_url(&parsed_manifest_url)
    {
        return Err("Action import manifest URL must use https".to_string());
    }

    Ok(Some(DeepLinkActionImportEvent {
        manifest_url,
        source,
    }))
}

fn is_dev_local_action_import_url(url: &reqwest::Url) -> bool {
    if !cfg!(debug_assertions) || url.scheme() != "http" {
        return false;
    }
    matches!(
        url.host_str(),
        Some("127.0.0.1") | Some("localhost") | Some("::1")
    )
}

fn sanitize_deep_link_slug(slug: &str) -> Result<String, String> {
    let cleaned: String = slug
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if cleaned.is_empty() {
        Err("Install link has an invalid slug".to_string())
    } else {
        Ok(cleaned)
    }
}

fn emit_deep_link_install_event(app: &tauri::AppHandle, event: DeepLinkInstallEvent) {
    if let Err(error) = app.emit(DEEP_LINK_INSTALL_EVENT, event) {
        log::warn!("Failed to emit deep link install event: {error}");
    }
}

fn emit_action_import_event(app: &tauri::AppHandle, event: DeepLinkActionImportEvent) {
    if let Err(error) = app.emit(DEEP_LINK_ACTION_IMPORT_EVENT, event) {
        log::warn!("Failed to emit action import event: {error}");
    }
}

fn handle_action_import_deep_link(app: tauri::AppHandle, raw_url: String) -> bool {
    let event = match parse_action_import_deep_link(&raw_url) {
        Ok(Some(event)) => event,
        Ok(None) => return false,
        Err(error) => {
            log::warn!("Ignoring invalid LingoPet action import deep link: {error}");
            return true;
        }
    };

    let app_for_window = app.clone();
    if let Err(error) = open_manager_window(app_for_window) {
        log::warn!("Failed to open manager window for action import deep link: {error}");
    }

    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(|| thread::sleep(Duration::from_millis(700))).await;
        emit_action_import_event(&app, event);
    });
    true
}

fn handle_install_deep_link(app: tauri::AppHandle, raw_url: String) {
    let request = match parse_install_deep_link(&raw_url) {
        Ok(Some(request)) => request,
        Ok(None) => return,
        Err(error) => {
            log::warn!("Ignoring invalid LingoPet deep link: {error}");
            return;
        }
    };

    let app_for_window = app.clone();
    if let Err(error) = open_manager_window(app_for_window) {
        log::warn!("Failed to open manager window for deep link install: {error}");
    }

    emit_deep_link_install_event(&app, DeepLinkInstallEvent {
        status: "pending".to_string(),
        pet_id: request.slug.clone(),
        display_name: None,
        message: format!("正在安装「{}」...", request.slug),
        source: request.source.clone(),
    });

    tauri::async_runtime::spawn(async move {
        let _ = tauri::async_runtime::spawn_blocking(|| thread::sleep(Duration::from_millis(700))).await;

        match pet_import::read_project_pet_manifest(app.clone(), request.slug.clone()) {
            Ok(existing) => {
                emit_deep_link_install_event(&app, DeepLinkInstallEvent {
                    status: "already-installed".to_string(),
                    pet_id: existing.id,
                    display_name: Some(existing.display_name.clone()),
                    message: format!(
                        "「{}」已经安装，已保留本地自定义内容。",
                        existing.display_name
                    ),
                    source: request.source,
                });
                return;
            }
            Err(_) => {}
        }

        match pet_import::download_pet_to_project(
            app.clone(),
            request.slug.clone(),
            request.download_url.clone(),
        )
        .await
        {
            Ok(pet) => {
                emit_deep_link_install_event(&app, DeepLinkInstallEvent {
                    status: "installed".to_string(),
                    pet_id: pet.manifest.id,
                    display_name: Some(pet.manifest.display_name.clone()),
                    message: format!("「{}」安装成功。", pet.manifest.display_name),
                    source: request.source,
                });
            }
            Err(error) => {
                emit_deep_link_install_event(&app, DeepLinkInstallEvent {
                    status: "error".to_string(),
                    pet_id: request.slug,
                    display_name: None,
                    message: format!("安装失败：{error}"),
                    source: request.source,
                });
            }
        }
    });
}

fn handle_deep_link_url(app: tauri::AppHandle, raw_url: String) {
    if handle_action_import_deep_link(app.clone(), raw_url.clone()) {
        return;
    }
    handle_install_deep_link(app, raw_url);
}

fn setup_deep_link_install_handler(app: &tauri::App) {
    let app_handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            handle_deep_link_url(app_handle.clone(), url.to_string());
        }
    });

    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                handle_deep_link_url(app.handle().clone(), url.to_string());
            }
        }
        Ok(None) => {}
        Err(error) => log::warn!("Failed to read current deep link URL: {error}"),
    }

    if let Err(error) = app.deep_link().register_all() {
        log::warn!("Failed to register deep link schemes: {error}");
    }
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
        .title("灵动宠物管理面板")
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
            .title("灵动宠物")
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
        .into_values()
        .filter_map(|window| {
            if !matches!(window.is_visible(), Ok(true)) {
                return None;
            }
            let label = window.label().to_string();
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
fn reload_primary_pet_window(app: tauri::AppHandle, pet_id: String) -> Result<(), String> {
    let safe_id: String = pet_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect();
    if safe_id.is_empty() {
        return Err("Invalid pet id".to_string());
    }

    if let Some(window) = app.get_webview_window("pet") {
        let pet_url = format!("/pet/index.html?petId={safe_id}");
        let encoded_url = serde_json::to_string(&pet_url)
            .map_err(|e| format!("Failed to encode pet url: {e}"))?;
        window
            .eval(&format!("window.location.href = {encoded_url};"))
            .map_err(|e| format!("Failed to reload primary pet window: {e}"))?;
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

fn visible_summoned_pet_window_labels(app: &tauri::AppHandle) -> Vec<String> {
    summoned_pet_window_labels_by_visibility(app, true)
}

fn hidden_summoned_pet_window_labels(app: &tauri::AppHandle) -> Vec<String> {
    summoned_pet_window_labels_by_visibility(app, false)
}

fn summoned_pet_window_labels_by_visibility(app: &tauri::AppHandle, visible: bool) -> Vec<String> {
    app.webview_windows()
        .into_values()
        .filter_map(|window| {
            if pet_id_from_window_label(window.label()).is_none() {
                return None;
            }
            match window.is_visible() {
                Ok(is_visible) if is_visible == visible => Some(window.label().to_string()),
                Ok(_) => None,
                Err(error) => {
                    log::error!(
                        "Failed to read summoned pet window visibility for {}: {error}",
                        window.label()
                    );
                    None
                }
            }
        })
        .collect()
}

fn toggle_visible_pet_windows(app: tauri::AppHandle) {
    let emit_app = app.clone();
    let primary_visible = match is_primary_pet_window_visible(app.clone()) {
        Ok(visible) => visible,
        Err(error) => {
            log::error!("Failed to read primary pet visibility from tray: {error}");
            false
        }
    };
    let visible_summoned = visible_summoned_pet_window_labels(&app);

    if primary_visible || !visible_summoned.is_empty() {
        if primary_visible {
            if let Err(error) = hide_primary_pet_window(app.clone()) {
                log::error!("Failed to hide primary pet window from tray: {error}");
            }
        }
        for label in visible_summoned {
            if let Some(window) = app.get_webview_window(&label) {
                if let Err(error) = window.hide() {
                    log::error!("Failed to hide summoned pet window {label} from tray: {error}");
                }
            }
        }
        if let Err(error) = emit_app.emit(PET_WINDOW_STATE_CHANGED_EVENT, ()) {
            log::error!("Failed to emit pet window state change from tray: {error}");
        }
        return;
    }

    let hidden_summoned = hidden_summoned_pet_window_labels(&app);
    if !hidden_summoned.is_empty() {
        for label in hidden_summoned {
            if let Some(window) = app.get_webview_window(&label) {
                if let Err(error) = window.show() {
                    log::error!("Failed to show summoned pet window {label} from tray: {error}");
                }
            }
        }
        if let Err(error) = emit_app.emit(PET_WINDOW_STATE_CHANGED_EVENT, ()) {
            log::error!("Failed to emit pet window state change from tray: {error}");
        }
        return;
    }

    if let Err(error) = show_primary_pet_window(app) {
        log::error!("Failed to show primary pet window from tray: {error}");
    }
    if let Err(error) = emit_app.emit(PET_WINDOW_STATE_CHANGED_EVENT, ()) {
        log::error!("Failed to emit pet window state change from tray: {error}");
    }
}

fn setup_system_tray(app: &tauri::App) -> tauri::Result<()> {
    let open_manager = MenuItem::with_id(app, "open_manager", "打开管理面板", true, None::<&str>)?;
    let toggle_pet = MenuItem::with_id(app, "toggle_pet", "显示/隐藏桌宠", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit_app", "退出 灵动宠物", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open_manager, &toggle_pet, &separator, &quit])?;
    let icon = app.default_window_icon().cloned();

    let mut tray_builder = TrayIconBuilder::with_id("lingopet")
        .tooltip("灵动宠物")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_manager" => {
                if let Err(error) = open_manager_window(app.clone()) {
                    log::error!("Failed to open manager from tray: {error}");
                }
            }
            "toggle_pet" => toggle_visible_pet_windows(app.clone()),
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
    kind: String,
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
        if title.contains("LingoPet") || title.contains("灵动宠物") || class_name.contains("LingoPet") || class_name.contains("灵动宠物") {
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
            kind: "platform".to_string(),
        });

        // Left border: contact only, not a standing surface.
        platforms.push(DesktopPlatform {
            id: format!("app-window-left-{index}"),
            left: rect.left,
            top: rect.top,
            right: rect.left + edge_height,
            bottom: rect.bottom,
            kind: "wall".to_string(),
        });

        // Right border: contact only, not a standing surface.
        platforms.push(DesktopPlatform {
            id: format!("app-window-right-{index}"),
            left: rect.right - edge_height,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            kind: "wall".to_string(),
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = open_manager_window(app.clone()) {
                log::warn!("Failed to focus manager window from single instance callback: {error}");
            }
        }))
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
            setup_deep_link_install_handler(app);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "config" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
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
            write_export_file,
            read_custom_tags,
            write_custom_tags,
            is_system_audio_playing,
            list_desktop_platforms,
            open_manager_window,
            summon_pet_window,
            list_summoned_pet_windows,
            close_summoned_pet_window,
            close_all_summoned_pet_windows,
            is_primary_pet_window_visible,
            show_primary_pet_window,
            reload_primary_pet_window,
            hide_primary_pet_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
