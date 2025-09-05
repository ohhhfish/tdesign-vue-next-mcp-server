/*
 * Parse TDesign-like component docs (Markdown tables) into JSON.
 * Usage:
 *   node build/scripts/parseComponentDoc.js <path-to-md | ->
 *   - If path is '-', read from stdin
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface ParsedPropRow {
    name: string;
    type: string;
    defaultValue: string | null;
    description: string;
    required: boolean;
}

interface ParsedEventRow {
    name: string;
    params: string;
    description: string;
}

interface ComponentDocJson {
    component: string;
    props: ParsedPropRow[];
    events: ParsedEventRow[];
    methods?: ParsedMethodRow[];
}

interface ParsedMethodRow {
    name: string;
    params: string;
    returnType: string;
    description: string;
}

function readAllFromStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => { data += chunk; });
        process.stdin.on("end", () => resolve(data));
        process.stdin.on("error", reject);
    });
}

function normalizeLine(line: string): string {
    return line.trimEnd();
}

function extractSection(lines: string[], heading: string): string[] {
    const startIdx = lines.findIndex(l => l.trim().toLowerCase().startsWith(`### ${heading.toLowerCase()}`));
    if (startIdx === -1) return [];
    const out: string[] = [];
    for (let i = startIdx + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim().startsWith("### ")) break;
        out.push(line);
    }
    return out;
}

function extractFirstTable(sectionLines: string[]): string[] {
    const lines = sectionLines.map(normalizeLine);
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        const t = lines[i].trim();
        if (t.startsWith("|") || (t.includes("|") && !t.startsWith("###"))) {
            // Heuristic: a table header row usually contains pipes and is followed by a separator row
            if (i + 1 < lines.length && /\|\s*-{2,}/.test(lines[i + 1])) {
                start = i;
                break;
            }
        }
    }
    if (start === -1) return [];
    const table: string[] = [];
    for (let i = start; i < lines.length; i += 1) {
        const t = lines[i];
        if (!t.includes("|")) break;
        if (t.trim() === "") break;
        table.push(t);
        // stop when encountering a blank line after rows
        if (i + 1 < lines.length && lines[i + 1].trim() === "") break;
    }
    return table;
}

function splitRowPreservingEscapedPipes(row: string): string[] {
    // Replace escaped pipes (\|) with a placeholder, split, then restore
    const PLACEHOLDER = "__ESCAPED_PIPE__";
    const replaced = row.replace(/\\\|/g, PLACEHOLDER);
    const parts = replaced
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(p => p.trim().replace(new RegExp(PLACEHOLDER, "g"), "|"));
    return parts;
}

function parseMarkdownTable(tableLines: string[]): { headers: string[]; rows: string[][] } {
    if (tableLines.length < 2) return { headers: [], rows: [] };
    const headerLine = tableLines[0];
    const headers = splitRowPreservingEscapedPipes(headerLine).map(h => h.toLowerCase());
    // Skip the separator row (second line). Remaining lines are data rows
    const dataRows = tableLines.slice(2).filter(l => l.trim().length > 0 && l.includes("|"));
    const rows = dataRows.map(splitRowPreservingEscapedPipes);
    return { headers, rows };
}

function parsePropsTable(tableLines: string[]): ParsedPropRow[] {
    const { headers, rows } = parseMarkdownTable(tableLines);
    if (headers.length === 0) return [];
    const nameIdx = headers.indexOf("名称");
    const typeIdx = headers.indexOf("类型");
    const defaultIdx = headers.indexOf("默认值");
    const descIdx = headers.indexOf("说明");
    const requiredIdx = headers.indexOf("必传");
    const result: ParsedPropRow[] = [];
    rows.forEach(cols => {
        const name = (cols[nameIdx] || "").trim();
        const type = (cols[typeIdx] || "").trim();
        const defaultValueRaw = (cols[defaultIdx] || "").trim();
        const description = (cols[descIdx] || "").trim();
        const requiredRaw = (cols[requiredIdx] || "").trim().toUpperCase();
        const defaultValue = defaultValueRaw === "-" || defaultValueRaw === "" ? null : defaultValueRaw;
        const required = requiredRaw === "Y" || requiredRaw === "YES";
        result.push({ name, type, defaultValue, description, required });
    });
    return result;
}

function parseEventsTable(tableLines: string[]): ParsedEventRow[] {
    const { headers, rows } = parseMarkdownTable(tableLines);
    if (headers.length === 0) return [];
    const nameIdx = headers.indexOf("名称");
    const paramsIdx = headers.indexOf("参数");
    const descIdx = headers.indexOf("描述");
    const result: ParsedEventRow[] = [];
    rows.forEach(cols => {
        const name = (cols[nameIdx] || "").trim();
        const params = (cols[paramsIdx] || "").trim();
        const description = (cols[descIdx] || "").trim();
        result.push({ name, params, description });
    });
    return result;
}

function parseMethodsTable(tableLines: string[]): ParsedMethodRow[] {
    const { headers, rows } = parseMarkdownTable(tableLines);
    if (headers.length === 0) return [];
    const nameIdx = headers.indexOf("名称");
    const paramsIdx = headers.indexOf("参数");
    const returnIdx = headers.indexOf("返回值");
    const descIdx = headers.indexOf("描述");
    const result: ParsedMethodRow[] = [];
    rows.forEach(cols => {
        const name = (cols[nameIdx] || "").trim();
        const params = (cols[paramsIdx] || "").trim();
        const returnType = (cols[returnIdx] || "").trim();
        const description = (cols[descIdx] || "").trim();
        result.push({ name, params, returnType, description });
    });
    return result;
}

function parseMultiComponentDoc(lines: string[]): ComponentDocJson[] {
    const components: ComponentDocJson[] = [];
    
    // Find all component sections by looking for "### ComponentName Props" patterns
    const componentHeadings = lines
        .map((line, index) => ({ line: line.trim(), index }))
        .filter(({ line }) => line.toLowerCase().startsWith("### ") && line.toLowerCase().includes("props"));
    
    for (const { line, index } of componentHeadings) {
        const component = line.replace(/^\s*###\s*/i, "").replace(/\s+Props.*/i, "").trim();
        
        // Extract sections for this component
        const propsSection = extractSection(lines, `${component} Props`);
        const eventsSection = extractSection(lines, `${component} Events`);
        const methodsSection = extractSection(lines, `${component}InstanceFunctions 组件实例方法`);

        const propsTable = extractFirstTable(propsSection);
        const eventsTable = extractFirstTable(eventsSection);
        const methodsTable = extractFirstTable(methodsSection);

        const json: ComponentDocJson = {
            component,
            props: parsePropsTable(propsTable),
            events: parseEventsTable(eventsTable),
            methods: methodsTable.length > 0 ? parseMethodsTable(methodsTable) : undefined,
        };
        
        components.push(json);
    }
    
    return components;
}

