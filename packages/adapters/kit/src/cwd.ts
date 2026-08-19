import { realpath, stat } from "node:fs/promises";

export async function validateCwd(
  cwd: string,
): Promise<{ ok: true; cwd: string } | { ok: false; message: string }> {
  try {
    const resolved = await realpath(cwd);
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      return { ok: false, message: `cwd is not a directory: ${cwd}` };
    }
    return { ok: true, cwd: resolved };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : `invalid cwd: ${cwd}`,
    };
  }
}

export async function resolveCwd(cwd: string): Promise<string> {
  const check = await validateCwd(cwd);
  return check.ok ? check.cwd : cwd;
}
