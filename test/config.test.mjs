import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../build/config.js';

test('loads Mattermost credentials from the deployment environment', () => {
  const previous = {
    MATTERMOST_URL: process.env.MATTERMOST_URL,
    MATTERMOST_TOKEN: process.env.MATTERMOST_TOKEN,
    MATTERMOST_TEAM_ID: process.env.MATTERMOST_TEAM_ID,
  };

  try {
    process.env.MATTERMOST_URL = 'https://chat.example.test/api/v4';
    process.env.MATTERMOST_TOKEN = 'test-token';
    process.env.MATTERMOST_TEAM_ID = 'test-team';

    const config = loadConfig();
    assert.equal(config.mattermostUrl, process.env.MATTERMOST_URL);
    assert.equal(config.token, process.env.MATTERMOST_TOKEN);
    assert.equal(config.teamId, process.env.MATTERMOST_TEAM_ID);
    assert.equal(config.monitoring?.enabled, false);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
