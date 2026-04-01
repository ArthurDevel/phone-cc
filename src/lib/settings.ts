import fs from "fs/promises";
import path from "path";
import os from "os";

const PHONECC_DIR = path.join(os.homedir(), ".phonecc");
const SETTINGS_FILE = path.join(PHONECC_DIR, "settings.json");

export interface AppSettings {
  enableCloudMcpServers: boolean;
}

const DEFAULTS: AppSettings = {
  enableCloudMcpServers: false,
};

export async function readSettings(): Promise<AppSettings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, "utf-8");
    const saved = JSON.parse(data) as Partial<AppSettings>;
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeSettings(
  partial: Partial<AppSettings>
): Promise<AppSettings> {
  const current = await readSettings();
  const updated = { ...current, ...partial };
  await fs.mkdir(PHONECC_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}
