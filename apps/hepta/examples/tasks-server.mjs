#!/usr/bin/env node
/**
 * A small MCP server a developer might already have: tasks, with lists.
 * Standard MCP, plus one optional resource — aiuic://shape — that tells
 * AIUIC how the app should look. Remove the resource and it still works;
 * it just looks plain and every write asks first.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const tasks = [];
let seq = 0;
const server = new McpServer({ name: 'tasks', version: '1.0.0' });
const out = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }], structuredContent: v });

server.registerTool('list_tasks', { title: 'List tasks', description: 'Open tasks and when they are due', annotations: { readOnlyHint: true } },
  async () => out({ items: tasks }));
server.registerTool('list_lists', { title: 'Lists', annotations: { readOnlyHint: true } },
  async () => out({ items: [{ id: 'home', name: 'Home' }, { id: 'work', name: 'Work' }] }));
server.registerTool('add_task', {
  title: 'Add a task',
  inputSchema: { title: z.string(), list: z.string(), due: z.string().date().optional() },
  annotations: { destructiveHint: false, openWorldHint: false },
}, async ({ title, list, due }) => { const t = { id: `t${++seq}`, title, list, ...(due ? { due } : {}) }; tasks.push(t); return out({ id: t.id }); });
server.registerTool('remove_task', {
  title: 'Remove a task', inputSchema: { id: z.string() },
  annotations: { destructiveHint: true, openWorldHint: false },
}, async ({ id }) => { const i = tasks.findIndex((t) => t.id === id); if (i >= 0) tasks.splice(i, 1); return out({ removed: id }); });

server.registerResource('shape', 'aiuic://shape', { mimeType: 'application/json' }, async (uri) => ({
  contents: [{ uri: String(uri), mimeType: 'application/json', text: JSON.stringify({
    schema: 'aiuic.shape/1',
    app: { name: 'Tasks', brand: { colour: '#5B6CFF', mark: 'T' } },
    domains: { tasks: { kicker: 'TASKS', colour: '#5B6CFF' } },
    tools: {
      add_task: {
        domain: 'tasks', phrases: ['add', 'remind me to', 'new task'],
        preview: 'Add {title} to {list}',
        undo: { tool: 'remove_task', arg: 'id', from: 'id' },
        options: { list: { from: 'list_lists', value: 'id', label: 'name' } },
      },
      remove_task: { domain: 'tasks', phrases: ['remove', 'delete task'] },
    },
    notifications: [{ key: 'due', label: 'A task is due', default: true, watch: 'list_tasks' }],
    home: ['add_task'],
  }) }],
}));

await server.connect(new StdioServerTransport());
