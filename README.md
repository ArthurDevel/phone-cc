# PhoneCC

Mobile voice coding with parallel Claude Code sessions.

## Deploy to a VPS

You need a fresh Ubuntu 24.04 VPS. Have these ready:

- GitHub Personal Access Token (repo scope)
- Deepgram API key (optional, for voice input)

### 1. SSH into your server

```bash
ssh user@your-server-ip
```

### 2. Install Node.js and Claude Code

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g @anthropic-ai/claude-code
```

### 3. Let Claude Code do the rest

```bash
claude
```

Once inside Claude Code, paste the contents of [`INSTALL.md`](./INSTALL.md). It handles the full setup: clone, build, server hardening (UFW + fail2ban), and systemd autostart. It will ask you for your env variables and tell you when to start the app to grab your auth token. Follow along -- the whole process takes a few minutes.

## Local development

```bash
pnpm install
pnpm dev:all
```

This starts the Next.js dev server on port 3000 and the Deepgram WebSocket server on port 3001.
