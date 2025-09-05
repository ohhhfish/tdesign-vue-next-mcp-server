import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs";
import * as path from "node:path";

const server = new McpServer({
    name: "tdesign-vue-next-mcp-server",
    version: "1.0.0",
});

// Helper function to get project root
function getProjectRoot(): string {
    const serverFile = new URL(import.meta.url).pathname;
    const normalizedPath = serverFile.startsWith('/') && serverFile[2] === ':' ? serverFile.slice(1) : serverFile;
    const serverDir = path.dirname(normalizedPath);
    return path.resolve(serverDir, "..");
}

// Helper function to load component data
function loadComponentData(componentName: string): any {
    const projectRoot = getProjectRoot();
    const indexCandidates = [
        path.resolve(projectRoot, "build", "data", "components", "index.json"),
        path.resolve(projectRoot, "src", "data", "components", "index.json"),
    ];
    const indexFile = indexCandidates.find(p => fs.existsSync(p));

    if (!indexFile) {
        throw new Error(`Index file not found. Candidates: ${indexCandidates.join(', ')}`);
    }

    const raw = fs.readFileSync(indexFile, "utf8");
    const indexJson = JSON.parse(raw) as { components: Array<{ name: string; file: string }> };
    const entry = indexJson.components.find(c => c.name.toLowerCase() === componentName.toLowerCase());

    if (!entry) {
        throw new Error(`Component '${componentName}' not found`);
    }

    const fileCandidates = [
        path.resolve(projectRoot, entry.file.replace(/^src\//, "build/")),
        path.resolve(projectRoot, entry.file),
    ];
    const abs = fileCandidates.find(p => fs.existsSync(p));

    if (!abs) {
        throw new Error(`Component file not found for '${componentName}'. Candidates: ${fileCandidates.join(', ')}`);
    }

    const txt = fs.readFileSync(abs, "utf8");
    return JSON.parse(txt);
}

server.tool('getComponentList', 'Get the list of available TDesign Vue Next components', {}, async () => {
    try {
        const projectRoot = getProjectRoot();
        const indexCandidates = [
            path.resolve(projectRoot, "build", "data", "components", "index.json"),
            path.resolve(projectRoot, "src", "data", "components", "index.json"),
        ];
        const indexFile = indexCandidates.find(p => fs.existsSync(p));

        if (!indexFile) {
            return {
                content: [{
                    type: 'text', text: JSON.stringify({
                        components: [],
                        error: `Index file not found. Candidates: ${indexCandidates.join(', ')}`
                    }, null, 2)
                }]
            };
        }

        const raw = fs.readFileSync(indexFile, "utf8");
        const indexJson = JSON.parse(raw) as { components: Array<{ name: string; file: string }> };

        // Return only component names and basic info
        const components = indexJson.components.map(entry => ({
            name: entry.name,
            file: entry.file
        }));

        return {
            content: [{
                type: 'text', text: JSON.stringify({
                    components,
                    total: components.length
                }, null, 2)
            }]
        };
    } catch (e) {
        return {
            content: [{
                type: 'text', text: JSON.stringify({
                    components: [],
                    error: `Failed to get component list: ${e instanceof Error ? e.message : String(e)}`
                }, null, 2)
            }]
        };
    }
})

server.tool('getComponentProps', 'Get props information for a specific TDesign component', {
    type: 'object',
    properties: {
        componentName: {
            type: 'string',
            description: 'Name of the component (e.g., Button, Input, Form)'
        }
    },
    required: ['componentName']
}, async (args) => {
    try {
        // MCP 工具参数在 args 的直接属性中
        const componentName = args?.componentName;
        if (!componentName) {
            return { content: [{ type: 'text', text: JSON.stringify({ 
                error: `componentName parameter is required. Available args: ${Object.keys(args || {}).join(', ')}`
            }, null, 2) }] };
        }
        const data = loadComponentData(componentName);
        return {
            content: [{
                type: 'text', text: JSON.stringify({
                    component: data.component,
                    props: data.props || [],
                    total: data.props?.length || 0
                }, null, 2)
            }]
        };
    } catch (e) {
        return {
            content: [{
                type: 'text', text: JSON.stringify({
                    error: `Failed to get component props: ${e instanceof Error ? e.message : String(e)}`
                }, null, 2)
            }]
        };
    }
})

server.tool('getComponentEvents', 'Get events information for a specific TDesign component', {
    type: 'object',
    properties: {
        componentName: {
            type: 'string',
            description: 'Name of the component (e.g., Button, Input, Form)'
        }
    },
    required: ['componentName']
}, async (args) => {
    try {
        // MCP 工具参数在 args 的直接属性中
        const componentName = args?.componentName;
        if (!componentName) {
            return { content: [{ type: 'text', text: JSON.stringify({ 
                error: `componentName parameter is required. Available args: ${Object.keys(args || {}).join(', ')}`
            }, null, 2) }] };
        }
        const data = loadComponentData(componentName);
        return {
            content: [{
                type: 'text', text: JSON.stringify({
                    component: data.component,
                    events: data.events || [],
                    total: data.events?.length || 0
                }, null, 2)
            }]
        };
    } catch (e) {
        return {
            content: [{
                type: 'text', text: JSON.stringify({
                    error: `Failed to get component events: ${e instanceof Error ? e.message : String(e)}`
                }, null, 2)
            }]
        };
    }
})

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Tdesign Vue Next MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});