function findMarkdownFiles(dirPath: string): string[] {
    const files: string[] = [];
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        if (item.isDirectory()) {
            files.push(...findMarkdownFiles(fullPath));
        } else if (item.isFile() && item.name.toLowerCase().endsWith('.md')) {
            files.push(fullPath);
        }
    }
    
    return files;
}

async function processMarkdownFile(filePath: string): Promise<ComponentDocJson[]> {
    const md = fs.readFileSync(filePath, "utf8");
    const lines = md.split(/\r?\n/);

    // Check if this is a multi-component document
    const componentHeadings = lines.filter(l => l.trim().toLowerCase().startsWith("### ") && l.trim().toLowerCase().includes("props"));
    
    if (componentHeadings.length > 1) {
        // Multi-component document
        const components = parseMultiComponentDoc(lines);
        
        // Process each component
        for (const json of components) {
            await processComponent(json);
        }
        
        return components;
    } else {
        // Single component document (original logic)
        const propsHeadingLine = lines.find(l => l.trim().toLowerCase().startsWith("### ") && l.toLowerCase().includes("props"));
        const component = propsHeadingLine ? propsHeadingLine.replace(/^\s*###\s*/i, "").replace(/\s+Props.*/i, "").trim() : "Unknown";

        const propsSection = extractSection(lines, `${component} Props`);
        const eventsSection = extractSection(lines, `${component} Events`);
        const methodsSection = extractSection(lines, `${component}InstanceFunctions 组件实例方法`);

        const propsTable = extractFirstTable(propsSection);
        const eventsTable = extractFirstTable(eventsSection);
        const methodsTable = extractFirstTable(methodsSection);

        const json: ComponentDocJson = {
            component,
            props: parsePropsTable(propsTable),
            events: parseEventsTable(eventsTable),
            methods: methodsTable.length > 0 ? parseMethodsTable(methodsTable) : undefined,
        };
        
        await processComponent(json);
        return [json];
    }
}

async function main(): Promise<void> {
    const arg = process.argv[2];
    
    if (!arg || arg === "-") {
        // Read from stdin
        const md = await readAllFromStdin();
        const lines = md.split(/\r?\n/);
        const componentHeadings = lines.filter(l => l.trim().toLowerCase().startsWith("### ") && l.trim().toLowerCase().includes("props"));
        
        if (componentHeadings.length > 1) {
            const components = parseMultiComponentDoc(lines);
            for (const json of components) {
                await processComponent(json);
            }
            process.stdout.write(JSON.stringify(components, null, 2));
        } else {
            const propsHeadingLine = lines.find(l => l.trim().toLowerCase().startsWith("### ") && l.toLowerCase().includes("props"));
            const component = propsHeadingLine ? propsHeadingLine.replace(/^\s*###\s*/i, "").replace(/\s+Props.*/i, "").trim() : "Unknown";

            const propsSection = extractSection(lines, `${component} Props`);
            const eventsSection = extractSection(lines, `${component} Events`);
            const methodsSection = extractSection(lines, `${component}InstanceFunctions 组件实例方法`);

            const propsTable = extractFirstTable(propsSection);
            const eventsTable = extractFirstTable(eventsSection);
            const methodsTable = extractFirstTable(methodsSection);

            const json: ComponentDocJson = {
                component,
                props: parsePropsTable(propsTable),
                events: parseEventsTable(eventsTable),
                methods: methodsTable.length > 0 ? parseMethodsTable(methodsTable) : undefined,
            };
            
            await processComponent(json);
            process.stdout.write(JSON.stringify(json, null, 2));
        }
    } else {
        const absolute = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
        const stat = fs.statSync(absolute);
        
        if (stat.isDirectory()) {
            // Process directory
            const mdFiles = findMarkdownFiles(absolute);
            console.error(`[parseComponentDoc] Found ${mdFiles.length} markdown files in directory`);
            
            const allComponents: ComponentDocJson[] = [];
            for (const filePath of mdFiles) {
                console.error(`[parseComponentDoc] Processing: ${path.relative(process.cwd(), filePath)}`);
                try {
                    const components = await processMarkdownFile(filePath);
                    allComponents.push(...components);
                } catch (error) {
                    console.error(`[parseComponentDoc] Error processing ${filePath}:`, error);
                }
            }
            
            process.stdout.write(JSON.stringify(allComponents, null, 2));
        } else if (stat.isFile()) {
            // Process single file
            const components = await processMarkdownFile(absolute);
            process.stdout.write(JSON.stringify(components, null, 2));
        } else {
            throw new Error(`Path is neither a file nor a directory: ${absolute}`);
        }
    }
}

async function processComponent(json: ComponentDocJson): Promise<void> {
    // Persist to project: src/data/components/<component>.json
    const projectRoot = process.cwd();
    const dataDir = path.resolve(projectRoot, "src", "data", "components");
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const safeName = json.component
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9\-_.]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        || "unknown";

    const componentFileRel = path.join("src", "data", "components", `${safeName}.json`);
    const componentFileAbs = path.resolve(projectRoot, componentFileRel);
    fs.writeFileSync(componentFileAbs, JSON.stringify(json, null, 2), "utf8");

    // Maintain index: src/data/components/index.json
    const indexFileAbs = path.resolve(projectRoot, "src", "data", "components", "index.json");
    type IndexShape = { components: Array<{ name: string; file: string }> };
    let indexData: IndexShape = { components: [] };
    if (fs.existsSync(indexFileAbs)) {
        try {
            const raw = fs.readFileSync(indexFileAbs, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.components)) {
                indexData.components = parsed.components;
            }
        } catch (e) {
            console.error("index.json is invalid JSON, recreating a new one.");
            indexData = { components: [] };
        }
    }

    const exists = indexData.components.some(e => (e.name || "").toLowerCase() === json.component.toLowerCase());
    if (!exists) {
        indexData.components.push({ name: json.component, file: componentFileRel.replace(/\\/g, "/") });
        fs.writeFileSync(indexFileAbs, JSON.stringify(indexData, null, 2), "utf8");
    }

    // Log side-effects to stderr to avoid corrupting stdio hosts
    console.error(`[parseComponentDoc] Saved: ${componentFileRel}`);
    console.error(`[parseComponentDoc] Indexed: ${path.relative(projectRoot, indexFileAbs).replace(/\\/g, "/")}`);
}

main().catch(err => {
    console.error("Error parsing component doc:", err);
    process.exit(1);
});


