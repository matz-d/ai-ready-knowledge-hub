/**
 * PoC-only MarkItDown bridge (Phase 3-H §4).
 *
 * Invokes Python MarkItDown via local `uvx` — never bundled in Dockerfile /
 * mainline Node build. Requires `uv` on PATH and network on first `uvx` fetch.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MARKITDOWN_UVX_FROM = 'markitdown[pdf]' as const;

export type MarkitDownAvailability = {
  available: boolean;
  command: string;
  error?: string;
};

export type ExtractMarkdownOptions = {
  inputPath: string;
  /** Override for tests; default `uvx`. */
  uvxCommand?: string;
  timeoutMs?: number;
};

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
    });
    return {
      stdout: typeof stdout === 'string' ? stdout : String(stdout),
      stderr: typeof stderr === 'string' ? stderr : String(stderr),
      code: 0,
    };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'stdout' in err) {
      const execErr = err as {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        code?: number | string;
        message?: string;
      };
      return {
        stdout:
          typeof execErr.stdout === 'string'
            ? execErr.stdout
            : execErr.stdout?.toString('utf8') ?? '',
        stderr:
          typeof execErr.stderr === 'string'
            ? execErr.stderr
            : execErr.stderr?.toString('utf8') ??
              execErr.message ??
              'MarkItDown failed',
        code:
          typeof execErr.code === 'number'
            ? execErr.code
            : Number.parseInt(String(execErr.code ?? '1'), 10) || 1,
      };
    }
    throw err;
  }
}

export async function checkMarkitDownAvailable(
  uvxCommand = 'uvx'
): Promise<MarkitDownAvailability> {
  const command = `${uvxCommand} --from ${MARKITDOWN_UVX_FROM} markitdown`;
  try {
    const { code, stderr } = await runCommand(
      uvxCommand,
      ['--from', MARKITDOWN_UVX_FROM, 'markitdown', '--help'],
      120_000
    );
    if (code === 0) {
      return { available: true, command };
    }
    return {
      available: false,
      command,
      error: stderr.trim() || `exit code ${code ?? 'unknown'}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, command, error: message };
  }
}

/**
 * Converts a local PDF to Markdown stdout via MarkItDown.
 */
export async function extractMarkdown(
  options: ExtractMarkdownOptions
): Promise<string> {
  const uvxCommand = options.uvxCommand ?? 'uvx';
  const timeoutMs = options.timeoutMs ?? 300_000;
  const { stdout, stderr, code } = await runCommand(
    uvxCommand,
    ['--from', MARKITDOWN_UVX_FROM, 'markitdown', options.inputPath],
    timeoutMs
  );
  if (code !== 0) {
    throw new Error(
      `MarkItDown failed (exit ${code ?? 'unknown'}): ${stderr.trim() || 'no stderr'}`
    );
  }
  const markdown = stdout.trim();
  if (markdown.length === 0) {
    throw new Error('MarkItDown returned empty markdown');
  }
  return markdown;
}
