# Mattermost MCP Server

MCP Server for the Mattermost API, enabling Claude and other MCP clients to interact with Mattermost workspaces.

## Dokploy / remote Codex deployment

This fork includes a Docker Compose deployment for a remote MCP client. The original
server speaks MCP over stdio. Supergateway exposes it as Streamable HTTP, and a Caddy
sidecar requires a separate bearer token before forwarding requests.

Set these variables in the Dokploy Compose environment:

| Variable | Value |
| --- | --- |
| `MATTERMOST_URL` | Mattermost API URL ending in `/api/v4` |
| `MATTERMOST_TOKEN` | Personal access token for the intended Mattermost account |
| `MATTERMOST_TEAM_ID` | Mattermost team ID |
| `MCP_ACCESS_TOKEN` | A separate random token for MCP clients |

Build and deploy `docker-compose.yml`. Route the `gateway` service on port `8080`
through HTTPS. The MCP endpoint is `https://<your-domain>/mcp`; `/healthz` is a
public health check. The MCP endpoint rejects missing or incorrect bearer tokens.
The Mattermost service is only reachable on the Compose network.

For Codex, add a Streamable HTTP server to `~/.codex/config.toml`:

```toml
[mcp_servers.mattermost]
url = "https://<your-domain>/mcp"
bearer_token_env_var = "MATTERMOST_MCP_ACCESS_TOKEN"
```

Set `MATTERMOST_MCP_ACCESS_TOKEN` in the environment of the Codex host to the
same value as `MCP_ACCESS_TOKEN` in Dokploy. Restart Codex after editing its MCP
configuration. No Mattermost token is stored in the Codex configuration.

The fixed-port auxiliary monitoring HTTP endpoint and topic monitoring are
disabled in the Compose deployment because Supergateway may start multiple
stdio processes. The remote deployment exposes the channel, message, and user
tools; the monitoring tool is listed but reports that monitoring is disabled.

## Features

This MCP server provides tools for interacting with Mattermost, including:

### Topic Monitoring

The server includes a topic monitoring system that can:
- Monitor specified channels for messages containing topics of interest
- Run on a configurable schedule (using cron syntax)
- Send notifications when relevant topics are discussed
- Mention you in a specified channel when topics are found

### Channel Tools
- `mattermost_list_channels`: List public channels in the configured team and private channels that the connected account has joined
- `mattermost_get_channel_history`: Get recent messages from a channel
- `mattermost_get_unread_direct_messages`: Read unread direct messages from users
- `mattermost_get_unread_group_messages`: Read unread messages from group conversations and public/private channels

### Message Tools
- `mattermost_post_message`: Post a new message to a channel
- `mattermost_reply_to_thread`: Reply to a specific message thread
- `mattermost_add_reaction`: Add an emoji reaction to a message
- `mattermost_get_thread_replies`: Get all replies in a thread

### Monitoring Tools
- `mattermost_run_monitoring`: Trigger the topic monitoring process immediately

### User Tools
- `mattermost_get_users`: Get a list of users in the workspace
- `mattermost_get_user_profile`: Get detailed profile information for a user

## Setup

