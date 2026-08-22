use crate::{DbPool, config::{ConfigManager, Connection, Settings, SettingsManager, Favorite, FavoritesManager}};
use crate::ssh::SshManager;
use std::sync::Arc;
use tokio::sync::Mutex as AsyncMutex;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDeleteResult {
    pub remote_key_revoked: bool,
    pub warning: Option<String>,
}

// ponytail: 按需清理代理环境变量，以便更新器在无代理时重试
#[tauri::command]
pub fn clear_proxy_env() {
    for var in ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"] {
        std::env::remove_var(var);
    }
}

// ===== Config Commands =====

#[tauri::command]
pub fn config_list(db: tauri::State<'_, DbPool>) -> Vec<Connection> {
    let conn = db.lock().unwrap();
    ConfigManager::list(&conn)
}

#[tauri::command]
pub fn config_save(db: tauri::State<'_, DbPool>, connection: Connection) -> Result<(), String> {
    let conn = db.lock().unwrap();
    ConfigManager::save(&conn, &connection)
}

#[tauri::command]
pub async fn config_delete(
    ssh_mgr: tauri::State<'_, Arc<AsyncMutex<SshManager>>>,
    db: tauri::State<'_, DbPool>,
    id: &str,
) -> Result<ConfigDeleteResult, String> {
    let connection = {
        let conn = db.lock().map_err(|_| "Connection database is unavailable".to_string())?;
        ConfigManager::get(&conn, id)?
            .ok_or_else(|| "Connection not found".to_string())?
    };

    let mut remote_key_revoked = false;
    let mut warning = None;
    if connection.auth_type.starts_with("managed_") {
        let expected = crate::db::db_dir().join("keys").join(format!("{}.ed25519", id));
        let managed_key = connection
            .key_path
            .as_deref()
            .filter(|path| std::path::Path::new(path) == expected)
            .and_then(|path| crate::ssh::load_secret_key_protected(path).ok());
        let session = {
            let manager = ssh_mgr.lock().await;
            manager.get_session_for_connection(id)
        };

        match (managed_key, session) {
            (Some(key), Some(session)) => {
                let mut public_key = key.public_key().clone();
                public_key.set_comment(format!("ohmypanel:{}", id));
                let public_key = public_key
                    .to_openssh()
                    .map_err(|e| format!("Failed to encode managed public key: {e}"))?;
                crate::server::remove_ssh_pubkey(&session, &public_key).await?;
                remote_key_revoked = true;
            }
            (None, _) => {
                warning = Some(
                    "The managed private key is missing or has an unexpected path, so the matching remote authorized_keys entry could not be revoked."
                        .to_string(),
                );
            }
            (_, None) => {
                warning = Some(
                    "No active SSH session was available. The local managed key was deleted, but its remote authorized_keys entry could not be revoked."
                        .to_string(),
                );
            }
        }
    }

    {
        let conn = db.lock().map_err(|_| "Connection database is unavailable".to_string())?;
        ConfigManager::delete(&conn, id)?;
    }
    Ok(ConfigDeleteResult { remote_key_revoked, warning })
}

#[tauri::command]
pub fn config_save_credentials(
    db: tauri::State<'_, DbPool>,
    id: String,
    username: String,
    auth_type: String,
    key_path: Option<String>,
    password: Option<String>,
    remember_me: bool,
) -> Result<(), String> {
    let conn = db.lock().unwrap();
    ConfigManager::save_credentials(&conn, &id, &username, &auth_type, key_path.as_deref(), password.as_deref(), remember_me)
}

// ===== Settings Commands =====

#[tauri::command]
pub fn settings_load(db: tauri::State<'_, DbPool>) -> Settings {
    let conn = db.lock().unwrap();
    SettingsManager::load(&conn)
}

#[tauri::command]
pub fn settings_save(db: tauri::State<'_, DbPool>, settings: Settings) -> Result<(), String> {
    let conn = db.lock().unwrap();
    SettingsManager::save(&conn, &settings)
}

// ===== Favorites Commands =====

#[tauri::command]
pub fn favorites_list(db: tauri::State<'_, DbPool>) -> Vec<Favorite> {
    let conn = db.lock().unwrap();
    FavoritesManager::list(&conn)
}

#[tauri::command]
pub fn favorites_add(db: tauri::State<'_, DbPool>, favorite: Favorite) -> Result<(), String> {
    let conn = db.lock().unwrap();
    FavoritesManager::add(&conn, &favorite)
}

#[tauri::command]
pub fn favorites_remove(db: tauri::State<'_, DbPool>, path: &str) -> Result<(), String> {
    let conn = db.lock().unwrap();
    FavoritesManager::remove(&conn, path)
}

// ===== Data Directory Commands =====

/// 获取本地 SQLite 数据目录（存储连接、设置、缓存等）
#[tauri::command]
pub fn get_data_dir() -> String {
    crate::db::db_dir().to_string_lossy().to_string()
}

/// 在系统文件资源管理器中打开本地 SQLite 数据目录
#[tauri::command]
pub fn open_data_dir() -> Result<(), String> {
    let dir = crate::db::db_dir();
    open::that(&dir).map_err(|e| format!("Failed to open directory: {}", e))
}
