import * as fs from 'node:fs';
/**
 * Lightweight CSV parser. Handles quoted fields (including escaped quotes "").
 * O(n) where n = file size.
 */
export function loadDataset(csvPath) {
    let content;
    try {
        content = fs.readFileSync(csvPath, 'utf-8');
    }
    catch (e) {
        throw new Error(`Cannot read dataset file: ${csvPath}`);
    }
    const lines = parseCSVLines(content);
    if (lines.length < 2) {
        throw new Error(`Dataset file must have a header row and at least one data row: ${csvPath}`);
    }
    const headers = lines[0];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = lines[i];
        if (fields.length === 1 && fields[0] === '')
            continue; // skip blank lines
        if (fields.length !== headers.length) {
            throw new Error(`Dataset row ${i} has ${fields.length} fields, expected ${headers.length}`);
        }
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = fields[j];
        }
        rows.push(row);
    }
    if (rows.length === 0) {
        throw new Error(`Dataset file has no data rows: ${csvPath}`);
    }
    return rows;
}
/**
 * Parse CSV content into array of field arrays.
 * Handles: quoted fields, embedded commas, embedded newlines in quotes, escaped quotes ("").
 */
function parseCSVLines(content) {
    const results = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;
    while (i < content.length) {
        const ch = content[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < content.length && content[i + 1] === '"') {
                    // Escaped quote
                    currentField += '"';
                    i += 2;
                }
                else {
                    // End of quoted field
                    inQuotes = false;
                    i++;
                }
            }
            else {
                currentField += ch;
                i++;
            }
        }
        else {
            if (ch === '"') {
                inQuotes = true;
                i++;
            }
            else if (ch === ',') {
                currentRow.push(currentField);
                currentField = '';
                i++;
            }
            else if (ch === '\r') {
                // Handle \r\n and lone \r
                currentRow.push(currentField);
                currentField = '';
                results.push(currentRow);
                currentRow = [];
                i++;
                if (i < content.length && content[i] === '\n')
                    i++;
            }
            else if (ch === '\n') {
                currentRow.push(currentField);
                currentField = '';
                results.push(currentRow);
                currentRow = [];
                i++;
            }
            else {
                currentField += ch;
                i++;
            }
        }
    }
    // Flush last field/row
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        results.push(currentRow);
    }
    return results;
}
//# sourceMappingURL=dataset.js.map