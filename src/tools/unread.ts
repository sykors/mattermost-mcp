import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MattermostClient } from '../client.js';
import { Channel, GetUnreadMessagesArgs, Post } from '../types.js';

const inputSchema: Tool['inputSchema'] = {
  type: 'object',
  properties: {
    limit: { type: 'number', description: 'Messages per page (default 50, max 200)', default: 50 },
    page: { type: 'number', description: 'Page number (starting from 0)', default: 0 },
  },
};

export const getUnreadDirectMessagesTool: Tool = {
  name: 'mattermost_get_unread_direct_messages',
  description: 'Read unread direct messages from other users, without marking them as read',
  inputSchema,
};

export const getUnreadGroupMessagesTool: Tool = {
  name: 'mattermost_get_unread_group_messages',
  description: 'Read unread messages from group conversations and public or private channels, without marking them as read',
  inputSchema,
};

interface UnreadPost {
  channel: Channel;
  post: Post;
}

async function getUnreadPosts(client: MattermostClient, channel: Channel, currentUserId: string): Promise<UnreadPost[]> {
  const unread = await client.getChannelUnread(channel.id);
  if (!unread.msg_count) return [];

  const membership = await client.getChannelMember(channel.id);
  const lastViewedAt = membership.last_viewed_at || 0;
  const messages: UnreadPost[] = [];
  const pageSize = 200;

  for (let page = 0; ; page++) {
    const response = await client.getPostsForChannel(channel.id, pageSize, page);
    const posts = response.order.map(id => response.posts[id]);
    for (const post of posts) {
      if (post.create_at > lastViewedAt && post.user_id !== currentUserId && !post.delete_at && !post.type) {
        messages.push({ channel, post });
      }
    }
    if (posts.length < pageSize || posts.some(post => post.create_at <= lastViewedAt)) break;
  }

  return messages;
}

async function handleUnreadMessages(client: MattermostClient, args: GetUnreadMessagesArgs, direct: boolean) {
  try {
    const limit = Math.min(200, Math.max(1, Math.trunc(args.limit ?? 50)));
    const page = Math.max(0, Math.trunc(args.page ?? 0));
    const currentUser = await client.getUserProfile('me');
    const channels = (await client.getMemberChannels()).filter(channel =>
      direct ? channel.type === 'D' : ['G', 'O', 'P'].includes(channel.type)
    );

    const unreadPosts: UnreadPost[] = [];
    let nextChannel = 0;
    const workers = Array.from({ length: Math.min(8, channels.length) }, async () => {
      while (nextChannel < channels.length) {
        const channel = channels[nextChannel++];
        unreadPosts.push(...await getUnreadPosts(client, channel, currentUser.id));
      }
    });
    await Promise.all(workers);

    unreadPosts.sort((a, b) => b.post.create_at - a.post.create_at || a.post.id.localeCompare(b.post.id));
    const selected = unreadPosts.slice(page * limit, (page + 1) * limit);
    const senders = new Map<string, Awaited<ReturnType<MattermostClient['getUserProfile']>>>();
    await Promise.all([...new Set(selected.map(item => item.post.user_id))].map(async id => {
      senders.set(id, await client.getUserProfile(id));
    }));

    const messages = selected.map(({ channel, post }) => {
      const user = senders.get(post.user_id)!;
      return {
        id: post.id,
        channel_id: channel.id,
        channel_name: channel.display_name || channel.name,
        channel_type: channel.type,
        sender: { id: user.id, username: user.username, display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username },
        message: post.message,
        create_at: new Date(post.create_at).toISOString(),
        root_id: post.root_id || null,
      };
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ messages, total_count: unreadPosts.length, page, per_page: limit, has_more: (page + 1) * limit < unreadPosts.length }, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
      isError: true,
    };
  }
}

export function handleGetUnreadDirectMessages(client: MattermostClient, args: GetUnreadMessagesArgs) {
  return handleUnreadMessages(client, args, true);
}

export function handleGetUnreadGroupMessages(client: MattermostClient, args: GetUnreadMessagesArgs) {
  return handleUnreadMessages(client, args, false);
}
