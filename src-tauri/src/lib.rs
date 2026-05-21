mod pet_import;

use serde::Serialize;
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn move_to_trash(paths: Vec<String>) -> Result<(), String> {
    trash::delete_all(&paths).map_err(|e| e.to_string())
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
    use std::ffi::c_void;
    use std::mem::size_of;
    use windows::core::{w, BOOL};
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT, WPARAM};
    use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    use windows::Win32::System::Memory::{
        VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
    };
    use windows::Win32::UI::Controls::{LVM_GETITEMCOUNT, LVM_GETITEMPOSITION};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetWindowRect,
        GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SendMessageW,
    };

    unsafe fn find_desktop_list_view() -> Option<HWND> {
        let progman = FindWindowW(w!("Progman"), None).ok()?;
        let shell = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None).ok();
        if let Some(shell) = shell {
            if let Ok(list) = FindWindowExW(Some(shell), None, w!("SysListView32"), None) {
                if !list.is_invalid() {
                    return Some(list);
                }
            }
        }

        let mut worker_after: Option<HWND> = None;
        loop {
            let worker = match FindWindowExW(None, worker_after, w!("WorkerW"), None) {
                Ok(hwnd) if !hwnd.is_invalid() => hwnd,
                _ => break,
            };
            worker_after = Some(worker);
            let shell = FindWindowExW(Some(worker), None, w!("SHELLDLL_DefView"), None).ok();
            if let Some(shell) = shell {
                if let Ok(list) = FindWindowExW(Some(shell), None, w!("SysListView32"), None) {
                    if !list.is_invalid() {
                        return Some(list);
                    }
                }
            }
        }

        None
    }

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
        if text_len <= 0 || class_name.contains("VibePet") {
            return BOOL(1);
        }

        let platforms = &mut *(lparam.0 as *mut Vec<DesktopPlatform>);
        let index = platforms.len();
        platforms.push(DesktopPlatform {
            id: format!("app-window-{index}"),
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.top + 18,
        });

        BOOL(1)
    }

    unsafe {
        let mut platforms = Vec::new();
        let Some(list_view) = find_desktop_list_view() else {
            let _ = EnumWindows(
                Some(enum_window_platform),
                LPARAM(&mut platforms as *mut Vec<DesktopPlatform> as isize),
            );
            return Ok(platforms);
        };

        let mut pid = 0u32;
        GetWindowThreadProcessId(list_view, Some(&mut pid));
        if pid == 0 {
            return Ok(Vec::new());
        }

        let process = OpenProcess(
            PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE,
            false,
            pid,
        )
        .map_err(|e| format!("Failed to open desktop process: {e}"))?;

        let remote_point = VirtualAllocEx(
            process,
            None,
            size_of::<POINT>(),
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        );
        if remote_point.is_null() {
            let _ = CloseHandle(process);
            return Err("Failed to allocate desktop memory".to_string());
        }

        let item_count = SendMessageW(list_view, LVM_GETITEMCOUNT, Some(WPARAM(0)), Some(LPARAM(0))).0 as i32;
        let mut list_rect = RECT::default();
        let _ = GetWindowRect(list_view, &mut list_rect);

        for index in 0..item_count.min(512) {
            let ok = SendMessageW(
                list_view,
                LVM_GETITEMPOSITION,
                Some(WPARAM(index as usize)),
                Some(LPARAM(remote_point as isize)),
            )
            .0;
            if ok == 0 {
                continue;
            }

            let mut point = POINT::default();
            let mut bytes_read = 0usize;
            let read_ok = ReadProcessMemory(
                process,
                remote_point,
                &mut point as *mut POINT as *mut c_void,
                size_of::<POINT>(),
                Some(&mut bytes_read),
            )
            .is_ok();
            if !read_ok || bytes_read != size_of::<POINT>() {
                continue;
            }

            let left = list_rect.left + point.x;
            let top = list_rect.top + point.y;
            platforms.push(DesktopPlatform {
                id: format!("desktop-icon-{index}"),
                left: left - 8,
                top: top - 4,
                right: left + 84,
                bottom: top + 96,
            });
        }

        let _ = VirtualFreeEx(process, remote_point, 0, MEM_RELEASE);
        let _ = CloseHandle(process);
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pet_import::import_pet_zip,
            pet_import::list_pets,
            pet_import::get_pet_dir,
            move_to_trash,
            list_desktop_platforms,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
