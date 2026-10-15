// Use the platform's real message ID so import applies the same stop boundary
// to robot messages and chat callbacks. doBet deduplicates both delivery paths.
module.exports = async function cacheVirtualBet(room, bot, command, sent, session, startMsgId) {
    if (room._virtualRoundToken !== session ||
        String(room.roomInfo.startMsgId || '') !== String(startMsgId)) return false;
    const msgId = sent && sent.data && sent.data.msgId;
    if (!sent || sent.err || !/^\d+$/.test(String(msgId)) || BigInt(String(msgId)) <= 0n ||
        (typeof msgId === 'number' && !Number.isSafeInteger(msgId))) {
        throw new Error('机器人下注发送失败或未返回有效消息ID');
    }
    const response = await new Promise((resolve, reject) => {
        Promise.resolve(room.doBet({
            username: bot.playername,
            group_nickname: room.roomInfo.group_nickname,
            chat_id: room.roomInfo.chat_id,
            bet: command,
            msgId: String(msgId)
        }, resolve)).catch(reject);
    });
    if (!response || String(response.code) !== '401') {
        throw new Error('机器人下注缓存失败：' + (response && response.msg));
    }
    return true;
};
