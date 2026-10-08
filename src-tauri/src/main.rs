// 阻止 Windows 发布版弹出额外控制台窗口，请勿移除!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  app_lib::run();
}
