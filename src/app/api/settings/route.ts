import { NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/settings";

export async function GET() {
  const settings = await readSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const settings = await writeSettings(body);
  return NextResponse.json(settings);
}