1. Clone this repository:
```bash
git clone https://github.com/yourusername/mattermost-mcp.git
cd mattermost-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Configure the server:
   
   The repository includes a `config.json` file with placeholder values. For your actual configuration, create a `config.local.json` file (which is gitignored) with your real credentials:

   ```json
   {
     "mattermostUrl": "https://your-mattermost-instance.com/api/v4",
     "token": "your-personal-access-token",
     "teamId": "your-team-id",
     "monitoring": {
       "enabled": false,
       "schedule": "*/15 * * * *",
       "channels": ["town-square", "off-topic"],
       "topics": ["tv series", "champions league"],
       "messageLimit": 50
     }
   }
   ```

   This approach keeps your real credentials out of the repository while maintaining the template for others.

4. Build the server:
```bash
npm run build
```

5. Run the server:
```bash
npm start
```

## Topic Monitoring Configuration

The monitoring system can be configured with the following options:

- `enabled` (boolean): Whether monitoring is enabled
- `schedule` (string): Cron expression for when to check for new messages (e.g., "*/15 * * * *" for every 15 minutes)
- `channels` (string[]): Array of channel names to monitor
- `topics` (string[]): Array of topics to look for in messages
- `messageLimit` (number): Number of recent messages to analyze per check
- `notificationChannelId` (string, optional): Channel ID where notifications will be sent. If not provided, the system will automatically use a direct message channel.
- `userId` (string, optional): Your user ID for mentions in notifications. If not provided, the system will automatically detect the current user.

To enable monitoring, set `enabled` to `true` in your `config.local.json` file.

### Running Monitoring Manually

You can trigger the monitoring process manually in several ways:

1. **Using the provided scripts**:
   - `./run-monitoring-http.sh` - Triggers monitoring via HTTP without restarting the server (recommended)
   - `./run-monitoring.sh` - Starts a new server instance with monitoring enabled
   - `./trigger-monitoring.sh` - Runs the monitoring process and exits (useful for cron jobs)
   - `./view-channel-messages.js <channel-name> [count]` - View the last messages in a channel
   - `./analyze-channel.js <channel-name> [count]` - Analyze message statistics in a channel
   - `./get-last-message.js <channel-name>` - Get the last message from a channel

2. **Using the MCP tool**:
   - Use the `mattermost_run_monitoring` tool through the MCP interface
   - This will immediately check all configured channels for your topics of interest

3. **Using the command-line flags**:
   - Start the server with the `--run-monitoring` flag:
   ```bash
   npm start -- --run-monitoring
   ```
   - This will run the monitoring process immediately after the server starts
   - Add `--exit-after-monitoring` to exit after the monitoring process completes:
   ```bash
   npm start -- --run-monitoring --exit-after-monitoring
   ```
   - This is useful for running the monitoring process from cron jobs

## Tool Details

### Channel Tools

#### `mattermost_list_channels`
- List public channels in the configured team and private channels joined by the account represented by `MATTERMOST_TOKEN`. Private channels outside that account's membership are not visible through this endpoint.
- Optional inputs:
  - `limit` (number, default: 100, max: 200): Maximum number of channels to return
  - `page` (number, default: 0): Page number for pagination
- Returns: Alphabetically sorted, deduplicated list of channels with their IDs and information, plus the total count

#### `mattermost_get_channel_history`
- Get recent messages from a channel
- Required inputs:
  - `channel_id` (string): The ID of the channel
- Optional inputs:
  - `limit` (number, default: 30): Number of messages to retrieve
  - `page` (number, default: 0): Page number for pagination
- Returns: List of messages with their content and metadata

#### Unread message tools

- `mattermost_get_unread_direct_messages` returns messages from one-to-one conversations (`D`).
- `mattermost_get_unread_group_messages` returns messages from group conversations (`G`) and public/private channels (`O`/`P`).
- Both use the account represented by `MATTERMOST_TOKEN`, exclude its own posts, and do not mark anything as read.
- Optional inputs: `limit` (default 50, max 200) and `page` (starting from 0).
- Results include the sender, channel, timestamp, `total_count`, and `has_more` for pagination.

### Message Tools

#### `mattermost_post_message`
- Post a new message to a Mattermost channel
- Required inputs:
  - `channel_id` (string): The ID of the channel to post to
  - `message` (string): The message text to post
- Returns: Message posting confirmation and ID

#### `mattermost_reply_to_thread`
- Reply to a specific message thread
- Required inputs:
  - `channel_id` (string): The channel containing the thread
  - `post_id` (string): ID of the parent message
  - `message` (string): The reply text
- Returns: Reply confirmation and ID

#### `mattermost_add_reaction`
- Add an emoji reaction to a message
- Required inputs:
  - `channel_id` (string): The channel containing the message
  - `post_id` (string): Message ID to react to
  - `emoji_name` (string): Emoji name without colons
- Returns: Reaction confirmation

#### `mattermost_get_thread_replies`
- Get all replies in a message thread
- Required inputs:
  - `channel_id` (string): The channel containing the thread
  - `post_id` (string): ID of the parent message
- Returns: List of replies with their content and metadata

### User Tools

#### `mattermost_get_users`
- Get list of workspace users with basic profile information
- Optional inputs:
  - `limit` (number, default: 100, max: 200): Maximum users to return
  - `page` (number, default: 0): Page number for pagination
- Returns: List of users with their basic profiles

#### `mattermost_get_user_profile`
- Get detailed profile information for a specific user
- Required inputs:
  - `user_id` (string): The user's ID
- Returns: Detailed user profile information

## Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mattermost": {
      "command": "node",
      "args": [
        "/path/to/mattermost-mcp/build/index.js"
      ]
    }
  }
}
```

## Troubleshooting

If you encounter permission errors, verify that:
1. Your personal access token has the necessary permissions
2. The token is correctly copied to your configuration
3. The Mattermost URL and team ID are correct

## HTTP Endpoints

The server exposes HTTP endpoints for remote control:

- **Run Monitoring**: `http://localhost:3456/run-monitoring`
  - Triggers the monitoring process immediately
  - Returns JSON response with success/error information

- **Check Status**: `http://localhost:3456/status`
  - Returns information about the server and monitoring status
  - Useful for health checks

You can use these endpoints with curl or any HTTP client:
```bash
# Trigger monitoring
curl http://localhost:3456/run-monitoring

# Check status
curl http://localhost:3456/status
```

## Utility Scripts

### run-monitoring-http.sh

This script triggers the monitoring process via the HTTP endpoint:
```bash
./run-monitoring-http.sh
```

This is the recommended way to trigger monitoring manually as it:
- Doesn't restart the server
- Doesn't interfere with the scheduled monitoring
- Works reliably from any terminal

### view-channel-messages.js

This script allows you to view the most recent messages in any channel:

```bash
# View messages in a channel (channel name is required)
node view-channel-messages.js <channel-name>

# View a specific number of messages
node view-channel-messages.js <channel-name> <message-count>

# Example: View the last 10 messages in a channel
node view-channel-messages.js general 10
```

The script will display:
- Channel information (name, purpose, total message count)
- The most recent messages with timestamps and usernames
- If the channel doesn't exist, it will list all available channels

### analyze-channel.js

This script provides detailed statistics about messages in a channel:

```bash
# Analyze messages in a channel (channel name is required)
node analyze-channel.js <channel-name>

# Analyze a specific number of messages
node analyze-channel.js <channel-name> <message-count>

# Example: Analyze the last 50 messages in a channel
node analyze-channel.js general 50
```

The script will display:
- Channel information and metadata
- Total message count (including system messages)
- Breakdown of user messages vs. system messages
- Message count by user
- The most recent messages in the channel

### get-last-message.js

This script retrieves only the most recent message from a channel:

```bash
# Get the last message from a channel (channel name is required)
node get-last-message.js <channel-name>

# Example: Get the last message from the general channel
node get-last-message.js general
```

The script will display:
- The sender's user ID and username
- The timestamp of the message
- The full message content

## License

This MCP server is licensed under the MIT License.
