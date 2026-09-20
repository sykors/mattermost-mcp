import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { MattermostClient } from '../build/client.js';

test('listing channels does not write the Mattermost token to stderr', async () => {
  const httpServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  const previous = {
    MATTERMOST_URL: process.env.MATTERMOST_URL,
    MATTERMOST_TOKEN: process.env.MATTERMOST_TOKEN,
    MATTERMOST_TEAM_ID: process.env.MATTERMOST_TEAM_ID,
  };
  const originalError = console.error;
  const logs = [];

  try {
    const address = httpServer.address();
    process.env.MATTERMOST_URL = `http://127.0.0.1:${address.port}/api/v4`;
    process.env.MATTERMOST_TOKEN = 'test-secret-token';
    process.env.MATTERMOST_TEAM_ID = 'test-team';
    console.error = (...args) => logs.push(args.join(' '));

    const client = new MattermostClient();
    await client.getChannels();
    assert.equal(logs.join('\n').includes('test-secret-token'), false);
  } finally {
    console.error = originalError;
    await new Promise((resolve) => httpServer.close(resolve));
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
