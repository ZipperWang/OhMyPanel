use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::ssh::{ForwardedTcpip, SshSession};

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
    /// Arc so spawned tunnel tasks can remove themselves on exit (no zombie entries).
    tunnels: Arc<Mutex<HashMap<String, ActiveTunnel>>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            tunnels: Arc::new(Mutex::new(HashMap::new())),
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

        // Snapshot for spawned tasks: they remove their entry when exiting
        let tunnels_reg = self.tunnels.clone();

        match config.tunnel_type {
            TunnelType::Local => {
                self.start_local_tunnel(
                    tunnel_id.clone(),
                    session_id.clone(),
                    session,
                    config.clone(),
                    shutdown_rx,
                    app_handle.clone(),
                    tunnels_reg,
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
                    tunnels_reg,
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
                    tunnels_reg,
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
    #[allow(clippy::too_many_arguments)]
    async fn start_local_tunnel(
        &self,
        tunnel_id: String,
        _session_id: String,
        session: SshSession,
        config: TunnelConfig,
        mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
        app_handle: AppHandle,
        tunnels_reg: Arc<Mutex<HashMap<String, ActiveTunnel>>>,
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
                        break;
                    }
                }
            }
            // Self-cleanup: remove entry so the frontend list stays accurate
            tunnels_reg.lock().await.remove(&tunnel_id);
            let _ = app_handle.emit("tunnel-status", serde_json::json!({
                "tunnelId": tunnel_id,
                "status": "stopped",
                "message": "Tunnel stopped",
            }));
        });

        Ok(())
    }

    /// Start a remote port forwarding tunnel (ssh -R)
    #[allow(clippy::too_many_arguments)]
    async fn start_remote_tunnel(
        &self,
        tunnel_id: String,
        _session_id: String,
        session: SshSession,
        config: TunnelConfig,
        mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
        app_handle: AppHandle,
        tunnels_reg: Arc<Mutex<HashMap<String, ActiveTunnel>>>,
    ) -> Result<(), String> {
        // Request the server to listen on the remote port
        let handle = session.handle.clone();
        let mut handle_guard = handle.lock().await;
        let bound_port = handle_guard
            .tcpip_forward(&config.remote_host, config.remote_port as u32)
            .await
            .map_err(|e| format!("Remote forward request denied: {}", e))?;
        drop(handle_guard);

        // Register ourselves: the SshHandler routes server-side forwarded
        // connections to us via this channel, keyed by the server port.
        let (fwd_tx, mut fwd_rx) = mpsc::unbounded_channel::<ForwardedTcpip>();
        session.forwarded_reg.lock().unwrap().insert(bound_port, fwd_tx);

        let _ = app_handle.emit("tunnel-status", serde_json::json!({
            "tunnelId": tunnel_id,
            "status": "listening",
            "message": format!("Remote tunnel listening on {}:{} (server will forward to {}:{})",
                config.remote_host, bound_port, config.local_host, config.local_port),
        }));

        let remote_host = config.remote_host.clone();
        let local_host = config.local_host.clone();
        let local_port = config.local_port;

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(conn) = fwd_rx.recv() => {
                        let tunnel_id = tunnel_id.clone();
                        let app_handle = app_handle.clone();
                        let local_host = local_host.clone();
                        tokio::spawn(async move {
                            // Connect to the local service and splice both directions
                            match TcpStream::connect(format!("{}:{}", local_host, local_port)).await {
                                Ok(mut local) => {
                                    let mut ch = conn.channel.into_stream();
                                    if let Err(e) = Self::forward_bidirectional(&mut local, &mut ch).await {
                                        let _ = app_handle.emit("tunnel-error", serde_json::json!({
                                            "tunnelId": tunnel_id,
                                            "error": format!("Remote forward error: {}", e),
                                        }));
                                    }
                                }
                                Err(e) => {
                                    let _ = app_handle.emit("tunnel-error", serde_json::json!({
                                        "tunnelId": tunnel_id,
                                        "error": format!("Local connect failed {}:{}: {}", local_host, local_port, e),
                                    }));
                                }
                            }
                        });
                    }
                    _ = &mut shutdown_rx => {
                        break;
                    }
                }
            }
            // Unregister + cancel the forward request
            session.forwarded_reg.lock().unwrap().remove(&bound_port);
            let handle = session.handle.lock().await;
            let _ = handle.cancel_tcpip_forward(&remote_host, bound_port).await;
            drop(handle);
            tunnels_reg.lock().await.remove(&tunnel_id);
            let _ = app_handle.emit("tunnel-status", serde_json::json!({
                "tunnelId": tunnel_id,
                "status": "stopped",
                "message": "Remote tunnel stopped",
            }));
        });

        Ok(())
    }

    /// Start a dynamic (SOCKS5) tunnel (ssh -D)
    #[allow(clippy::too_many_arguments)]
    async fn start_dynamic_tunnel(
        &self,
        tunnel_id: String,
        _session_id: String,
        session: SshSession,
        config: TunnelConfig,
        mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
        app_handle: AppHandle,
        tunnels_reg: Arc<Mutex<HashMap<String, ActiveTunnel>>>,
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

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((tcp_stream, _addr)) => {
                                let session = session.clone();
                                let tunnel_id = tunnel_id.clone();
                                let app_handle = app_handle.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = Self::handle_socks5(tcp_stream, session).await {
                                        let _ = app_handle.emit("tunnel-error", serde_json::json!({
                                            "tunnelId": tunnel_id,
                                            "error": format!("SOCKS5: {}", e),
                                        }));
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
                        break;
                    }
                }
            }
            tunnels_reg.lock().await.remove(&tunnel_id);
            let _ = app_handle.emit("tunnel-status", serde_json::json!({
                "tunnelId": tunnel_id,
                "status": "stopped",
                "message": "SOCKS5 proxy stopped",
            }));
        });

        Ok(())
    }

    /// SOCKS5 handshake + forward. Supports CONNECT with IPv4/domain/IPv6 targets.
    /// ponytail: no-auth method only — matches typical SSH -D usage.
    async fn handle_socks5(mut tcp: TcpStream, session: SshSession) -> Result<(), String> {
        // --- greeting: VER NMETHODS METHODS... ---
        let mut head = [0u8; 2];
        tcp.read_exact(&mut head).await.map_err(|e| format!("greeting: {}", e))?;
        if head[0] != 0x05 {
            return Err("Not a SOCKS5 client".into());
        }
        let nmethods = head[1] as usize;
        let mut methods = vec![0u8; nmethods];
        tcp.read_exact(&mut methods).await.map_err(|e| format!("methods: {}", e))?;
        // Reply: no authentication
        tcp.write_all(&[0x05, 0x00]).await.map_err(|e| format!("reply: {}", e))?;

        // --- request: VER CMD RSV ATYP ADDR PORT ---
        let mut req = [0u8; 3];
        tcp.read_exact(&mut req).await.map_err(|e| format!("request: {}", e))?;
        if req[0] != 0x05 {
            return Err("Bad SOCKS5 version".into());
        }
        if req[1] != 0x01 {
            // rep=0x07 (command not supported)
            let _ = tcp.write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
            return Err("Only CONNECT is supported".into());
        }
        let mut atyp = [0u8; 1];
        tcp.read_exact(&mut atyp).await.map_err(|e| format!("atyp: {}", e))?;
        let host = match atyp[0] {
            0x01 => {
                let mut a = [0u8; 4];
                tcp.read_exact(&mut a).await.map_err(|e| format!("addr: {}", e))?;
                std::net::Ipv4Addr::from(a).to_string()
            }
            0x03 => {
                let mut len = [0u8; 1];
                tcp.read_exact(&mut len).await.map_err(|e| format!("dlen: {}", e))?;
                let mut d = vec![0u8; len[0] as usize];
                tcp.read_exact(&mut d).await.map_err(|e| format!("domain: {}", e))?;
                String::from_utf8_lossy(&d).to_string()
            }
            0x04 => {
                let mut a = [0u8; 16];
                tcp.read_exact(&mut a).await.map_err(|e| format!("addr6: {}", e))?;
                std::net::Ipv6Addr::from(a).to_string()
            }
            _ => return Err("Unsupported address type".into()),
        };
        let mut pb = [0u8; 2];
        tcp.read_exact(&mut pb).await.map_err(|e| format!("port: {}", e))?;
        let port = u16::from_be_bytes(pb) as u32;

        // --- open direct-tcpip channel through SSH ---
        let handle = session.handle.lock().await;
        let channel = handle
            .channel_open_direct_tcpip(&host, port, "127.0.0.1", 0)
            .await;
        drop(handle);
        let mut ch = channel.map_err(|e| format!("channel open: {}", e))?.into_stream();

        // --- success reply ---
        tcp.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await
            .map_err(|e| format!("reply: {}", e))?;

        // --- bidirectional forward ---
        Self::forward_bidirectional(&mut tcp, &mut ch).await
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
