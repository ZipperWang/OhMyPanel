# OpenAI Codex for Open Source — 申请表（LeePanel）

- **仓库地址**: https://github.com/gna1280072/LeePanel
- **GitHub 用户名**: gna1280072
- **角色**: 创建者 & 主要维护者（sole creator and primary maintainer）
- **数据时间**: 2026-08-15，全部来自 GitHub API 实测（stars 142 / forks 3 / commits 284 / releases 5 / release downloads 346）

---

## 1. 说明你的角色：你是主要维护者还是核心维护者？

**推荐英文最终版（280 chars）**
> I am the sole creator and primary maintainer of LeePanel (github.com/gna1280072/LeePanel). I am the only contributor (1/1), author of all 284 commits, and I handle every release, issue, review and security decision. There is no core team; every merged change is my responsibility.

**中文翻译**
> 我是 LeePanel（github.com/gna1280072/LeePanel）的唯一创建者和主要维护者。我是仓库唯一的贡献者（1/1），全部 284 次提交都由我完成，所有发布、Issue、代码审查和安全决策均由我负责。项目没有核心团队，每一行合并进主分支的代码都由我承担责任。

**为什么这样写**：官方表单需要明确角色。实测该仓库只有 1 名贡献者，如实填写"创建者兼主要维护者"并点明"无核心团队、全部提交出自一人"，比虚报团队规模更可信，也与后文"单人维护者"的安全诉求形成呼应。

---

## 2. 为什么这个代码仓库符合要求？

**推荐英文最终版（485 chars）**
> LeePanel (MIT) is an open-source Linux server management panel: a Tauri 2 + Rust + React desktop client managing Nginx/MySQL/PHP/Redis/Docker, SSH terminal and SFTP over local SSH only, zero server-side installation, eliminating the web-panel attack surface. Verified via GitHub API (2026-08-15): 142 stars, 3 forks, 284 commits, 5 releases, 346 downloads, daily active development, en/zh community, website leepanel.com. Server tooling is security-critical open-source infrastructure.

**中文翻译**
> LeePanel（MIT 协议）是一款开源的 Linux 服务器管理面板：基于 Tauri 2 + Rust + React 的桌面客户端，通过本地 SSH 连接管理 Nginx/MySQL/PHP/Redis/Docker、SSH 终端和 SFTP，服务器端零安装，从根源上消除了传统 Web 面板的攻击面。GitHub API 实测数据（2026-08-15）：142 Stars、3 Forks、284 次提交、5 个 Release、346 次下载、每日活跃开发、中英文社区、官网 leepanel.com。服务器管理工具属于安全关键型的开源基础设施。

**为什么这样写**：全部使用可验证的 GitHub 数据（Stars/Forks/Commits/Releases/下载量/活跃度）证明项目真实且有实际用户，并用"安全关键型基础设施"说明生态价值，避免空泛宣传语。

---

## 3. 你的项目为何需要 Codex Security？

**推荐英文最终版（500 chars）**
> LeePanel runs arbitrary shell commands on users' servers over SSH; any malicious or injected code means full root compromise. The ~377 KB Rust layer builds shell strings from user-supplied site/DB/file names (injection); SSH/MySQL credentials persist in a local SQLite store with unaudited at-rest protection; Tauri capabilities allow broad local file reads. As sole maintainer, automated review for malicious commits, hardcoded secrets, injection patterns and unsafe dependency diffs protects users.

**中文翻译**
> LeePanel 通过 SSH 在用户服务器上执行任意 shell 命令，任何恶意或被注入的代码都意味着服务器被完全攻陷（root 权限）。约 377 KB 的 Rust 命令层会根据用户提供的站点/数据库/文件名拼接 shell 字符串（存在注入面）；SSH/MySQL 凭证持久化在本地 SQLite 数据库中，其静态存储保护尚未审计；Tauri 权限配置允许广泛的本地文件读取。作为唯一维护者，针对恶意提交、硬编码密钥、注入模式和不安全依赖变更的自动化审查，直接保护的是用户的服务器。

**为什么这样写**：逐一列出真实攻击面（SSH 任意命令执行、命令拼接注入、本地凭证存储、宽泛文件权限、供应链依赖），说明安全风险会直接传导到用户的线上服务器，而不是简单写"提高安全性"。

---

## 4. 你将如何针对自己的项目使用 API 额度？

