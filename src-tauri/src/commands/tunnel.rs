use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;
use tauri::State;

use crate::db::{SavedTunnel, TunnelStore};
use crate::ssh::{SshManager, SshSession};
use crate::tunnel::{TunnelConfig, TunnelInfo, TunnelManager, TunnelType};
use crate::DbPool;

/// 跨会话保持稳定的服务器标识：username@host:port。
fn server_key_of(session: &SshSession) -> String {
    let ci = &session.connect_info;
    format!("{}@{}:{}", ci.username, ci.host, ci.port)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn parse_tunnel_type(s: &str) -> Result<TunnelType, String> {
    match s.to_lowercase().as_str() {
        "local" => Ok(TunnelType::Local),
        "remote" => Ok(TunnelType::Remote),
        "dynamic" => Ok(TunnelType::Dynamic),
        _ => Err(format!("Invalid tunnel type: {}", s)),
    }
}

#[tauri::command]
pub async fn tunnel_create(
    ssh_mgr: State<'_, Arc<AsyncMutex<SshManager>>>,
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    db: State<'_, DbPool>,
    app: tauri::AppHandle,
    session_id: String,
    tunnel_type: String,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    note: String,
) -> Result<String, String> {
    // 获取 SSH 会话
    let mgr = ssh_mgr.lock().await;
    let session = mgr.get_session(&session_id)?;
    let server_key = server_key_of(&session);
    drop(mgr);

    let tt = parse_tunnel_type(&tunnel_type)?;

    let config = TunnelConfig {
        tunnel_type: tt,
        local_host: local_host.clone(),
        local_port,
        remote_host: remote_host.clone(),
        remote_port,
        note: note.clone(),
    };

    let tunnel_id = uuid::Uuid::new_v4().to_string();
    {
        let tunnel_mgr = tunnel_mgr.lock().await;
        tunnel_mgr
            .create_tunnel(tunnel_id.clone(), session_id, session, config, app, None)
            .await?;
    }

    // 持久化配置，使其在断开连接或应用重启后仍然保留。
    let conn = db.lock().map_err(|e| format!("DB lock failed: {}", e))?;
    TunnelStore::save(&conn, &SavedTunnel {
        id: tunnel_id.clone(),
        server_key,
        tunnel_type,
        local_host,
        local_port,
        remote_host,
        remote_port,
        created_at: now_ms(),
        note,
    })?;
    drop(conn);

    Ok(tunnel_id)
}

#[tauri::command]
pub async fn tunnel_close(
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    tunnel_id: String,
) -> Result<(), String> {
    // 仅停止正在运行的隧道；持久化配置保留不变（用户之后可以恢复）。
    let tunnel_mgr = tunnel_mgr.lock().await;
    tunnel_mgr.close_tunnel(&tunnel_id).await
}

#[tauri::command]
pub async fn tunnel_close_batch(
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    ids: Vec<String>,
) -> Result<(), String> {
    // 仅停止每个正在运行的隧道；持久化配置保留不变（用户之后可以恢复）。
    // 使用代码块作用域，避免非 Send 的 MutexGuard 进入任何 await 点。
    for id in &ids {
        {
            let tunnel_mgr = tunnel_mgr.lock().await;
            tunnel_mgr.close_tunnel(id).await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn tunnel_delete(
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    db: State<'_, DbPool>,
    tunnel_id: String,
) -> Result<(), String> {
    // 停止正在运行的隧道（如果存在），并永久删除持久化配置。
    {
        let tunnel_mgr = tunnel_mgr.lock().await;
        tunnel_mgr.close_tunnel(&tunnel_id).await?;
    }
    let conn = db.lock().map_err(|e| format!("DB lock failed: {}", e))?;
    TunnelStore::delete(&conn, &tunnel_id)?;
    drop(conn);
    Ok(())
}

#[tauri::command]
pub async fn tunnel_delete_batch(
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    db: State<'_, DbPool>,
    ids: Vec<String>,
) -> Result<(), String> {
    // 停止每个正在运行的隧道（如果存在），并删除对应的持久化配置。
    // 使用代码块作用域，避免非 Send 的 MutexGuard 进入任何 await 点。
    for id in &ids {
        {
            let tunnel_mgr = tunnel_mgr.lock().await;
            tunnel_mgr.close_tunnel(id).await?;
        }
        {
            let conn = db.lock().map_err(|e| format!("DB lock failed: {}", e))?;
            TunnelStore::delete(&conn, id)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn tunnel_restore(
    ssh_mgr: State<'_, Arc<AsyncMutex<SshManager>>>,
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    db: State<'_, DbPool>,
    app: tauri::AppHandle,
    session_id: String,
    tunnel_id: String,
) -> Result<(), String> {
    let mgr = ssh_mgr.lock().await;
    let session = mgr.get_session(&session_id)?;
    drop(mgr);

    let saved = {
        let conn = db.lock().map_err(|e| format!("DB lock failed: {}", e))?;
        TunnelStore::get(&conn, &tunnel_id)?
            .ok_or_else(|| "Tunnel configuration not found".to_string())?
    };

    let config = TunnelConfig {
        tunnel_type: parse_tunnel_type(&saved.tunnel_type)?,
        local_host: saved.local_host,
        local_port: saved.local_port,
        remote_host: saved.remote_host,
        remote_port: saved.remote_port,
        note: saved.note,
    };
    let created_at = saved.created_at;

    let tunnel_mgr = tunnel_mgr.lock().await;
    tunnel_mgr
        .create_tunnel(saved.id, session_id, session, config, app, Some(created_at))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn tunnel_restore_batch(
    ssh_mgr: State<'_, Arc<AsyncMutex<SshManager>>>,
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    db: State<'_, DbPool>,
    app: tauri::AppHandle,
    session_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    // 恢复每个持久化隧道；某个隧道失败会停止批量操作（已恢复的隧道继续运行）。
    // 使用代码块作用域，避免非 Send 的锁守卫进入 await 点。
    for tunnel_id in ids {
        let session = {
            let mgr = ssh_mgr.lock().await;
            mgr.get_session(&session_id)?
        };
        let saved = {
            let conn = db.lock().map_err(|e| format!("DB lock failed: {}", e))?;
            TunnelStore::get(&conn, &tunnel_id)?
                .ok_or_else(|| "Tunnel configuration not found".to_string())?
        };
        let config = TunnelConfig {
            tunnel_type: parse_tunnel_type(&saved.tunnel_type)?,
            local_host: saved.local_host,
            local_port: saved.local_port,
            remote_host: saved.remote_host,
            remote_port: saved.remote_port,
            note: saved.note,
        };
        let created_at = saved.created_at;
        {
            let tunnel_mgr = tunnel_mgr.lock().await;
            tunnel_mgr
                .create_tunnel(saved.id, session_id.clone(), session, config, app.clone(), Some(created_at))
                .await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn tunnel_list(
    ssh_mgr: State<'_, Arc<AsyncMutex<SshManager>>>,
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    db: State<'_, DbPool>,
    session_id: String,
) -> Result<String, String> {
    // 当前会话的活跃隧道
    let tunnels = tunnel_mgr.lock().await.list_tunnels().await;
    let mut result: Vec<TunnelInfo> = tunnels
        .into_iter()
        .filter(|t| t.session_id == session_id)
        .collect();

    // 同一服务器的持久化配置（除非处于活跃状态，否则状态为 "stopped"）
    let server_key = {
        let mgr = ssh_mgr.lock().await;
        let session = mgr.get_session(&session_id)?;
        server_key_of(&session)
    };
    let conn = db.lock().map_err(|e| format!("DB lock failed: {}", e))?;
    let saved = TunnelStore::list_for_server(&conn, &server_key)?;
    drop(conn);

    let active_ids: HashSet<String> = result.iter().map(|t| t.id.clone()).collect();
    for s in saved {
        if active_ids.contains(&s.id) {
            continue;
        }
        result.push(TunnelInfo {
            id: s.id,
            session_id: String::new(),
            tunnel_type: s.tunnel_type,
            local_host: s.local_host,
            local_port: s.local_port,
            remote_host: s.remote_host,
            remote_port: s.remote_port,
            status: "stopped".to_string(),
            created_at: s.created_at,
            note: s.note,
        });
    }

    // 按创建时间保持稳定排序，使启动或停止隧道不会改变其在列表中的位置
    // （状态会变化，但位置不变）。
    result.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));

    serde_json::to_string(&result).map_err(|e| format!("JSON error: {}", e))
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

#[tauri::command]
pub async fn tunnel_update_note(
    tunnel_mgr: State<'_, Arc<AsyncMutex<TunnelManager>>>,
    db: State<'_, DbPool>,
    tunnel_id: String,
    note: String,
) -> Result<(), String> {
    // 先持久化，再同步到内存中的隧道（如果处于活跃状态），
    // 确保无论隧道当前状态如何，列表都保持一致。
    {
        let conn = db.lock().map_err(|e| format!("DB lock failed: {}", e))?;
        TunnelStore::update_note(&conn, &tunnel_id, &note)?;
    }

    let tunnel_mgr = tunnel_mgr.lock().await;
    tunnel_mgr.update_note(&tunnel_id, note).await?;
    Ok(())
}
