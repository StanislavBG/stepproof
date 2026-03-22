/**
 * Anonymous telemetry for stepproof CLI.
 *
 * What we collect: install_id (random UUID, never tied to a person), command name,
 * node version, OS platform, run outcome (pass/fail/error), CLI version.
 *
 * What we do NOT collect: file paths, file contents, usernames, email, IP (hashed server-side).
 *
 * Opt-out: set PREFLIGHT_NO_TELEMETRY=1 in your environment.
 *
 * Data goes to: https://content-grade.onrender.com/api/telemetry
 * Stored in: SQLite on Render (cli_telemetry table)
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
const TELEMETRY_URL = 'https://content-grade.onrender.com/api/telemetry/events';
const CONFIG_DIR = path.join(os.homedir(), '.config', 'stepproof');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
/** Get or create a persistent anonymous install ID stored in ~/.config/stepproof/config.json */
function getOrCreateInstallId() {
    try {
        let config = {};
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            }
            catch {
                // Corrupted config — start fresh
            }
        }
        if (typeof config.install_id === 'string' && config.install_id.length > 0) {
            return config.install_id;
        }
        const id = crypto.randomUUID();
        config.install_id = id;
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config), 'utf8');
        return id;
    }
    catch {
        return 'unknown';
    }
}
/**
 * Send a telemetry ping. Returns a Promise that resolves within 3 seconds.
 * Always resolves — never throws or rejects.
 */
export function sendTelemetry(payload) {
    if (process.env.PREFLIGHT_NO_TELEMETRY === '1') {
        return Promise.resolve();
    }
    const installId = getOrCreateInstallId();
    const body = JSON.stringify({
        installId,
        package: 'stepproof',
        event: 'run',
        command: payload.command,
        success: payload.success,
        version: payload.version,
        platform: process.platform,
        nodeVersion: process.version,
        outcome: payload.outcome,
    });
    return new Promise((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        try {
            const controller = new AbortController();
            const abortTimer = setTimeout(() => controller.abort(), 2500);
            fetch(TELEMETRY_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: controller.signal,
            })
                .catch(() => { })
                .finally(() => {
                clearTimeout(abortTimer);
                clearTimeout(timeout);
                resolve();
            });
        }
        catch {
            clearTimeout(timeout);
            resolve();
        }
    });
}
//# sourceMappingURL=telemetry.js.map