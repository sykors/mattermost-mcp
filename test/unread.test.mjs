import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { MattermostClient } from '../build/client.js';
import { executeTool } from '../build/tools/index.js';

const channels = [
  { id: 'dm', name: 'me__alice', display_name: '', type: 'D' },
  { id: 'group-dm', name: 'group-dm', display_name: 'Group DM', type: 'G' },
  { id: 'public', name: 'general', display_name: 'General', type: 'O' },
  { id: 'private', name: 'project-problems', display_name: 'Project Problems', type: 'P' },
];

const posts = {
  dm: [
    { id: 'dm-unread', user_id: 'alice', message: 'Salut!', create_at: 3000, delete_at: 0 },
    { id: 'dm-own', user_id: 'me-id', message: 'Răspunsul meu', create_at: 2500, delete_at: 0 },
    { id: 'dm-read', user_id: 'alice', message: 'Vechi', create_at: 500, delete_at: 0 },
  ],
  'group-dm': [{ id: 'group-unread', user_id: 'bob', message: 'Discuție de grup', create_at: 4000, delete_at: 0 }],
  public: [{ id: 'public-unread', user_id: 'alice', message: 'Noutate', create_at: 5000, delete_at: 0 }],
  private: [{ id: 'private-unread', user_id: 'bob', message: 'Problemă', create_at: 6000, delete_at: 0 }],
};

async function withMattermostServer(run) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    let body;
    if (url.pathname === '/api/v4/users/me/teams/team-1/channels') body = channels;
    else if (parts[2] === 'users' && parts[3] === 'me' && parts[4] === 'channels' && parts[6] === 'unread') {
      body = { msg_count: parts[5] === 'dm' ? 1 : 2, mention_count: 0 };
    } else if (parts[2] === 'channels' && parts[4] === 'members' && parts[5] === 'me') {
      body = { channel_id: parts[3], last_viewed_at: 1000 };
    } else if (parts[2] === 'channels' && parts[4] === 'posts') {
      const page = Number(url.searchParams.get('page'));
      const batch = page === 0 ? posts[parts[3]] : [];
      body = { order: batch.map(post => post.id), posts: Object.fromEntries(batch.map(post => [post.id, post])) };
    } else if (parts[2] === 'users' && parts.length === 4) {
      const id = parts[3] === 'me' ? 'me-id' : parts[3];
      body = { id, username: id === 'me-id' ? 'andrei_m' : id };
    } else {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const saved = Object.fromEntries(['MATTERMOST_URL', 'MATTERMOST_TOKEN', 'MATTERMOST_TEAM_ID'].map(name => [name, process.env[name]]));
  try {
    process.env.MATTERMOST_URL = `http://127.0.0.1:${server.address().port}/api/v4`;
    process.env.MATTERMOST_TOKEN = 'test-token';
    process.env.MATTERMOST_TEAM_ID = 'team-1';
    await run(new MattermostClient(), requests);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('returns unread direct messages from other users without changing read state', async () => {
  await withMattermostServer(async (client, requests) => {
    const result = await executeTool(client, 'mattermost_get_unread_direct_messages', { limit: 50, page: 0 });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.total_count, 1);
    assert.deepEqual(data.messages.map(message => message.id), ['dm-unread']);
    assert.equal(data.messages[0].sender.username, 'alice');
    assert.equal(data.messages[0].channel_type, 'D');
    assert.ok(requests.every(request => request.startsWith('GET ')));
  });
});

test('returns unread group and channel messages separately from direct messages', async () => {
  await withMattermostServer(async client => {
    const result = await executeTool(client, 'mattermost_get_unread_group_messages', { limit: 2, page: 0 });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.total_count, 3);
    assert.equal(data.has_more, true);
    assert.deepEqual(data.messages.map(message => message.id), ['private-unread', 'public-unread']);
    assert.deepEqual(data.messages.map(message => message.channel_type), ['P', 'O']);
  });
});
