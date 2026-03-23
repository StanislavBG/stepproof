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
export interface TelemetryPayload {
    command: string;
    success: boolean;
    version: string;
    /** Optional: outcome label — 'pass' | 'fail' | 'error' */
    outcome?: string;
    /** Process exit code */
    exit_code?: number;
    /** Command wall-clock duration in milliseconds */
    duration_ms?: number;
}
/**
 * Send a telemetry ping. Returns a Promise that resolves within 3 seconds.
 * Always resolves — never throws or rejects.
 */
export declare function sendTelemetry(payload: TelemetryPayload): Promise<void>;
//# sourceMappingURL=telemetry.d.ts.map