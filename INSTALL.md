You are setting up PhoneCC on a fresh Ubuntu 24.04 VPS. Follow these phases in order. After each phase, print a short status line confirming what was done. Ask me for any values you need (API keys, etc.) before proceeding.

### Phase 1: System packages (run as root)

```
apt update && apt upgrade -y
apt install -y curl git ufw fail2ban nodejs npm
npm install -g pnpm
```

### Phase 2: Create a deploy user

Claude Code refuses `--dangerously-skip-permissions` when running as root. All app work must happen under a non-root user.

```
adduser --disabled-password --gecos "" phonecc
```

This creates a passwordless service account. It's secure — password-based SSH login is blocked, and the only way in is `su - phonecc` from root.

Switch to the new user for all remaining phases:

```
su - phonecc
```

### Phase 3: Install Claude Code CLI and authenticate

Install the CLI globally (run as root first, then switch back):

```
exit
npm install -g @anthropic-ai/claude-code
su - phonecc
```

Now tell me to run `claude login` in this shell. This requires interactive browser auth and cannot be done by the agent. Wait for me to confirm I've completed the login flow before continuing.

### Phase 4: Clone and build

```
git clone https://github.com/ArthurDevel/phone-cc.git ~/phonecc
cd ~/phonecc
pnpm install
pnpm build
```

### Phase 5: Environment file

Copy the example env file and tell me to fill in my credentials:

```
cp ~/phonecc/.env.example ~/phonecc/.env.local
chmod 600 ~/phonecc/.env.local
```

Then tell me to edit it: `nano ~/phonecc/.env.local`

Wait for me to confirm before continuing.

### Phase 6: Firewall (UFW)

Run these as root (exit back to root or use sudo):

```
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 3000/tcp
sudo ufw --force enable
```

Do NOT open port 3001. The Deepgram WS server is already bound to 127.0.0.1.

### Phase 7: Fail2ban

Enable fail2ban with default SSH jail:

```
sudo systemctl enable --now fail2ban
```

Create `/etc/fail2ban/jail.local`:

```
[sshd]
enabled = true
port = ssh
maxretry = 5
bantime = 3600
```

Restart fail2ban: `sudo systemctl restart fail2ban`

### Phase 8: Systemd services (autostart)

Create two systemd unit files.

**`/etc/systemd/system/phonecc.service`**:

```
[Unit]
Description=PhoneCC Next.js app
After=network.target

[Service]
Type=simple
User=phonecc
WorkingDirectory=/home/phonecc/phonecc
EnvironmentFile=/home/phonecc/phonecc/.env.local
Environment=NODE_ENV=production
ExecStart=/usr/bin/npx next start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/phonecc-ws.service`**:

```
[Unit]
Description=PhoneCC Deepgram WebSocket server
After=network.target

[Service]
Type=simple
User=phonecc
WorkingDirectory=/home/phonecc/phonecc
EnvironmentFile=/home/phonecc/phonecc/.env.local
ExecStart=/usr/bin/npx tsx src/server/deepgram-ws.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable both services so they start on boot:

```
sudo systemctl daemon-reload
sudo systemctl enable phonecc
sudo systemctl enable phonecc-ws
```

**Do NOT start them yet.**

### Phase 9: First run

Tell me to run this command myself so I can see the auth token:

```
cd ~/phonecc && npx next start
```

Tell me to copy the `phcc_...` token from the output and save it. Tell me the login URL: `http://{SERVER_IP}:3000?token={TOKEN}` (fill in the server IP). Then wait for me to confirm I've saved the token before continuing.

### Phase 10: Start services

Once I confirm, stop the manual process for me (or tell me to Ctrl+C), then start and verify both services:

```
sudo systemctl start phonecc
sudo systemctl start phonecc-ws
sudo systemctl status phonecc phonecc-ws
```

Confirm both are running. If either failed, troubleshoot.

### Phase 11: Updater service (self-update from settings page)

The updater is a standalone HTTP server that runs alongside the Next.js app. It handles `git pull`, `pnpm install`, `pnpm build`, and service restarts so the user can update from the Settings page without SSH.

**Note**: The VPS clone is treated as read-only. The updater uses `git reset --hard` to pull updates, so never make local edits to files on the VPS.

#### Sudoers

The `phonecc` user needs passwordless sudo for the two restart commands. Create `/etc/sudoers.d/phonecc-updater`:

```
phonecc ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart phonecc, /usr/bin/systemctl restart phonecc-ws
```

#### Systemd service

Create **`/etc/systemd/system/phonecc-updater.service`**:

```
[Unit]
Description=PhoneCC Updater service
After=network.target

[Service]
Type=simple
User=phonecc
WorkingDirectory=/home/phonecc/phonecc
ExecStart=/usr/bin/npx tsx src/server/updater.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```
sudo systemctl daemon-reload
sudo systemctl enable phonecc-updater
sudo systemctl start phonecc-updater
sudo systemctl status phonecc-updater
```

Do NOT open port 9473 in UFW. The updater binds to 127.0.0.1 only.
