const axios = require('axios');
const pomelo = require('pomelo');
const sql = () => pomelo.app.get('sqlHelper');

async function call(token, method, body) {
    try {
        const response = await axios.post(`https://api.telegram.org/bot${token}/${method}`, body, { timeout: 5000 });
        if (!response.data || !response.data.ok) throw new Error('Telegram rejected request');
        return response.data.result;
    } catch (_) {
        // Axios errors contain the bot token in the request URL. Never expose them.
        throw new Error('Telegram 请求失败，请检查 token、chat ID、机器人权限及网络');
    }
}

async function setup(msg) {
    const group = typeof msg.group_nickname === 'string' && msg.group_nickname.trim();
    const token = typeof msg.telegram_token === 'string' && msg.telegram_token.trim();
    if (!group || !token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
        throw new Error('请填写群昵称和有效的 telegram_token');
    }
    await call(token, 'getMe', {});
    let chatId = msg.telegram_chat_id;
    if (chatId === undefined || chatId === null || chatId === '') {
        const updates = await call(token, 'getUpdates', { limit: 100, timeout: 0 });
        const chats = new Map();
        for (const update of updates) {
            const event = update.message || update.channel_post || update.my_chat_member;
            const chat = event && event.chat;
            // Business group names are dynamic and unrelated to Telegram titles.
            // Repeated updates from one private/group chat represent one destination.
            if (chat && chat.id !== undefined) chats.set(String(chat.id), chat);
        }
        if (chats.size === 0) throw new Error('未找到 Telegram 聊天，请先私聊机器人发送 /start 后重试，或传入 telegram_chat_id');
        if (chats.size > 1) throw new Error('找到多个 Telegram 聊天，请传入 telegram_chat_id 指定通知接收位置');
        chatId = [...chats.keys()][0];
    }
    if (!/^-?\d+$|^@[A-Za-z0-9_]+$/.test(String(chatId))) throw new Error('telegram_chat_id 格式不正确');
    const chat = await call(token, 'getChat', { chat_id: chatId });
    await sql().query('bjl', `CREATE TABLE IF NOT EXISTS telegram_notification_setup (
        group_nickname VARCHAR(191) NOT NULL PRIMARY KEY,
        telegram_token VARCHAR(255) NOT NULL,
        telegram_chat_id VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, []);
    await sql().query('bjl', `INSERT INTO telegram_notification_setup
        (group_nickname, telegram_token, telegram_chat_id) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE telegram_token = VALUES(telegram_token), telegram_chat_id = VALUES(telegram_chat_id)`,
    [group, token, String(chat.id)]);
    return { group_nickname: group, telegram_chat_id: String(chat.id) };
}

// Notification failure must never change the outcome of an already committed score operation.
async function notify(msg, action) {
    try {
        if (!msg.group_nickname) return false;
        const rows = await sql().query('bjl', 'SELECT telegram_token, telegram_chat_id FROM telegram_notification_setup WHERE group_nickname = ?', [msg.group_nickname]);
        if (!rows.length) return false;
        await call(rows[0].telegram_token, 'sendMessage', {
            chat_id: rows[0].telegram_chat_id,
            text: [`群：${msg.group_nickname}`, `玩家：${msg.player_name}`, `操作：${action}`,
                `类型：${msg.option_type || action}`, `分数：${Math.abs(Number(msg.option_score))}`,
                `操作员：${msg.userName || ''}`, `时间：${new Date().toISOString()}`].join('\n')
        });
        return true;
    } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE') console.error('Telegram 上下分通知失败');
        return false;
    }
}

module.exports = { setup, notify };
