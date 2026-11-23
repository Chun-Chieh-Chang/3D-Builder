// No console window behind the app in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::io::Write;
use std::process::{Command, Stdio};

#[tauri::command]
async fn dwg_convert(direction: String, data: String) -> Result<String, String> {
    if !["export", "import", "setup"].contains(&direction.as_str()) || data.len() > 90 * 1024 * 1024 {
        return Err("Invalid DWG conversion request".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let runtime = exe.parent().ok_or("Missing application directory")?.join("mcp");
        let mut node = runtime.join("node.exe");
        let mut script = runtime.join("dist/dwg.mjs");
        if cfg!(debug_assertions) && !script.is_file() {
            script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../mcp/dist/dwg.mjs");
            node = std::env::var_os("THREEDB_NODE").map(std::path::PathBuf::from).unwrap_or_else(|| "node".into());
        }
        if !script.is_file() { return Err("DWG runtime missing. Rebuild the desktop app (or npm run mcp:build for development).".into()); }
        let mut command = Command::new(node);
        command.arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let request = serde_json::json!({"direction": direction, "data": data}).to_string();
        let written = child.stdin.take().ok_or("Missing converter input")?.write_all(request.as_bytes());
        if let Err(e) = written {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e.to_string());
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).into_owned()); }
        String::from_utf8(output.stdout).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

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
        .invoke_handler(tauri::generate_handler![mcp_launcher_info, dwg_convert])
        .run(tauri::generate_context!())
        .expect("the 3D-Builder window could not be started");
}
