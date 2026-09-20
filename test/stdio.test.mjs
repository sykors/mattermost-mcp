import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

test('responds to MCP initialize over stdio', async () => {
  const child = spawn(process.execPath, ['build/index.js'], {
    env: {
      ...process.env,
      MATTERMOST_URL: 'https://chat.example.test/api/v4',
      MATTERMOST_TOKEN: 'test-token',
      MATTERMOST_TEAM_ID: 'test-team',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    const response = new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('MCP initialize response timed out')), 2000);
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
        const line = output.split('\n')[0];
        if (output.includes('\n')) {
          clearTimeout(timeout);
          resolve(JSON.parse(line));
        }
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`MCP server exited before initialization: ${code}`));
      });
    });

    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    }) + '\n');

    const message = await response;
    assert.equal(message.id, 1);
    assert.equal(message.result.serverInfo.name, 'Mattermost MCP Server');
  } finally {
    child.kill();
  }
});
