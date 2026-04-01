import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const PORT_FILE = path.resolve(process.cwd(), ".deepgram-ws-port");

export async function GET() {
  try {
    const port = fs.readFileSync(PORT_FILE, "utf-8").trim();
    return NextResponse.json({ wsUrl: `ws://localhost:${port}/deepgram` });
  } catch {
    return NextResponse.json({ error: "Deepgram WS server not running" }, { status: 503 });
  }
}
