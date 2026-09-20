import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MattermostClient } from '../client.js';
import { ListConversationsArgs, Post, SearchMessagesArgs, SendDirectMessageArgs } from '../types.js';

export const listConversationsTool: Tool = {
  name: 'mattermost_list_conversations',
  description: 'List direct and group conversations with unread message and mention counts',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Conversations per page (default 50, max 200)', default: 50 },
      page: { type: 'number', description: 'Page number (starting from 0)', default: 0 },
    },
  },
};

export const searchMessagesTool: Tool = {
  name: 'mattermost_search_messages',
  description: 'Search accessible Mattermost messages by text, sender, channel, and date range',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Words or exact phrase to find' },
      sender: { type: 'string', description: 'Sender username, without @' },
      channel: { type: 'string', description: 'Channel name, direct message username, or channel ID' },
      after: { type: 'string', description: 'Messages after this date (YYYY-MM-DD)' },
      before: { type: 'string', description: 'Messages before this date (YYYY-MM-DD)' },
      limit: { type: 'number', description: 'Results per page (default 50, max 200)', default: 50 },
      page: { type: 'number', description: 'Page number (starting from 0)', default: 0 },
    },
  },
};

export const sendDirectMessageTool: Tool = {
  name: 'mattermost_send_direct_message',
  description: 'Send a direct message to a Mattermost user by username',
  inputSchema: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Recipient username, without @' },
      message: { type: 'string', description: 'Message text' },
    },
    required: ['username', 'message'],
  },
};

function errorResult(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
    isError: true,
  };
}

function pageArgs(limit: number | undefined, page: number | undefined) {
  return {
    limit: Math.min(200, Math.max(1, Math.trunc(limit ?? 50))),
    page: Math.max(0, Math.trunc(page ?? 0)),
  };
}

export async function handleListConversations(client: MattermostClient, args: ListConversationsArgs) {
  try {
    const { limit, page } = pageArgs(args.limit, args.page);
    const currentUser = await client.getUserProfile('me');
    const all = (await client.getMemberChannels())
      .filter(channel => channel.type === 'D' || channel.type === 'G')
      .sort((a, b) => b.last_post_at - a.last_post_at || a.id.localeCompare(b.id));
    const selected = all.slice(page * limit, (page + 1) * limit);
    const participantIds = [...new Set(selected.flatMap(channel => channel.name.split('__').filter(id => id !== currentUser.id)))];
    const users = new Map(await Promise.all(participantIds.map(async id => {
      try {
        const user = await client.getUserProfile(id);
        return [id, { id: user.id, username: user.username, display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username }] as const;
      } catch {
        return [id, { id, username: id, display_name: id }] as const;
      }
    })));
    const conversations = await Promise.all(selected.map(async channel => {
      const unread = await client.getChannelUnread(channel.id);
      const participants = channel.name.split('__').filter(id => id !== currentUser.id).map(id => users.get(id) ?? { id, username: id, display_name: id });
      return {
        id: channel.id,
        type: channel.type,
        name: channel.display_name || participants.map(user => user.display_name).join(', '),
        participants,
        unread_count: unread.msg_count,
        mention_count: unread.mention_count,
        last_post_at: channel.last_post_at ? new Date(channel.last_post_at).toISOString() : null,
      };
    }));
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ conversations, total_count: all.length, page, per_page: limit, has_more: (page + 1) * limit < all.length }, null, 2) }],
    };
  } catch (error) {
    return errorResult(error);
  }
}

function searchTerms(args: SearchMessagesArgs, channelFilter?: string) {
  const parts: string[] = [];
  if (args.text?.trim()) parts.push(`"${args.text.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  for (const [key, value] of [['from', args.sender?.replace(/^@/, '')], ['in', channelFilter]] as const) {
    if (!value?.trim()) continue;
    if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Invalid ${key} filter`);
    parts.push(`${key}:${value}`);
  }
  for (const [key, value] of [['after', args.after], ['before', args.before]] as const) {
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${key} date; use YYYY-MM-DD`);
    parts.push(`${key}:${value}`);
  }
  if (!parts.length) throw new Error('Provide at least one search filter');
  return parts.join(' ');
}

export async function handleSearchMessages(client: MattermostClient, args: SearchMessagesArgs) {
  try {
    const { limit, page } = pageArgs(args.limit, args.page);
    let channelFilter = args.channel?.trim();
    if (channelFilter) {
      channelFilter = channelFilter.replace(/^#/, '');
      const channels = await client.getMemberChannels();
      const matchingChannel = channels.find(channel =>
        channel.id === channelFilter || channel.name.toLowerCase() === channelFilter!.toLowerCase() || channel.display_name?.toLowerCase() === channelFilter!.toLowerCase()
      );
      channelFilter = matchingChannel?.id ?? channelFilter;
    }
    const terms = searchTerms(args, channelFilter);
    const offset = page * limit;
    const serverPageSize = 100;
    let serverPage = Math.floor(offset / serverPageSize);
    let skip = offset % serverPageSize;
    let totalCount: number | null = null;
    const found: Post[] = [];
    while (found.length <= limit) {
      const response = await client.searchPosts(terms, serverPage);
      const batch = response.order.map(id => response.posts[id]);
      found.push(...batch.slice(skip));
      if (batch.length < serverPageSize) {
        totalCount = serverPage * serverPageSize + batch.length;
        break;
      }
      serverPage++;
      skip = 0;
    }
    const selected = found.slice(0, limit);
    const messages = selected.map(post => {
      return { id: post.id, channel_id: post.channel_id, sender_id: post.user_id, message: post.message, create_at: new Date(post.create_at).toISOString(), root_id: post.root_id || null };
    });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ messages, total_count: totalCount, page, per_page: limit, has_more: found.length > limit || (totalCount !== null && offset + messages.length < totalCount) }, null, 2) }],
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleSendDirectMessage(client: MattermostClient, args: SendDirectMessageArgs) {
  try {
    const username = args.username?.trim().replace(/^@/, '');
    const message = args.message?.trim();
    if (!username || !message) throw new Error('Username and message are required');
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) throw new Error('Invalid username');
    const recipient = await client.getUserByUsername(username);
    const currentUser = await client.getUserProfile('me');
    if (recipient.id === currentUser.id) throw new Error('Cannot send a direct message to yourself');
    const channel = await client.createDirectMessageChannel(currentUser.id, recipient.id);
    const post = await client.createPost(channel.id, message);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ id: post.id, channel_id: channel.id, recipient: { id: recipient.id, username: recipient.username }, message: post.message, create_at: new Date(post.create_at).toISOString() }, null, 2) }],
    };
  } catch (error) {
    return errorResult(error);
  }
}
