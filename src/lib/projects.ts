import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import type { Project } from "@/types/project";

const PHONECC_DIR = path.join(os.homedir(), ".phonecc");
const PROJECTS_FILE = path.join(PHONECC_DIR, "projects.json");

async function ensurePhoneccDir() {
  await fs.mkdir(PHONECC_DIR, { recursive: true });
}

export async function readProjects(): Promise<Project[]> {
  try {
    const data = await fs.readFile(PROJECTS_FILE, "utf-8");
    return JSON.parse(data) as Project[];
  } catch {
    return [];
  }
}

async function writeProjects(projects: Project[]): Promise<void> {
  await ensurePhoneccDir();
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
}

export async function addProject(data: {
  name: string;
  repoUrl: string;
  defaultBranch: string;
}): Promise<Project> {
  const projects = await readProjects();
  const project: Project = {
    id: crypto.randomUUID(),
    name: data.name,
    repoUrl: data.repoUrl,
    defaultBranch: data.defaultBranch,
  };
  projects.push(project);
  await writeProjects(projects);
  return project;
}

export async function removeProject(id: string): Promise<boolean> {
  const projects = await readProjects();
  const filtered = projects.filter((p) => p.id !== id);
  if (filtered.length === projects.length) return false;
  await writeProjects(filtered);
  return true;
}
