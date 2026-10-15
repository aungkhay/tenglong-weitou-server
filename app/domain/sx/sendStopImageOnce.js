const TTL_SECONDS = 7 * 24 * 60 * 60;

function keyFor(room) {
    const info = room.roomInfo;
    const start = String(info.stopImageSessionId || info.startMsgId || '');
    const round = start
        ? ['start', start]
        : ['round', info.statistics_date, info.cc,
            Number(info.quick_mode) === 1 ? info.quickModeJc : info.jc];
    return 'stop-image-once:' + JSON.stringify([info.rType || 'bjl', info.Id, ...round]);
}

function redisCall(redis, method, ...args) {
    return new Promise((resolve, reject) => {
        redis[method](...args, (err, result) => err ? reject(err) : resolve(result));
    });
}

async function sendOnce(room, send) {
    const key = keyFor(room);
    const redis = room.redis;
    // Claim before uploading, shared by automatic, manual and pause paths/processes.
    const claimed = await redisCall(redis, 'set', key, JSON.stringify({ pending: true }), 'EX', TTL_SECONDS, 'NX');
    if (claimed !== 'OK') {
        const stored = await redisCall(redis, 'get', key);
        const previous = stored ? JSON.parse(stored) : null;
        console.log('[stop-image duplicate blocked]', key);
        return previous && previous.result
            ? previous.result
            : { err: 'STOP_IMAGE_ALREADY_REQUESTED', message: '本局截止图片已发送或正在发送，不重复发送' };
    }
    let result;
    try {
        result = await send();
    } catch (err) {
        // A transport timeout may occur after delivery: retain the claim.
        result = { err: 'STOP_IMAGE_SEND_UNCERTAIN', message: err.message };
    }
    // These errors occur before the chat-message send and are safe to retry.
    if (result && ['FILE_NOT_FOUND', 'UPLOAD_FAILED', 'UPLOAD_INVALID_RESULT'].includes(result.err)) {
        await redisCall(redis, 'del', key);
    } else {
        await redisCall(redis, 'set', key, JSON.stringify({ result: result || {
            err: 'STOP_IMAGE_SEND_UNCERTAIN', message: '发送结果未知，不重复发送截止图片'
        } }), 'EX', TTL_SECONDS);
    }
    return result;
}

sendOnce.markStopped = async room => {
    const msgId = room.roomInfo.lastStopMsgId;
    const result = msgId ? { err: null, data: { data: { msgId: String(msgId) } } }
        : { err: 'ROUND_ALREADY_STOPPED', message: '本局已停止下注，不重复发送截止图片' };
    await redisCall(room.redis, 'set', keyFor(room), JSON.stringify({ result }), 'EX', TTL_SECONDS, 'NX');
};

module.exports = sendOnce;
