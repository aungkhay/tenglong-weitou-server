const crypto = require('crypto');
const cache = require('../dao/Cache');
const userDao = require('../dao/userDao');
const exchangePoints = require('../service/playerPointsExchange');
const sendChat = require('./sendChat');

module.exports = async function exchangePointsCommand({ content, senderId, chatId, msgId, clientId }) {
    if (String(content || '').trim() !== '/兑换积分') return false;

    let reply;
    try {
        if (senderId === undefined || senderId === null || String(senderId).trim() === '') {
            reply = '无法识别玩家，请联系管理员绑定聊天账号';
        } else {
            // Never exchange by a changeable chat nickname or a name supplied in the command.
            const row = await userDao.getPlayerByChatUserId(senderId);
            const user = row && row.data;
            if (!user) {
                reply = '聊天账号尚未绑定玩家，请联系管理员绑定后再兑换积分';
            } else {
                const messageId = msgId == null ? clientId : msgId;
                if (messageId == null || String(messageId) === '') {
                    reply = '消息编号缺失，请重新发送兑换指令';
                } else {
                    const key = crypto.createHash('sha256')
                        .update(JSON.stringify([String(chatId), String(senderId), String(messageId)]))
                        .digest('hex');
                    if (!await cache.setIfAbsent('points_exchange_message:' + key, true, 86400)) return true;
                    const result = await exchangePoints({ player_name: user.username, userName: user.username });
                    if (result.data && result.data.res) {
                        reply = `${user.username} 兑换成功：${result.data.points}积分兑换${result.data.score}分`;
                    } else if (!result.err && result.data && result.data.total_points === 0) {
                        reply = `${user.username} 没有可兑换的积分`;
                    } else {
                        reply = `${user.username} 积分兑换失败，请联系管理员核实`;
                    }
                }
            }
        }
    } catch (err) {
        console.error('聊天积分兑换失败:', err);
        reply = '积分兑换暂未完成，请联系管理员核实后再试';
    }

    // A reply failure must never cause the exchange to run a second time.
    try {
        await sendChat.sendTextMessage(reply, chatId);
    } catch (err) {
        console.error('积分兑换回复失败:', err);
    }
    return true;
};
