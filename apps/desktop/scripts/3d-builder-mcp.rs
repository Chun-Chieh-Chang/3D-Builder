use std::env;
use std::process::{Command, ExitCode, Stdio};

fn main() -> ExitCode {
    let exe = match env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("3d-builder-mcp: cannot resolve executable path: {e}");
            return ExitCode::from(1);
        }
    };
    let dir = match exe.parent() {
        Some(d) => d,
        None => {
            eprintln!("3d-builder-mcp: executable has no parent directory");
            return ExitCode::from(1);
        }
    };

    let mcp_dir = dir.join("mcp");
    let node_exe = mcp_dir.join("node.exe");
    let server_mjs = mcp_dir.join("dist").join("server.mjs");

    if !node_exe.is_file() || !server_mjs.is_file() {
        eprintln!(
            "3d-builder-mcp: bundled MCP runtime missing (expected {} and {})",
            node_exe.display(),
            server_mjs.display()
        );
        return ExitCode::from(1);
    }

    let status = Command::new(&node_exe)
        .arg(&server_mjs)
        .args(env::args_os().skip(1))
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status();

    match status {
        Ok(s) => ExitCode::from(s.code().unwrap_or(1) as u8),
        Err(e) => {
            eprintln!("3d-builder-mcp: failed to start {}: {e}", node_exe.display());
            ExitCode::from(1)
        }
    }
}
