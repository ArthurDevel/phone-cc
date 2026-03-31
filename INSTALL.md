You are setting up PhoneCC on a fresh Ubuntu 24.04 VPS. Follow these phases in order. After each phase, print a short status line confirming what was done. Ask me for any values you need (API keys, etc.) before proceeding.

### Phase 1: System packages

```
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw fail2ban
```

Install pnpm globally:

```
npm install -g pnpm
```

### Phase 2: Clone and build

```
git clone https://github.com/ArthurDevel/phone-cc.git ~/phonecc
cd ~/phonecc
pnpm install
pnpm build
```

### Phase 3: Environment file

Copy the example env file and tell me to fill in my credentials:

```
cp ~/phonecc/.env.example ~/phonecc/.env.local
chmod 600 ~/phonecc/.env.local
```

Then tell me to edit it: `nano ~/phonecc/.env.local`

Wait for me to confirm before continuing.

### Phase 4: Firewall (UFW)

```
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 3000/tcp
sudo ufw --force enable
```

Do NOT open port 3001. The Deepgram WS server is already bound to 127.0.0.1.

### Phase 5: Fail2ban

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

### Phase 6: Systemd services (autostart)

Create two systemd unit files.

**`/etc/systemd/system/phonecc.service`**:

```
[Unit]
Description=PhoneCC Next.js app
After=network.target

[Service]
Type=simple
User={USER}
WorkingDirectory=/home/{USER}/phonecc
EnvironmentFile=/home/{USER}/phonecc/.env.local
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
User={USER}
WorkingDirectory=/home/{USER}/phonecc
EnvironmentFile=/home/{USER}/phonecc/.env.local
ExecStart=/usr/bin/npx tsx src/server/deepgram-ws.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Replace `{USER}` with the current non-root username (run `whoami`).

Enable both services so they start on boot:

```
sudo systemctl daemon-reload
sudo systemctl enable phonecc
sudo systemctl enable phonecc-ws
```

**Do NOT start them yet.**

### Phase 7: First run

Tell me to run this command myself so I can see the auth token:

```
cd ~/phonecc && npx next start
```

Tell me to copy the `phcc_...` token from the output and save it. Tell me the login URL: `http://{SERVER_IP}:3000?token={TOKEN}` (fill in the server IP). Then wait for me to confirm I've saved the token before continuing.

### Phase 8: Start services

Once I confirm, stop the manual process for me (or tell me to Ctrl+C), then start and verify both services:

```
sudo systemctl start phonecc
sudo systemctl start phonecc-ws
sudo systemctl status phonecc phonecc-ws
```

Confirm both are running. If either failed, troubleshoot.
