use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use tauri::State;

use crate::ssh::SshManager;
use crate::tunnel::{TunnelConfig, TunnelManager, TunnelType};

#[tauri::command]
pub async fn tunnel_create(
    ssh_mgr: State<'_, Arc<AsyncMutex<SshManager>>>,
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    app: tauri::AppHandle,
    session_id: String,
    tunnel_type: String,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<String, String> {
    // Get the SSH session
    let mgr = ssh_mgr.lock().await;
    let session = mgr.get_session(&session_id)?;
    drop(mgr);

    // Parse tunnel type
    let tt = match tunnel_type.to_lowercase().as_str() {
        "local" => TunnelType::Local,
        "remote" => TunnelType::Remote,
        "dynamic" => TunnelType::Dynamic,
        _ => return Err(format!("Invalid tunnel type: {}", tunnel_type)),
    };

    let config = TunnelConfig {
        tunnel_type: tt,
        local_host,
        local_port,
        remote_host,
        remote_port,
    };

    let tunnel_mgr = tunnel_mgr.lock().await;
    tunnel_mgr
        .create_tunnel(session_id, session, config, app)
        .await
}

#[tauri::command]
pub async fn tunnel_close(
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    tunnel_id: String,
) -> Result<(), String> {
    let tunnel_mgr = tunnel_mgr.lock().await;
    tunnel_mgr.close_tunnel(&tunnel_id).await
}

#[tauri::command]
pub async fn tunnel_list(
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
) -> Result<String, String> {
    let tunnel_mgr = tunnel_mgr.lock().await;
    let tunnels = tunnel_mgr.list_tunnels().await;
    serde_json::to_string(&tunnels).map_err(|e| format!("JSON error: {}", e))
}

#[tauri::command]
pub async fn tunnel_get(
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    tunnel_id: String,
) -> Result<Option<String>, String> {
    let tunnel_mgr = tunnel_mgr.lock().await;
    match tunnel_mgr.get_tunnel(&tunnel_id).await {
        Some(info) => serde_json::to_string(&info)
            .map(Some)
            .map_err(|e| format!("JSON error: {}", e)),
        None => Ok(None),
    }
}
