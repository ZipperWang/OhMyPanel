mod config;
mod credentials;
mod db;
mod server;
mod ssh;
mod tunnel;
mod commands;

use rusqlite::Connection as SqliteConn;
use ssh::SshManager;
use tunnel::TunnelManager;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex as AsyncMutex;

type DbPool = std::sync::Mutex<SqliteConn>;

// ===== App Entry =====

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let mut logger = fern::Dispatch::new()
                .level(log::LevelFilter::Info)
                .chain(std::io::stdout());
            if let Ok(log_dir) = app.path().app_log_dir() {
                if std::fs::create_dir_all(&log_dir).is_ok() {
                    if let Ok(log_file) = fern::log_file(log_dir.join("ohmypanel.log")) {
                        logger = logger.chain(log_file);
                    }
                }
            }
            if let Err(error) = logger.apply() {
                eprintln!("Failed to initialize application logging: {error}");
            }

            let ssh_mgr = Arc::new(AsyncMutex::new(SshManager::new()));
            app.manage(ssh_mgr);

            let tunnel_mgr = Arc::new(AsyncMutex::new(TunnelManager::new()));
            app.manage(tunnel_mgr);

            // 初始化 SQLite 数据库
            let db = db::init_db().expect("Failed to initialize database");
            app.manage(db);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // SSH
            commands::ssh::ssh_connect, commands::ssh::ssh_input, commands::ssh::ssh_resize, commands::ssh::ssh_disconnect,
            commands::ssh::ssh_get_cwd, commands::ssh::ssh_list_dir, commands::ssh::ssh_stat_file, commands::ssh::ssh_read_file, commands::ssh::ssh_write_file,
            commands::ssh::ssh_delete_file, commands::ssh::ssh_delete_files_batch, commands::ssh::ssh_create_dir, commands::ssh::ssh_rename_file, commands::ssh::ssh_rename_files_batch,
            commands::ssh::ssh_copy_file, commands::ssh::ssh_copy_files_batch, commands::ssh::ssh_copy_dir, commands::ssh::ssh_set_permissions, commands::ssh::ssh_set_permissions_batch,
            commands::ssh::ssh_check_space, commands::ssh::ssh_upload, commands::ssh::ssh_upload_chunk, commands::ssh::ssh_sftp_reset, commands::ssh::ssh_upload_files_batch, commands::ssh::ssh_create_dirs_batch, commands::ssh::ssh_exec, commands::ssh::ssh_download_file,
            commands::ssh::ssh_download_to_local, commands::ssh::ssh_save_as_local, commands::ssh::ssh_save_pause, commands::ssh::ssh_save_resume, commands::ssh::ssh_save_stop,
            commands::ssh::ssh_compress, commands::ssh::ssh_extract, commands::ssh::ssh_reconnect,
            commands::ssh::ssh_generate_keypair, commands::ssh::ssh_trust_host_key,
            commands::ssh::ssh_provision_managed_key,
            // 配置
            commands::config::config_list, commands::config::config_save, commands::config::config_delete, commands::config::config_save_credentials,
            commands::config::clear_proxy_env,
            // 设置
            commands::config::settings_load, commands::config::settings_save,
            // 数据目录
            commands::config::get_data_dir, commands::config::open_data_dir,
            // 收藏夹
            commands::config::favorites_list, commands::config::favorites_add, commands::config::favorites_remove,
            // 服务器
            commands::server::server_get_system_info, commands::server::server_get_service_statuses,
            commands::server::server_get_service_info, commands::server::server_service_action,
            commands::server::server_read_remote_file, commands::server::server_write_remote_file,
            commands::server::server_get_log_lines, commands::server::server_test_nginx_config,
            commands::server::server_list_nginx_vhosts, commands::server::server_find_mysql_service,
            commands::server::server_find_php_service, commands::server::server_find_php_fpm_config,
            commands::server::server_mysql_processes, commands::server::server_mysql_query,
            commands::server::server_list_databases, commands::server::server_mysql_create_database, commands::server::server_mysql_delete_database,
            commands::server::server_mysql_clear_database,
            commands::server::server_mysql_change_db_access,
            commands::server::server_change_mysql_root_password,
            commands::server::server_change_db_user_password,
            // Redis
            commands::server::server_redis_check_status, commands::server::server_redis_get_version,
            commands::server::server_redis_dbsize_all, commands::server::server_redis_scan_keys,
            commands::server::server_redis_set_key, commands::server::server_redis_del_key,
            commands::server::server_redis_flushdb, commands::server::server_redis_save_backup, commands::server::server_redis_list_backups,
            commands::server::server_check_lnmp, commands::server::server_install_lnmp,
            // 站点
            commands::server_ops::server_list_sites, commands::server_ops::server_create_site,
            commands::server_ops::server_toggle_site,
            commands::server_ops::server_delete_site, commands::server_ops::server_update_site, commands::server_ops::server_update_site_full,
            commands::server_ops::server_save_site_config, commands::server_ops::server_set_hotlink_protection, commands::server_ops::server_set_reverse_proxy,
            commands::server_ops::server_list_php_versions, commands::server_ops::server_list_subdirs,
            commands::server_ops::server_setup_ssl, commands::server_ops::server_get_monitor_data,
            // 防火墙
            commands::server_ops::server_firewall_list, commands::server_ops::server_firewall_add,
            commands::server_ops::server_firewall_remove, commands::server_ops::server_firewall_toggle,
            // 软件
            commands::server_ops::server_get_software_list, commands::server_ops::server_get_available_php_versions, commands::server_ops::server_get_available_mysql_versions, commands::server_ops::server_software_action,
            commands::server_ops::server_get_removable_sources, commands::server_ops::server_remove_sources, commands::server_ops::server_clean_and_update_sources, commands::server_ops::server_add_source,
            // 系统杂项
            commands::server_ops::server_reboot, commands::server_ops::server_get_uptime,
            commands::server_ops::server_deploy_pubkey, commands::server_ops::server_get_ssh_auth_mode,
            commands::server_ops::server_set_ssh_auth_mode, commands::server_ops::server_get_bbr_status,
            commands::server_ops::server_set_bbr_status, commands::server_ops::server_get_gateway_ports_status,
            commands::server_ops::server_set_gateway_ports, commands::server_ops::server_get_site_logs,
            commands::server_ops::server_read_site_log,
            // 文件浏览器
            commands::fb::fb_favorites_list, commands::fb::fb_favorites_add, commands::fb::fb_favorites_remove,
            commands::fb::fb_cache_get, commands::fb::fb_cache_put, commands::fb::fb_cache_touch, commands::fb::fb_cache_clear_all, commands::fb::fb_cache_count,
            commands::fb::ui_state_get, commands::fb::ui_state_set,
            // Docker
            commands::server_ops::server_check_docker, commands::server_ops::server_install_docker, commands::server_ops::server_uninstall_docker,
            commands::server_ops::server_docker_container_list, commands::server_ops::server_docker_container_action,
            commands::server_ops::server_docker_container_remove, commands::server_ops::server_docker_container_batch_action, commands::server_ops::server_docker_container_batch_remove,
            commands::server_ops::server_docker_container_logs, commands::server_ops::server_docker_container_commit,
            commands::server_ops::server_docker_image_list, commands::server_ops::server_docker_image_pull, commands::server_ops::server_docker_image_remove, commands::server_ops::server_docker_image_load, commands::server_ops::server_docker_image_run,
            commands::server_ops::server_docker_get_mirror_config, commands::server_ops::server_docker_set_mirror_config,
            // 缓存
            commands::server_ops::server_cache_invalidate,
            // 数据库备注
            commands::server::server_save_db_remark, commands::server::server_get_db_remarks,
            // 数据库凭据
            commands::server::server_save_db_credentials, commands::server::server_get_db_credentials,
            commands::server::server_get_db_credential, commands::server::server_update_db_credential_password,
            // 数据库备份与导入
            commands::server::server_backup_database, commands::server::server_list_db_backups, commands::server::server_delete_db_backup,
            commands::server::server_download_db_backup, commands::server::server_save_db_backup_to_local,
            commands::server::server_import_database_from_file, commands::server::server_import_database_from_file_bytes, commands::server::server_import_database_from_backup,
            // 自定义软件
            commands::server_ops::custom_software_list, commands::server_ops::custom_software_add, commands::server_ops::custom_software_remove, commands::server_ops::custom_software_action,
            commands::server_ops::server_check_installation,
            // 隧道
            commands::tunnel::tunnel_create, commands::tunnel::tunnel_close, commands::tunnel::tunnel_close_batch,
            commands::tunnel::tunnel_delete, commands::tunnel::tunnel_restore,
            commands::tunnel::tunnel_list, commands::tunnel::tunnel_get,
            commands::tunnel::tunnel_update_note, commands::tunnel::tunnel_delete_batch,
            commands::tunnel::tunnel_restore_batch,
            commands::tunnel::database_tunnel_open, commands::tunnel::database_tunnel_status,
            commands::tunnel::database_tunnel_close,
            // 端口管理
            commands::port::port_list, commands::port::port_query, commands::port::port_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
