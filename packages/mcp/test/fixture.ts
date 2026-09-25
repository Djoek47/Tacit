/**
 * A real MCP server, in memory. Built with the official SDK, spoken to by the
 * official client — the bridge is tested against the protocol, not a mock of it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

export type Task = { id: string; title: string; list: string; due?: string };

export async function tasksServer(opts: { shape?: unknown; withShape?: boolean } = {}) {
  const tasks: Task[] = [];
  const invoices: { to: string; amount: number }[] = [];
  let seq = 0;
  const server = new McpServer({ name: 'tasks', version: '1.0.0' });

  server.registerTool('list_tasks', {
    title: 'List tasks', description: 'All open tasks',
    annotations: { readOnlyHint: true },
  }, async () => ({ content: [{ type: 'text', text: JSON.stringify({ items: tasks }) }], structuredContent: { items: tasks } }));

  server.registerTool('list_lists', {
    title: 'Lists', description: 'Task lists',
    annotations: { readOnlyHint: true },
  }, async () => {
    const items = [{ id: 'home', name: 'Home' }, { id: 'work', name: 'Work' }];
    return { content: [{ type: 'text', text: JSON.stringify({ items }) }], structuredContent: { items } };
  });

  server.registerTool('add_task', {
    title: 'Add a task',
    inputSchema: { title: z.string(), list: z.string(), due: z.string().date().optional() },
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async ({ title, list, due }) => {
    if (title.includes('FAIL')) return { isError: true, content: [{ type: 'text', text: 'the server said no' }] };
    const t: Task = { id: `t${++seq}`, title, list, ...(due ? { due } : {}) };
    tasks.push(t);
    return { content: [{ type: 'text', text: `added ${t.id}` }], structuredContent: { id: t.id } };
  });

  server.registerTool('delete_task', {
    title: 'Delete a task', inputSchema: { id: z.string() },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const i = tasks.findIndex((t) => t.id === id);
    if (i >= 0) tasks.splice(i, 1);
    return { content: [{ type: 'text', text: `deleted ${id}` }] };
  });

  // Says nothing about itself. MCP assumes the worst, and so do we.
  server.registerTool('send_invoice', {
    inputSchema: { to: z.string(), amount: z.number() },
  }, async ({ to, amount }) => {
    invoices.push({ to, amount });
    return { content: [{ type: 'text', text: 'sent' }] };
  });

  // Claims to be harmless and offers no way back.
  server.registerTool('archive_all', {
    title: 'Archive everything',
    annotations: { destructiveHint: false, openWorldHint: false },
  }, async () => ({ content: [{ type: 'text', text: 'archived' }] }));

  const shape = opts.shape ?? {
    schema: 'aiuic.shape/1',
    app: { name: 'Tasks', brand: { colour: '#5B6CFF', mark: 'T' } },
    domains: { tasks: { kicker: 'TASKS', colour: '#5B6CFF' } },
    tools: {
      add_task: {
        domain: 'tasks', phrases: ['add', 'remind me to', 'new task'],
        preview: 'Add {title} to {list}',
        undo: { tool: 'delete_task', arg: 'id', from: 'id' },
        options: { list: { from: 'list_lists', value: 'id', label: 'name' } },
      },
      send_invoice: { phrases: ['invoice', 'bill'] },
    },
    settings: [{ key: 'weekly', label: 'Weekly review', type: 'toggle', default: true }],
    notifications: [{ key: 'due', label: 'A task is due', default: true, watch: 'list_tasks' }],
    home: ['add_task'],
  };
  if (opts.withShape !== false) {
    server.registerResource('shape', 'aiuic://shape', { mimeType: 'application/json' },
      async (uri) => ({ contents: [{ uri: String(uri), mimeType: 'application/json', text: JSON.stringify(shape) }] }));
  }

  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'aiuic-test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, server, tasks, invoices };
}
