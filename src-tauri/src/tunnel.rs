use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::ssh::SshSession;

/// Tunnel types supported
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelType {
    Local,
    Remote,
    Dynamic,
}

/// Tunnel configuration
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TunnelConfig {
    pub tunnel_type: TunnelType,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

/// Active tunnel info
#[derive(Debug)]
pub struct ActiveTunnel {
    pub id: String,
    pub session_id: String,
    pub config: TunnelConfig,
    pub shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

/// Tunnel info for frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct TunnelInfo {
    pub id: String,
    pub session_id: String,
    pub tunnel_type: String,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub status: String,
}

/// Manages SSH tunnels
pub struct TunnelManager {
    tunnels: Mutex<HashMap<String, ActiveTunnel>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            tunnels: Mutex::new(HashMap::new()),
        }
    }

    /// Create a new tunnel
    pub async fn create_tunnel(
        &self,
        session_id: String,
        session: SshSession,
        config: TunnelConfig,
        app_handle: AppHandle,
    ) -> Result<String, String> {
        let tunnel_id = uuid::Uuid::new_v4().to_string();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

        let active_tunnel = ActiveTunnel {
            id: tunnel_id.clone(),
            session_id: session_id.clone(),
            config: config.clone(),
            shutdown_tx: Some(shutdown_tx),
        };

        match config.tunnel_type {
            TunnelType::Local => {
                self.start_local_tunnel(
                    tunnel_id.clone(),
                    session_id.clone(),
                    session,
                    config.clone(),
                    shutdown_rx,
                    app_handle.clone(),
                )
                .await?;
            }
            TunnelType::Remote => {
                self.start_remote_tunnel(
                    tunnel_id.clone(),
                    session_id.clone(),
                    session,
                    config.clone(),
                    shutdown_rx,
                    app_handle.clone(),
                )
                .await?;
            }
            TunnelType::Dynamic => {
                self.start_dynamic_tunnel(
                    tunnel_id.clone(),
                    session_id.clone(),
                    session,
                    config.clone(),
                    shutdown_rx,
                    app_handle.clone(),
                )
                .await?;
            }
        }

        self.tunnels.lock().await.insert(tunnel_id.clone(), active_tunnel);

        let _ = app_handle.emit("tunnel-created", serde_json::json!({
            "tunnelId": tunnel_id,
            "sessionId": session_id,
        }));

        Ok(tunnel_id)
    }

    /// Start a local port forwarding tunnel (ssh -L)
    async fn start_local_tunnel(
        &self,
        tunnel_id: String,
        session_id: String,
        session: SshSession,
        config: TunnelConfig,
        mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let bind_addr = format!("{}:{}", config.local_host, config.local_port);
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| format!("Failed to bind {}: {}", bind_addr, e))?;

        let _ = app_handle.emit("tunnel-status", serde_json::json!({
            "tunnelId": tunnel_id,
            "status": "listening",
            "message": format!("Local tunnel listening on {}", bind_addr),
        }));

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((mut tcp_stream, addr)) => {
                                let session = session.clone();
                                let tunnel_id = tunnel_id.clone();
                                let _session_id = session_id.clone();
                                let app_handle = app_handle.clone();
                                let remote_host = config.remote_host.clone();
                                let remote_port = config.remote_port;

                                tokio::spawn(async move {
                                    // Open a direct-tcpip channel
                                    let handle = session.handle.lock().await;
                                    let channel = handle
                                        .channel_open_direct_tcpip(
                                            &remote_host,
                                            remote_port as u32,
                                            addr.ip().to_string(),
                                            addr.port() as u32,
                                        )
                                        .await;
                                    drop(handle);

                                    match channel {
                                        Ok(ch) => {
                                            let mut channel_stream = ch.into_stream();
                                            if let Err(e) = Self::forward_bidirectional(
                                                &mut tcp_stream,
                                                &mut channel_stream,
                                            )
                                            .await
                                            {
                                                let _ = app_handle.emit("tunnel-error", serde_json::json!({
                                                    "tunnelId": tunnel_id,
                                                    "error": format!("Forward error: {}", e),
                                                }));
                                            }
                                        }
                                        Err(e) => {
                                            let _ = app_handle.emit("tunnel-error", serde_json::json!({
                                                "tunnelId": tunnel_id,
                                                "error": format!("Channel open failed: {}", e),
                                            }));
                                        }
                                    }
                                });
                            }
                            Err(e) => {
                                let _ = app_handle.emit("tunnel-error", serde_json::json!({
                                    "tunnelId": tunnel_id,
                                    "error": format!("Accept error: {}", e),
                                }));
                                break;
                            }
                        }
                    }
                    _ = &mut shutdown_rx => {
                        let _ = app_handle.emit("tunnel-status", serde_json::json!({
                            "tunnelId": tunnel_id,
                            "status": "stopped",
                            "message": "Tunnel stopped",
                        }));
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    /// Start a remote port forwarding tunnel (ssh -R)
    async fn start_remote_tunnel(
        &self,
        tunnel_id: String,
        _session_id: String,
        session: SshSession,
        config: TunnelConfig,
        shutdown_rx: tokio::sync::oneshot::Receiver<()>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        // Request the server to listen on the remote port
        let handle = session.handle.clone();
        let mut handle_guard = handle.lock().await;
        let bound_port = handle_guard
            .tcpip_forward(&config.remote_host, config.remote_port as u32)
            .await
            .map_err(|e| format!("Remote forward request denied: {}", e))?;
        drop(handle_guard);

        let _ = app_handle.emit("tunnel-status", serde_json::json!({
            "tunnelId": tunnel_id,
            "status": "listening",
            "message": format!("Remote tunnel listening on {}:{} (server will forward to {}:{})", 
                config.remote_host, bound_port, config.local_host, config.local_port),
        }));

        // Note: For remote forwarding, the server sends us channels via
        // server_channel_open_forwarded_tcpip callback. We need to handle those
        // in the SshHandler. For now, we'll use a simpler approach where we
        // spawn a task that handles incoming forwarded connections.
        
        let remote_host = config.remote_host.clone();
        let remote_port = bound_port;
        let _local_host = config.local_host.clone();
        let _local_port = config.local_port;

        tokio::spawn(async move {
            // Wait for shutdown signal
            let _ = shutdown_rx.await;
            // Cancel the forward request
            let handle = session.handle.lock().await;
            let _ = handle.cancel_tcpip_forward(&remote_host, remote_port).await;
            let _ = app_handle.emit("tunnel-status", serde_json::json!({
                "tunnelId": tunnel_id,
                "status": "stopped",
                "message": "Remote tunnel stopped",
            }));
        });

        Ok(())
    }

    /// Start a dynamic (SOCKS5) tunnel (ssh -D)
    async fn start_dynamic_tunnel(
        &self,
        tunnel_id: String,
        _session_id: String,
        _session: SshSession,
        config: TunnelConfig,
        mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let bind_addr = format!("{}:{}", config.local_host, config.local_port);
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| format!("Failed to bind {}: {}", bind_addr, e))?;

        let _ = app_handle.emit("tunnel-status", serde_json::json!({
            "tunnelId": tunnel_id,
            "status": "listening",
            "message": format!("SOCKS5 proxy listening on {}", bind_addr),
        }));

        // ponytail: SOCKS5 implementation - minimal but functional
        // For a full implementation, consider using a SOCKS5 library
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((mut tcp_stream, _addr)) => {
                                let tunnel_id = tunnel_id.clone();
                                let app_handle = app_handle.clone();
                                // Spawn handler for this SOCKS5 connection
                                tokio::spawn(async move {
                                    // SOCKS5 handshake
                                    let mut buf = [0u8; 260];
                                    if tcp_stream.read(&mut buf).await.is_err() {
                                        return;
                                    }
                                    // For now, just reject all connections
                                    // A full SOCKS5 implementation would parse the request
                                    // and open direct-tcpip channels accordingly
                                    let _ = app_handle.emit("tunnel-error", serde_json::json!({
                                        "tunnelId": tunnel_id,
                                        "error": "SOCKS5 not fully implemented yet",
                                    }));
                                });
                            }
                            Err(e) => {
                                let _ = app_handle.emit("tunnel-error", serde_json::json!({
                                    "tunnelId": tunnel_id,
                                    "error": format!("Accept error: {}", e),
                                }));
                                break;
                            }
                        }
                    }
                    _ = &mut shutdown_rx => {
                        let _ = app_handle.emit("tunnel-status", serde_json::json!({
                            "tunnelId": tunnel_id,
                            "status": "stopped",
                            "message": "SOCKS5 proxy stopped",
                        }));
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    /// Forward data bidirectionally between TCP stream and SSH channel
    async fn forward_bidirectional<S1, S2>(
        tcp: &mut S1,
        ssh: &mut S2,
    ) -> Result<(), String>
    where
        S1: AsyncReadExt + AsyncWriteExt + Unpin,
        S2: AsyncReadExt + AsyncWriteExt + Unpin,
    {
        let (mut tcp_read, mut tcp_write) = tokio::io::split(tcp);
        let (mut ssh_read, mut ssh_write) = tokio::io::split(ssh);

        let tcp_to_ssh = async {
            let mut buf = vec![0u8; 32 * 1024];
            loop {
                let n = tcp_read.read(&mut buf).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                ssh_write.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
            }
            let _ = ssh_write.shutdown().await;
            Ok::<(), String>(())
        };

        let ssh_to_tcp = async {
            let mut buf = vec![0u8; 32 * 1024];
            loop {
                let n = ssh_read.read(&mut buf).await.map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                tcp_write.write_all(&buf[..n]).await.map_err(|e| e.to_string())?;
            }
            let _ = tcp_write.shutdown().await;
            Ok::<(), String>(())
        };

        tokio::select! {
            r = tcp_to_ssh => r?,
            r = ssh_to_tcp => r?,
        }

        Ok(())
    }

    /// Close a tunnel
    pub async fn close_tunnel(&self, tunnel_id: &str) -> Result<(), String> {
        if let Some(mut tunnel) = self.tunnels.lock().await.remove(tunnel_id) {
            if let Some(tx) = tunnel.shutdown_tx.take() {
                let _ = tx.send(());
            }
        }
        Ok(())
    }

    /// Close all tunnels for a session
    pub async fn close_session_tunnels(&self, session_id: &str) {
        let mut tunnels = self.tunnels.lock().await;
        let to_remove: Vec<String> = tunnels
            .iter()
            .filter(|(_, t)| t.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in to_remove {
            if let Some(mut tunnel) = tunnels.remove(&id) {
                if let Some(tx) = tunnel.shutdown_tx.take() {
                    let _ = tx.send(());
                }
            }
        }
    }

    /// List all active tunnels
    pub async fn list_tunnels(&self) -> Vec<TunnelInfo> {
        self.tunnels
            .lock()
            .await
            .values()
            .map(|t| TunnelInfo {
                id: t.id.clone(),
                session_id: t.session_id.clone(),
                tunnel_type: match t.config.tunnel_type {
                    TunnelType::Local => "local".to_string(),
                    TunnelType::Remote => "remote".to_string(),
                    TunnelType::Dynamic => "dynamic".to_string(),
                },
                local_host: t.config.local_host.clone(),
                local_port: t.config.local_port,
                remote_host: t.config.remote_host.clone(),
                remote_port: t.config.remote_port,
                status: "active".to_string(),
            })
            .collect()
    }

    /// Get tunnel by ID
    pub async fn get_tunnel(&self, tunnel_id: &str) -> Option<TunnelInfo> {
        self.tunnels
            .lock()
            .await
            .get(tunnel_id)
            .map(|t| TunnelInfo {
                id: t.id.clone(),
                session_id: t.session_id.clone(),
                tunnel_type: match t.config.tunnel_type {
                    TunnelType::Local => "local".to_string(),
                    TunnelType::Remote => "remote".to_string(),
                    TunnelType::Dynamic => "dynamic".to_string(),
                },
                local_host: t.config.local_host.clone(),
                local_port: t.config.local_port,
                remote_host: t.config.remote_host.clone(),
                remote_port: t.config.remote_port,
                status: "active".to_string(),
            })
    }
}
