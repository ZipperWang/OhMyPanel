use base64::Engine;

const SERVICE: &str = "com.ohmypanel.desktop";

fn identifier(kind: &str, parts: &[&str]) -> String {
    let mut raw = kind.as_bytes().to_vec();
    for part in parts {
        raw.extend_from_slice(&(part.len() as u64).to_be_bytes());
        raw.extend_from_slice(part.as_bytes());
    }
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw)
}

#[cfg(not(test))]
fn set(identifier: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, identifier)
        .map_err(|e| format!("Failed to open the operating-system credential store: {}", e))?;
    entry
        .set_password(secret)
        .map_err(|e| format!("Failed to save a secret in the operating-system credential store: {}", e))
}

#[cfg(not(test))]
fn get(identifier: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE, identifier)
        .map_err(|e| format!("Failed to open the operating-system credential store: {}", e))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read a secret from the operating-system credential store: {}", e)),
    }
}

#[cfg(not(test))]
fn delete(identifier: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, identifier)
        .map_err(|e| format!("Failed to open the operating-system credential store: {}", e))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete a secret from the operating-system credential store: {}", e)),
    }
}

#[cfg(test)]
thread_local! {
    static TEST_SECRETS: std::cell::RefCell<std::collections::HashMap<String, String>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

#[cfg(test)]
fn set(identifier: &str, secret: &str) -> Result<(), String> {
    TEST_SECRETS.with(|secrets| {
        secrets.borrow_mut().insert(identifier.to_string(), secret.to_string());
    });
    Ok(())
}

#[cfg(test)]
fn get(identifier: &str) -> Result<Option<String>, String> {
    Ok(TEST_SECRETS.with(|secrets| secrets.borrow().get(identifier).cloned()))
}

#[cfg(test)]
fn delete(identifier: &str) -> Result<(), String> {
    TEST_SECRETS.with(|secrets| {
        secrets.borrow_mut().remove(identifier);
    });
    Ok(())
}

pub fn set_connection_password(connection_id: &str, password: &str) -> Result<(), String> {
    set(&identifier("ssh", &[connection_id]), password)
}

pub fn get_connection_password(connection_id: &str) -> Result<Option<String>, String> {
    get(&identifier("ssh", &[connection_id]))
}

pub fn delete_connection_password(connection_id: &str) -> Result<(), String> {
    delete(&identifier("ssh", &[connection_id]))
}

pub fn set_database_password(server_host: &str, db_name: &str, password: &str) -> Result<(), String> {
    set(&identifier("database", &[server_host, db_name]), password)
}

pub fn get_database_password(server_host: &str, db_name: &str) -> Result<Option<String>, String> {
    get(&identifier("database", &[server_host, db_name]))
}

pub fn delete_database_password(server_host: &str, db_name: &str) -> Result<(), String> {
    delete(&identifier("database", &[server_host, db_name]))
}
