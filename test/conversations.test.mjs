import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { MattermostClient } from '../build/client.js';
import { executeTool } from '../build/tools/index.js';

async function withServer(handler, run) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const record = { method: request.method, path: new URL(request.url, 'http://localhost').pathname, body: text ? JSON.parse(text) : null };
    requests.push(record);
    const result = handler(record);
    response.writeHead(result?.status || 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result?.body ?? {}));
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

test('lists direct and group conversations with unread counts and participants', async () => {
  await withServer(({ path }) => {
    if (path.endsWith('/users/me/teams/team-1/channels')) return { body: [
      { id: 'dm', name: 'me-id__alice-id', type: 'D', last_post_at: 3000 },
      { id: 'group', name: 'me-id__alice-id__bob-id', type: 'G', last_post_at: 2000 },
      { id: 'public', name: 'general', type: 'O', last_post_at: 1000 },
    ] };
    if (path.endsWith('/users/me')) return { body: { id: 'me-id', username: 'andrei_m' } };
    if (path.endsWith('/users/me/channels/dm/unread')) return { body: { msg_count: 2, mention_count: 1 } };
    if (path.endsWith('/users/me/channels/group/unread')) return { body: { msg_count: 1, mention_count: 0 } };
    if (path.endsWith('/users/alice-id')) return { body: { id: 'alice-id', username: 'alice' } };
    if (path.endsWith('/users/bob-id')) return { body: { id: 'bob-id', username: 'bob' } };
    return { status: 404 };
  }, async (client, requests) => {
    const result = await executeTool(client, 'mattermost_list_conversations', { limit: 10, page: 0 });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.total_count, 2);
    assert.deepEqual(data.conversations.map(item => item.type), ['D', 'G']);
    assert.deepEqual(data.conversations.map(item => item.unread_count), [2, 1]);
    assert.deepEqual(data.conversations[0].participants.map(user => user.username), ['alice']);
    assert.deepEqual(data.conversations[1].participants.map(user => user.username), ['alice', 'bob']);
    assert.ok(requests.every(request => request.method === 'GET'));
  });
});

test('searches messages with text, sender, channel and date filters', async () => {
  await withServer(({ method, path }) => {
    if (method === 'POST' && path === '/api/v4/posts/search') return { body: {
      order: ['post-1'], posts: { 'post-1': { id: 'post-1', channel_id: 'channel-1', user_id: 'alice-id', message: 'Urgent fix', create_at: 3000 } }, total_count: 1,
    } };
    return { status: 404 };
  }, async (client, requests) => {
    const result = await executeTool(client, 'mattermost_search_messages', {
      text: 'urgent fix', sender: 'alice', channel: 'project-problems', after: '2026-09-01', before: '2026-09-20', limit: 10, page: 0,
    });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.deepEqual(data.messages.map(item => item.id), ['post-1']);
    assert.equal(data.total_count, 1);
    assert.equal(requests[0].path, '/api/v4/posts/search');
    assert.equal(requests[0].body.terms, '"urgent fix" from:alice in:project-problems after:2026-09-01 before:2026-09-20');
  });
});

test('sends a direct message after resolving the recipient username', async () => {
  await withServer(({ method, path }) => {
    if (path === '/api/v4/users/me') return { body: { id: 'me-id', username: 'andrei_m' } };
    if (path === '/api/v4/users/username/alice') return { body: { id: 'alice-id', username: 'alice' } };
    if (method === 'POST' && path === '/api/v4/channels/direct') return { body: { id: 'dm-id', type: 'D' } };
    if (method === 'POST' && path === '/api/v4/posts') return { body: { id: 'post-id', channel_id: 'dm-id', message: 'Salut!', create_at: 3000 } };
    return { status: 404 };
  }, async (client, requests) => {
    const result = await executeTool(client, 'mattermost_send_direct_message', { username: 'alice', message: 'Salut!' });
    assert.equal(result.isError, undefined);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.id, 'post-id');
    assert.equal(data.recipient.username, 'alice');
    assert.deepEqual(requests.find(request => request.path === '/api/v4/channels/direct').body, ['me-id', 'alice-id']);
    assert.equal(requests.find(request => request.path === '/api/v4/posts').body.message, 'Salut!');
  });
});

test('does not create a conversation when the username is unknown', async () => {
  await withServer(({ path }) => path === '/api/v4/users/username/missing' ? { status: 404 } : { status: 404 }, async (client, requests) => {
    const result = await executeTool(client, 'mattermost_send_direct_message', { username: 'missing', message: 'Salut!' });
    assert.equal(result.isError, true);
    assert.ok(requests.some(request => request.path === '/api/v4/users/username/missing'));
    assert.ok(requests.every(request => request.method === 'GET'));
  });
});