**推荐英文最终版（490 chars）**
> Automated PR/commit review via Codex CLI + GitHub Actions, focused on the SSH command layer (shell injection, unsafe fs/network, secret leakage) before merge. Expand test coverage (one vitest file today) with tests for ssh_exec, SFTP, Docker streaming, MySQL ops (cargo test + vitest). Security refactors: centralized command builder with shell escaping, parameterized queries, encrypted at-rest credentials. Automate release hygiene: changelogs, i18n sync, issue triage, dependency audits.

**中文翻译**
> 通过 Codex CLI + GitHub Actions 对 PR 和提交进行自动化审查，聚焦 SSH 命令层（shell 注入、不安全的文件/网络访问、密钥泄露），在合并前拦截问题。扩充测试覆盖（目前仅 1 个 vitest 文件），为 ssh_exec、SFTP、Docker 流式操作、MySQL 操作生成单元/集成测试（cargo test + vitest）。推进安全重构：集中化命令构造器（统一 shell 转义）、参数化查询、凭证静态加密。自动化发布卫生工作：更新日志、中英文 i18n 同步、Issue 分类、依赖升级审计。

**为什么这样写**：把额度绑定到可落地、可验证的维护流水线（合并前安全审查、补测试、安全重构、发布自动化），每一类工作都对应项目当前的真实短板，而不是空谈"用 AI 提高效率"。

---

## 5. 还有其他需要说明的事项吗？

**推荐英文最终版（446 chars）**
> LeePanel is young (public since July 2026) but sits in a security-critical category where mistakes cost users' servers. Traction is real and verifiable: 142 stars in six weeks and releases downloaded on Windows/macOS/Linux. As a solo, unfunded maintainer, Codex credits would let me sustain daily maintenance, harden the SSH command layer, and build contributor-friendly processes so more people can safely help maintain a zero-agent Linux panel.

**中文翻译**
> LeePanel 还很年轻（2026 年 7 月公开），但它处于安全关键型领域，任何失误都会直接损害用户的服务器。项目增长真实可查：六周内获得 142 个 Star，Windows/macOS/Linux 平台均有发布下载。作为单人不拿资助的维护者，Codex 额度能让我维持每日维护、加固 SSH 命令层，并建立对贡献者友好的流程，让更多人能够安全地参与维护这款零后端的 Linux 面板。

**为什么这样写**：主动坦白"项目年轻、单人维护"的事实，同时用可查的增长数据和"长期维护责任 + 让社区安全参与"的规划打消审核方对可持续性的疑虑，态度诚实且务实。

---

## 最推荐提交版本（可直接复制）

**1. What is your role — are you the primary or core maintainer?**
I am the sole creator and primary maintainer of LeePanel (github.com/gna1280072/LeePanel). I am the only contributor (1/1), author of all 284 commits, and I handle every release, issue, review and security decision. There is no core team; every merged change is my responsibility.

**2. Why does this repository qualify?**
LeePanel (MIT) is an open-source Linux server management panel: a Tauri 2 + Rust + React desktop client managing Nginx/MySQL/PHP/Redis/Docker, SSH terminal and SFTP over local SSH only, zero server-side installation, eliminating the web-panel attack surface. Verified via GitHub API (2026-08-15): 142 stars, 3 forks, 284 commits, 5 releases, 346 downloads, daily active development, en/zh community, website leepanel.com. Server tooling is security-critical open-source infrastructure.

**3. Why does your project need Codex Security?**
LeePanel runs arbitrary shell commands on users' servers over SSH; any malicious or injected code means full root compromise. The ~377 KB Rust layer builds shell strings from user-supplied site/DB/file names (injection); SSH/MySQL credentials persist in a local SQLite store with unaudited at-rest protection; Tauri capabilities allow broad local file reads. As sole maintainer, automated review for malicious commits, hardcoded secrets, injection patterns and unsafe dependency diffs protects users.

**4. How will you use the API credits for your project?**
Automated PR/commit review via Codex CLI + GitHub Actions, focused on the SSH command layer (shell injection, unsafe fs/network, secret leakage) before merge. Expand test coverage (one vitest file today) with tests for ssh_exec, SFTP, Docker streaming, MySQL ops (cargo test + vitest). Security refactors: centralized command builder with shell escaping, parameterized queries, encrypted at-rest credentials. Automate release hygiene: changelogs, i18n sync, issue triage, dependency audits.

**5. Anything else we should know?**
LeePanel is young (public since July 2026) but sits in a security-critical category where mistakes cost users' servers. Traction is real and verifiable: 142 stars in six weeks and releases downloaded on Windows/macOS/Linux. As a solo, unfunded maintainer, Codex credits would let me sustain daily maintenance, harden the SSH command layer, and build contributor-friendly processes so more people can safely help maintain a zero-agent Linux panel.
