import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { MattermostClient } from "../client.js";
import { Channel, ListChannelsArgs, GetChannelHistoryArgs } from "../types.js";

// Tool definition for listing channels
export const listChannelsTool: Tool = {
  name: "mattermost_list_channels",
  description: "List public channels and private channels joined by the connected Mattermost account, with pagination",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of channels to return (default 100, max 200)",
        default: 100,
      },
      page: {
        type: "number",
        description: "Page number for pagination (starting from 0)",
        default: 0,
      },
    },
  },
};

// Tool definition for getting channel history
export const getChannelHistoryTool: Tool = {
  name: "mattermost_get_channel_history",
  description: "Get recent messages from a Mattermost channel",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "The ID of the channel",
      },
      limit: {
        type: "number",
        description: "Number of messages to retrieve (default 30)",
        default: 30,
      },
      page: {
        type: "number",
        description: "Page number for pagination (starting from 0)",
        default: 0,
      },
    },
    required: ["channel_id"],
  },
};

// Tool handler for listing channels
export async function handleListChannels(
  client: MattermostClient,
  args: ListChannelsArgs
) {
  const limit = Math.min(200, Math.max(1, Math.trunc(args.limit ?? 100)));
  const page = Math.max(0, Math.trunc(args.page ?? 0));
  
  try {
    const channelsById = new Map<string, Channel>();
    const publicPageSize = 200;
    for (let publicPage = 0; ; publicPage++) {
      const response = await client.getChannels(publicPageSize, publicPage);
      if (!Array.isArray(response?.channels)) {
        throw new Error('Public channels response is missing a channels array');
      }
      for (const channel of response.channels) channelsById.set(channel.id, channel);
      if (response.channels.length < publicPageSize) break;
    }

    for (const channel of await client.getMemberChannels()) {
      if (channel.type === 'O' || channel.type === 'P') channelsById.set(channel.id, channel);
    }

    const channels = [...channelsById.values()].sort((a, b) =>
      (a.display_name || a.name).localeCompare(b.display_name || b.name) || a.id.localeCompare(b.id)
    );
    const selectedChannels = channels.slice(page * limit, (page + 1) * limit);
    
    const formattedChannels = selectedChannels.map(channel => ({
      id: channel.id,
      name: channel.name,
      display_name: channel.display_name,
      type: channel.type,
      purpose: channel.purpose,
      header: channel.header,
      total_msg_count: channel.total_msg_count,
    }));
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            channels: formattedChannels,
            total_count: channels.length,
            page: page,
            per_page: limit,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("Error listing channels:", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}

// Tool handler for getting channel history
export async function handleGetChannelHistory(
  client: MattermostClient,
  args: GetChannelHistoryArgs
) {
  const { channel_id, limit = 30, page = 0 } = args;
  
  try {
    const response = await client.getPostsForChannel(channel_id, limit, page);
    
    // Format the posts for better readability
    const formattedPosts = response.order.map(postId => {
      const post = response.posts[postId];
      return {
        id: post.id,
        user_id: post.user_id,
        message: post.message,
        create_at: new Date(post.create_at).toISOString(),
        reply_count: post.reply_count,
        root_id: post.root_id || null,
      };
    });
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            posts: formattedPosts,
            has_next: !!response.next_post_id,
            has_prev: !!response.prev_post_id,
            page: page,
            per_page: limit,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error("Error getting channel history:", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}
