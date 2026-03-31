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

Once inside Claude Code, paste the contents of [`INSTALL.md`](./INSTALL.md). It will walk you through the full setup: clone, build, server hardening (UFW + fail2ban), and systemd autostart. It will ask you for your API keys along the way.

### 4. Start the app and grab your token

When Claude Code finishes, it will print instructions. The key step: start the app manually first so you can see your auth token in the output.

```bash
cd /opt/phonecc && npx next start
```

Copy the `phcc_...` token, then open `http://<server-ip>:3000?token=phcc_...` to log in.

### 5. Hand off to systemd

Once you've confirmed it works, stop the manual process (Ctrl+C) and start the background services:

```bash
sudo systemctl start phonecc
sudo systemctl start phonecc-ws
```

The app will now autostart on reboot.

## Local development

```bash
pnpm install
pnpm dev:all
```

This starts the Next.js dev server on port 3000 and the Deepgram WebSocket server on port 3001.
