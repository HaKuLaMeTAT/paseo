import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const ObjectSchema = z.record(z.string(), z.unknown());
function mergeProfile(current: unknown, profile: unknown): unknown {
  const patch = ObjectSchema.safeParse(profile);
  if (!patch.success) return profile;
  const base = ObjectSchema.safeParse(current);
  const result = { ...(base.success ? base.data : {}) };
  for (const [key, value] of Object.entries(patch.data)) {
    Object.defineProperty(result, key, {
      value: mergeProfile(result[key], value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/** Apply the bundled profile once, backing up existing host configuration. */
export async function applyLightweightProfile(home: string, profilePath: string): Promise<void> {
  const marker = path.join(home, ".lightweight-profile-v1");
  try {
    await access(marker);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const configPath = path.join(home, "config.json");
  const profile = ObjectSchema.parse(JSON.parse(await readFile(profilePath, "utf8")));
  let current: Record<string, unknown> = {};
  let existed = false;
  try {
    current = ObjectSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
    existed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const merged = ObjectSchema.parse(mergeProfile(current, profile));
  const currentAgents = ObjectSchema.safeParse(current.agents);
  const currentProviders = ObjectSchema.safeParse(
    currentAgents.success ? currentAgents.data.providers : undefined,
  );
  const cursor = ObjectSchema.safeParse(
    currentProviders.success ? currentProviders.data.cursor : undefined,
  );
  if (cursor.success) {
    const agents = ObjectSchema.parse(merged.agents);
    const providers = ObjectSchema.parse(agents.providers);
    providers.cursor = { ...ObjectSchema.parse(providers.cursor), ...cursor.data, enabled: true };
    agents.providers = providers;
    merged.agents = agents;
  }
  await mkdir(home, { recursive: true });
  if (existed)
    await copyFile(
      configPath,
      path.join(home, `config.before-lite-${Date.now()}.json`),
      constants.COPYFILE_EXCL,
    );
  const temporary = `${configPath}.lite-${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
  await writeFile(marker, "1\n", { mode: 0o600 });
}
