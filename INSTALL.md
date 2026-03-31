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
cd /opt
sudo git clone https://github.com/ArthurDevel/phone-cc.git phonecc
sudo chown -R $USER:$USER /opt/phonecc
cd /opt/phonecc
pnpm install
pnpm build
```

### Phase 3: Environment file

Copy the example env file and tell me to fill in my credentials:

```
cp /opt/phonecc/.env.example /opt/phonecc/.env.local
chmod 600 /opt/phonecc/.env.local
```

Then tell me to edit it: `nano /opt/phonecc/.env.local`

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
WorkingDirectory=/opt/phonecc
EnvironmentFile=/opt/phonecc/.env.local
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
WorkingDirectory=/opt/phonecc
EnvironmentFile=/opt/phonecc/.env.local
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

### Phase 7: Done -- tell me what to do next

Print this message (with the actual values filled in):

```
============================================================
  Setup complete. To start PhoneCC:

  1. Start the app manually to see your auth token:
     cd /opt/phonecc && npx next start

  2. Copy the token from the output (phcc_...) and save it.
     You can also find it later at: ~/.phonecc/auth-token

  3. Open http://{SERVER_IP}:3000?token={YOUR_TOKEN} to log in.

  4. Once confirmed working, stop the manual process (Ctrl+C)
     and start the systemd services:
     sudo systemctl start phonecc
     sudo systemctl start phonecc-ws

  5. Verify both services are running:
     sudo systemctl status phonecc phonecc-ws
============================================================
```
