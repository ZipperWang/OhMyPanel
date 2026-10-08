use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use tauri::State;

use crate::ssh::SshManager;
use crate::server::{PortInfo, list_listening_ports, query_port, kill_pid};

// ===== Port Management Commands =====

/// 列出远程服务器上所有监听端口。
#[tauri::command]
pub async fn port_list(
    ssh_mgr: State<'_, Arc<AsyncMutex<SshManager>>>,
    session_id: &str,
) -> Result<Vec<PortInfo>, String> {
    let mgr = ssh_mgr.lock().await;
    let session = mgr.get_session(session_id)?;
    let cache = mgr.cache.clone();
    drop(mgr);
    list_listening_ports(&session, &cache, session_id).await
}

/// 查询远程服务器上特定端口的使用情况。
#[tauri::command]
pub async fn port_query(
    ssh_mgr: State<'_, Arc<AsyncMutex<SshManager>>>,
    session_id: &str,
    port: u16,
) -> Result<Vec<PortInfo>, String> {
    let mgr = ssh_mgr.lock().await;
    let session = mgr.get_session(session_id)?;
    let cache = mgr.cache.clone();
    drop(mgr);
    query_port(&session, &cache, session_id, port).await
}

/// 按 PID 杀死远程服务器上的进程。
#[tauri::command]
pub async fn port_kill(
    ssh_mgr: State<'_, Arc<AsyncMutex<SshManager>>>,
    session_id: &str,
    pid: i32,
    force: bool,
) -> Result<String, String> {
    let mgr = ssh_mgr.lock().await;
    let session = mgr.get_session(session_id)?;
    let cache = mgr.cache.clone();
    drop(mgr);
    let result = kill_pid(&session, pid, force).await;
    // 端口使用情况可能已变化，需使缓存失效
    cache.invalidate(session_id, &["ports"]);
    result
}
