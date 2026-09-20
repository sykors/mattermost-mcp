import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { MattermostClient } from '../build/client.js';
import { handleListChannels } from '../build/tools/channels.js';

test('lists public channels and private channels joined by the token account without duplicates', async () => {
  const publicChannel = { id: 'public-1', name: 'general', display_name: 'General', type: 'O' };
  const privateChannel = { id: 'private-1', name: 'project-problems', display_name: 'Project Problems', type: 'P' };
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const url = new URL(request.url, 'http://localhost');
    let channels;
    if (url.pathname === '/api/v4/teams/team-1/channels') {
      channels = url.searchParams.get('page') === '0' ? [publicChannel] : [];
    } else if (url.pathname === '/api/v4/users/me/teams/team-1/channels') {
      channels = [privateChannel, publicChannel, { id: 'direct-1', name: 'direct', type: 'D' }];
    } else {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(channels));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const saved = Object.fromEntries(['MATTERMOST_URL', 'MATTERMOST_TOKEN', 'MATTERMOST_TEAM_ID'].map(name => [name, process.env[name]]));

  try {
    process.env.MATTERMOST_URL = `http://127.0.0.1:${server.address().port}/api/v4`;
    process.env.MATTERMOST_TOKEN = 'test-token';
    process.env.MATTERMOST_TEAM_ID = 'team-1';
    const client = new MattermostClient();

    const first = JSON.parse((await handleListChannels(client, { limit: 1, page: 0 })).content[0].text);
    const second = JSON.parse((await handleListChannels(client, { limit: 1, page: 1 })).content[0].text);

    assert.equal(first.total_count, 2);
    assert.equal(second.total_count, 2);
    assert.deepEqual([...first.channels, ...second.channels].map(channel => channel.id), ['public-1', 'private-1']);
    assert.ok(requests.some(path => path.startsWith('/api/v4/users/me/teams/team-1/channels')));
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
