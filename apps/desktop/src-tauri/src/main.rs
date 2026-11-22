// No console window behind the app in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpLauncherInfo {
    launcher_path: String,
    installed: bool,
}

#[tauri::command]
fn mcp_launcher_info() -> McpLauncherInfo {
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    match dir {
        Some(d) => {
            let launcher = d.join("3d-builder-mcp.exe");
            let runtime = d.join("mcp").join("node.exe");
            let server = d.join("mcp").join("dist").join("server.mjs");
            McpLauncherInfo {
                launcher_path: launcher.to_string_lossy().into_owned(),
                installed: launcher.is_file() && runtime.is_file() && server.is_file(),
            }
        }
        None => McpLauncherInfo {
            launcher_path: String::new(),
            installed: false,
        },
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![mcp_launcher_info])
        .run(tauri::generate_context!())
        .expect("the 3D-Builder window could not be started");
}
