import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MockPesuServer } from './mock-server.js';

describe('Real Stdio MCP CLI End-to-End Test', () => {
  let mockServer: MockPesuServer;
  let transport: StdioClientTransport;
  let client: Client;

  before(async () => {
    mockServer = new MockPesuServer();
    await mockServer.start();

    transport = new StdioClientTransport({
      command: 'node',
      args: [path.join(process.cwd(), 'dist/index.js')],
      env: {
        ...process.env,
        PESU_BASE_URL: mockServer.baseUrl,
        PESU_SESSION_ID: 'valid_mock_session_12345',
      },
    });

    client = new Client(
      { name: 'stdio-e2e-test-runner', version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
  });

  after(async () => {
    await transport.close();
    await mockServer.stop();
  });

  test('stdio CLI: listTools returns all 26 registered tools', async () => {
    const list = await client.listTools();
    assert.strictEqual(list.tools.length, 26);
  });

  test('stdio CLI: callTool executes pesu_get_profile successfully over stdio', async () => {
    const res: any = await client.callTool({
      name: 'pesu_get_profile',
      arguments: {},
    });
    assert.strictEqual(res.isError, undefined);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data['SRN'], 'PES1UG22CS999');
  });

  test('stdio CLI: callTool executes pesu_get_attendance over stdio', async () => {
    const res: any = await client.callTool({
      name: 'pesu_get_attendance',
      arguments: { semester: 'Sem-6' },
    });
    assert.strictEqual(res.isError, undefined);
    const data = JSON.parse(res.content[0].text);
    assert.strictEqual(data.semester, 'Sem-6');
    assert.ok(data.courses.length >= 2);
  });

  test('stdio CLI: callTool unknown tool returns error without crashing process', async () => {
    const res: any = await client.callTool({
      name: 'non_existent_tool_name',
      arguments: {},
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('Unknown tool: non_existent_tool_name'));
  });
});
