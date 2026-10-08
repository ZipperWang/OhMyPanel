use rusqlite::Connection as SqliteConn;
use rusqlite::params;
use serde::{Deserialize, Serialize};

// ===== Connection =====

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(skip_serializing)]
    pub password: Option<String>,
    #[serde(default)]
    pub remember_me: bool,
}

pub struct ConfigManager;

impl ConfigManager {
    fn hydrate_password(conn: &SqliteConn, connection: &mut Connection) {
        let legacy = connection.password.take().filter(|password| !password.is_empty());
        if let Some(password) = legacy {
            match crate::credentials::set_connection_password(&connection.id, &password) {
                Ok(()) => {
                    if let Err(error) = conn.execute(
                        "UPDATE connections SET password = NULL WHERE id = ?1",
                        params![connection.id],
                    ) {
                        log::warn!("Failed to clear migrated SSH password from SQLite: {}", error);
                    }
                }
                Err(error) => log::warn!("Failed to migrate SSH password to secure storage: {}", error),
            }
            connection.password = Some(password);
            return;
        }

        match crate::credentials::get_connection_password(&connection.id) {
            Ok(password) => connection.password = password,
            Err(error) => log::warn!("Failed to read SSH password from secure storage: {}", error),
        }
    }

    pub fn get(conn: &SqliteConn, id: &str) -> Result<Option<Connection>, String> {
        let mut stmt = conn
            .prepare("SELECT id, name, host, port, username, auth_type, key_path, password, remember_me FROM connections WHERE id = ?1")
            .map_err(|e| format!("Prepare connection query failed: {}", e))?;
        let result = stmt.query_row(params![id], |row| {
            Ok(Connection {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, i64>(3)? as u16,
                username: row.get(4)?,
                auth_type: row.get(5)?,
                key_path: row.get(6)?,
                password: row.get(7)?,
                remember_me: row.get::<_, Option<i64>>(8)?.map(|v| v == 1).unwrap_or(false),
            })
        });
        match result {
            Ok(mut connection) => {
                Self::hydrate_password(conn, &mut connection);
                Ok(Some(connection))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Read connection failed: {}", e)),
        }
    }

    pub fn list(conn: &SqliteConn) -> Vec<Connection> {
        let mut stmt = conn
            .prepare("SELECT id, name, host, port, username, auth_type, key_path, password, remember_me FROM connections ORDER BY name")
            .expect("prepare connections list");
        let mut connections: Vec<Connection> = stmt.query_map([], |row| {
            Ok(Connection {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, i64>(3)? as u16,
                username: row.get(4)?,
                auth_type: row.get(5)?,
                key_path: row.get(6)?,
                password: row.get(7)?,
                remember_me: row.get::<_, Option<i64>>(8)?.map(|v| v == 1).unwrap_or(false),
            })
        })
        .expect("query connections")
        .filter_map(|r| r.ok())
        .collect();
        drop(stmt);
        for connection in &mut connections {
            Self::hydrate_password(conn, connection);
        }
        connections
    }

    pub fn save(conn: &SqliteConn, c: &Connection) -> Result<(), String> {
        let existing_legacy = conn
            .query_row(
                "SELECT password FROM connections WHERE id = ?1",
                params![c.id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap_or(None)
            .filter(|password| !password.is_empty());

        if !c.remember_me {
            crate::credentials::delete_connection_password(&c.id)?;
        } else if let Some(password) = c.password.as_deref().filter(|password| !password.is_empty()) {
            crate::credentials::set_connection_password(&c.id, password)?;
        } else if let Some(password) = existing_legacy.as_deref() {
            crate::credentials::set_connection_password(&c.id, password)?;
        }

        conn.execute(
            "INSERT OR REPLACE INTO connections (id, name, host, port, username, auth_type, key_path, password, remember_me) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![c.id, c.name, c.host, c.port as i64, c.username, c.auth_type, c.key_path, Option::<String>::None, if c.remember_me { 1 } else { 0 }],
        ).map_err(|e| format!("Save connection failed: {}", e))?;
        Ok(())
    }

    pub fn delete(conn: &SqliteConn, id: &str) -> Result<(), String> {
        let managed_key_path = conn
            .query_row(
                "SELECT auth_type, key_path FROM connections WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .ok()
            .and_then(|(auth_type, key_path)| auth_type.starts_with("managed_").then_some(key_path).flatten());
        crate::credentials::delete_connection_password(id)?;
        conn.execute("DELETE FROM connections WHERE id = ?1", params![id])
            .map_err(|e| format!("Delete connection failed: {}", e))?;
        if let Some(key_path) = managed_key_path {
            let expected = crate::db::db_dir().join("keys").join(format!("{}.ed25519", id));
            if std::path::Path::new(&key_path) == expected && expected.is_file() {
                std::fs::remove_file(&expected)
                    .map_err(|e| format!("Connection was deleted, but its managed private key could not be removed: {}", e))?;
            }
        }
        Ok(())
    }

    pub fn save_credentials(
        conn: &SqliteConn,
        id: &str,
        username: &str,
        auth_type: &str,
        key_path: Option<&str>,
        password: Option<&str>,
        remember_me: bool,
    ) -> Result<(), String> {
        if !remember_me {
            crate::credentials::delete_connection_password(id)?;
        } else if let Some(password) = password.filter(|password| !password.is_empty()) {
            crate::credentials::set_connection_password(id, password)?;
        }
        let changed = conn.execute(
            "UPDATE connections SET username = ?1, auth_type = ?2, key_path = ?3, password = NULL, remember_me = ?4 WHERE id = ?5",
            params![username, auth_type, key_path, if remember_me { 1 } else { 0 }, id],
        ).map_err(|e| format!("Save credentials failed: {}", e))?;
        if changed == 0 {
            return Err("Connection not found".to_string());
        }
        Ok(())
    }

    /// Switch a password-bootstrapped connection to its app-managed key.
    /// Root no longer needs a stored password; non-root keeps it for
    /// password/MFA and privilege-elevation workflows.
    pub fn set_managed_key(
        conn: &SqliteConn,
        id: &str,
        key_path: &str,
        is_root: bool,
    ) -> Result<(), String> {
        let auth_type = if is_root { "managed_key" } else { "managed_key_password" };
        let changed = if is_root {
            crate::credentials::delete_connection_password(id)?;
            conn.execute(
                "UPDATE connections SET auth_type = ?1, key_path = ?2, password = NULL, remember_me = 1 WHERE id = ?3",
                params![auth_type, key_path, id],
            )
        } else {
            conn.execute(
                "UPDATE connections SET auth_type = ?1, key_path = ?2, remember_me = 1 WHERE id = ?3",
                params![auth_type, key_path, id],
            )
        }
        .map_err(|e| format!("Save managed SSH key failed: {}", e))?;
        if changed == 0 {
            return Err("Connection not found".to_string());
        }
        Ok(())
    }
}

// ===== Favorite =====

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Favorite {
    pub path: String,
    pub name: String,
}

pub struct FavoritesManager;

impl FavoritesManager {
    pub fn list(conn: &SqliteConn) -> Vec<Favorite> {
        let mut stmt = conn
            .prepare("SELECT path, name FROM favorites ORDER BY name")
            .expect("prepare favorites list");
        stmt.query_map([], |row| {
            Ok(Favorite {
                path: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .expect("query favorites")
        .filter_map(|r| r.ok())
        .collect()
    }

    pub fn add(conn: &SqliteConn, fav: &Favorite) -> Result<(), String> {
        conn.execute(
            "INSERT OR IGNORE INTO favorites (path, name) VALUES (?1, ?2)",
            params![fav.path, fav.name],
        ).map_err(|e| format!("Add favorite failed: {}", e))?;
        Ok(())
    }

    pub fn remove(conn: &SqliteConn, path: &str) -> Result<(), String> {
        conn.execute("DELETE FROM favorites WHERE path = ?1", params![path])
            .map_err(|e| format!("Delete favorite failed: {}", e))?;
        Ok(())
    }
}

// ===== Settings =====

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    #[serde(default = "default_true")]
    pub auto_reconnect: bool,
    #[serde(default = "default_reconnect_interval")]
    pub reconnect_interval: u32,
    #[serde(default = "default_max_attempts")]
    pub max_reconnect_attempts: u32,
    // ponytail: 当为 true 时，断开连接后移除标签页；否则保留标签（置灰）
    #[serde(default)]
    pub close_tab_on_disconnect: bool,
    #[serde(default = "default_cache_ttl")]
    pub cache_ttl_hours: u32,
    #[serde(default = "default_cache_max_files")]
    pub cache_max_files: u32,
    #[serde(default = "default_true")]
    pub cache_enabled: bool,
    #[serde(default = "default_command_timeout")]
    pub command_timeout_minutes: u32,
    #[serde(default = "default_upload_workers")]
    pub upload_workers: u32,
    // ponytail: 界面主题，取值 'light'（默认）或 'dark'
    #[serde(default = "default_theme")]
    pub theme: String,
}

fn default_true() -> bool { true }
fn default_reconnect_interval() -> u32 { 5 }
fn default_max_attempts() -> u32 { 10 }
fn default_cache_ttl() -> u32 { 24 }
fn default_cache_max_files() -> u32 { 500 }
fn default_command_timeout() -> u32 { 30 }
fn default_upload_workers() -> u32 { 3 }
fn default_theme() -> String { "light".to_string() }

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_reconnect: true,
            reconnect_interval: 5,
            max_reconnect_attempts: 10,
            close_tab_on_disconnect: false,
            cache_ttl_hours: 24,
            cache_max_files: 500,
            cache_enabled: true,
            command_timeout_minutes: 30,
            upload_workers: 3,
            theme: "light".to_string(),
        }
    }
}

pub struct SettingsManager;

impl SettingsManager {
    pub fn load(conn: &SqliteConn) -> Settings {
        let mut settings = Settings::default();

        if let Ok(val) = Self::get(conn, "auto_reconnect") {
            if let Ok(v) = val.parse::<bool>() { settings.auto_reconnect = v; }
        }
        if let Ok(val) = Self::get(conn, "reconnect_interval") {
            if let Ok(v) = val.parse::<u32>() { settings.reconnect_interval = v; }
        }
        if let Ok(val) = Self::get(conn, "max_reconnect_attempts") {
            if let Ok(v) = val.parse::<u32>() { settings.max_reconnect_attempts = v; }
        }
        if let Ok(val) = Self::get(conn, "close_tab_on_disconnect") {
            if let Ok(v) = val.parse::<bool>() { settings.close_tab_on_disconnect = v; }
        }
        if let Ok(val) = Self::get(conn, "cache_ttl_hours") {
            if let Ok(v) = val.parse::<u32>() { settings.cache_ttl_hours = v; }
        }
        if let Ok(val) = Self::get(conn, "cache_max_files") {
            if let Ok(v) = val.parse::<u32>() { settings.cache_max_files = v; }
        }
        if let Ok(val) = Self::get(conn, "cache_enabled") {
            if let Ok(v) = val.parse::<bool>() { settings.cache_enabled = v; }
        }
        if let Ok(val) = Self::get(conn, "command_timeout_minutes") {
            if let Ok(v) = val.parse::<u32>() { settings.command_timeout_minutes = v; }
        }
        if let Ok(val) = Self::get(conn, "upload_workers") {
            if let Ok(v) = val.parse::<u32>() { settings.upload_workers = v; }
        }
        if let Ok(val) = Self::get(conn, "theme") {
            if val == "light" || val == "dark" { settings.theme = val; }
        }

        settings
    }

    pub fn save(conn: &SqliteConn, settings: &Settings) -> Result<(), String> {
        Self::set(conn, "auto_reconnect", &settings.auto_reconnect.to_string())?;
        Self::set(conn, "reconnect_interval", &settings.reconnect_interval.to_string())?;
        Self::set(conn, "max_reconnect_attempts", &settings.max_reconnect_attempts.to_string())?;
        Self::set(conn, "close_tab_on_disconnect", &settings.close_tab_on_disconnect.to_string())?;
        Self::set(conn, "cache_ttl_hours", &settings.cache_ttl_hours.to_string())?;
        Self::set(conn, "cache_max_files", &settings.cache_max_files.to_string())?;
        Self::set(conn, "cache_enabled", &settings.cache_enabled.to_string())?;
        Self::set(conn, "command_timeout_minutes", &settings.command_timeout_minutes.to_string())?;
        Self::set(conn, "upload_workers", &settings.upload_workers.to_string())?;
        Self::set(conn, "theme", &settings.theme)?;
        Ok(())
    }

    fn get(conn: &SqliteConn, key: &str) -> Result<String, String> {
        conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
            .map_err(|e| format!("Get setting failed: {}", e))
    }

    fn set(conn: &SqliteConn, key: &str, value: &str) -> Result<(), String> {
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        ).map_err(|e| format!("Set setting failed: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> SqliteConn {
        let conn = SqliteConn::open(":memory:").unwrap();
        conn.execute_batch(
            "CREATE TABLE connections (
                id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', host TEXT NOT NULL,
                port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL DEFAULT 'root',
                auth_type TEXT NOT NULL DEFAULT 'password', key_path TEXT, password TEXT,
                remember_me INTEGER DEFAULT 0
            );
            CREATE TABLE favorites (path TEXT PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
        ).unwrap();
        conn
    }

    // ===== ConfigManager =====

    #[test]
    fn config_save_and_list() {
        let conn = test_conn();
        let c = Connection {
            id: "1".into(), name: "My Server".into(), host: "1.2.3.4".into(),
            port: 22, username: "root".into(), auth_type: "password".into(),
            key_path: None, password: Some("pass".into()), remember_me: false,
        };
        ConfigManager::save(&conn, &c).unwrap();
        let list = ConfigManager::list(&conn);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].host, "1.2.3.4");
        assert_eq!(list[0].name, "My Server");
    }

    #[test]
    fn config_delete() {
        let conn = test_conn();
        let c = Connection {
            id: "1".into(), name: "S".into(), host: "1.2.3.4".into(),
            port: 22, username: "root".into(), auth_type: "password".into(),
            key_path: None, password: None, remember_me: false,
        };
        ConfigManager::save(&conn, &c).unwrap();
        ConfigManager::delete(&conn, "1").unwrap();
        assert!(ConfigManager::list(&conn).is_empty());
    }

    #[test]
    fn config_remember_me_roundtrip() {
        let conn = test_conn();
        let c = Connection {
            id: "1".into(), name: "S".into(), host: "1.2.3.4".into(),
            port: 22, username: "root".into(), auth_type: "key".into(),
            key_path: Some("/root/.ssh/id_rsa".into()), password: None, remember_me: true,
        };
        ConfigManager::save(&conn, &c).unwrap();
        let list = ConfigManager::list(&conn);
        assert!(list[0].remember_me);
        assert_eq!(list[0].key_path, Some("/root/.ssh/id_rsa".to_string()));
    }

    #[test]
    fn managed_root_key_removes_saved_password() {
        let conn = test_conn();
        ConfigManager::save(&conn, &Connection {
            id: "root-1".into(), name: "Root".into(), host: "host".into(),
            port: 22, username: "root".into(), auth_type: "password".into(),
            key_path: None, password: Some("bootstrap".into()), remember_me: true,
        }).unwrap();
        ConfigManager::set_managed_key(&conn, "root-1", "managed.ed25519", true).unwrap();
        let saved = ConfigManager::get(&conn, "root-1").unwrap().unwrap();
        assert_eq!(saved.auth_type, "managed_key");
        assert_eq!(saved.key_path.as_deref(), Some("managed.ed25519"));
        assert_eq!(saved.password, None);
    }

    #[test]
    fn managed_non_root_key_keeps_password() {
        let conn = test_conn();
        ConfigManager::save(&conn, &Connection {
            id: "user-1".into(), name: "User".into(), host: "host".into(),
            port: 22, username: "deploy".into(), auth_type: "password".into(),
            key_path: None, password: Some("sudo-secret".into()), remember_me: true,
        }).unwrap();
        ConfigManager::set_managed_key(&conn, "user-1", "managed.ed25519", false).unwrap();
        let saved = ConfigManager::get(&conn, "user-1").unwrap().unwrap();
        assert_eq!(saved.auth_type, "managed_key_password");
        assert_eq!(saved.key_path.as_deref(), Some("managed.ed25519"));
        assert_eq!(saved.password.as_deref(), Some("sudo-secret"));
    }

    #[test]
    fn config_save_credentials() {
        let conn = test_conn();
        let c = Connection {
            id: "1".into(), name: "S".into(), host: "1.2.3.4".into(),
            port: 22, username: "root".into(), auth_type: "password".into(),
            key_path: None, password: None, remember_me: false,
        };
        ConfigManager::save(&conn, &c).unwrap();
        ConfigManager::save_credentials(&conn, "1", "admin", "key", Some("/key"), None, true).unwrap();
        let list = ConfigManager::list(&conn);
        assert_eq!(list[0].username, "admin");
        assert_eq!(list[0].auth_type, "key");
        assert!(list[0].remember_me);
    }

    // ===== FavoritesManager =====

    #[test]
    fn favorites_add_and_list() {
        let conn = test_conn();
        FavoritesManager::add(&conn, &Favorite { path: "/home".into(), name: "Home".into() }).unwrap();
        let list = FavoritesManager::list(&conn);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Home");
    }

    #[test]
    fn favorites_remove() {
        let conn = test_conn();
        FavoritesManager::add(&conn, &Favorite { path: "/home".into(), name: "Home".into() }).unwrap();
        FavoritesManager::remove(&conn, "/home").unwrap();
        assert!(FavoritesManager::list(&conn).is_empty());
    }

    // ===== SettingsManager =====

    #[test]
    fn settings_load_defaults_when_empty() {
        let conn = test_conn();
        let s = SettingsManager::load(&conn);
        assert!(s.auto_reconnect);
        assert_eq!(s.reconnect_interval, 5);
        assert_eq!(s.command_timeout_minutes, 30);
        assert_eq!(s.upload_workers, 3);
        assert_eq!(s.theme, "light");
    }

    #[test]
    fn settings_save_and_load_roundtrip() {
        let conn = test_conn();
        let s = Settings {
            auto_reconnect: false,
            reconnect_interval: 10,
            max_reconnect_attempts: 5,
            close_tab_on_disconnect: true,
            cache_ttl_hours: 48,
            cache_max_files: 1000,
            cache_enabled: false,
            command_timeout_minutes: 60,
            upload_workers: 5,
            theme: "dark".to_string(),
        };
        SettingsManager::save(&conn, &s).unwrap();
        let loaded = SettingsManager::load(&conn);
        assert!(!loaded.auto_reconnect);
        assert_eq!(loaded.reconnect_interval, 10);
        assert_eq!(loaded.cache_ttl_hours, 48);
        assert_eq!(loaded.upload_workers, 5);
        assert_eq!(loaded.theme, "dark");
    }

    #[test]
    fn settings_default_trait() {
        let s = Settings::default();
        assert!(s.auto_reconnect);
        assert_eq!(s.cache_max_files, 500);
        assert_eq!(s.theme, "light");
    }
}
