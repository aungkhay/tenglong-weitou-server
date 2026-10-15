const assert = require('node:assert/strict');
const test = require('node:test');
const sendOnce = require('../domain/sx/sendStopImageOnce');

function setup() {
    const store = new Map();
    const redis = {
        set(key, value, ...args) {
            const cb = args.pop();
            if (args.includes('NX') && store.has(key)) return cb(null, null);
            store.set(key, value);
            cb(null, 'OK');
        },
        get(key, cb) { cb(null, store.get(key) || null); },
        del(key, cb) { store.delete(key); cb(null, 1); }
    };
    const room = () => ({ redis, roomInfo: {
        Id: 1, rType: 'bjl', cc: 1, jc: 2, startMsgId: '100', stopImageSessionId: '100'
    } });
    return { room };
}
const success = { err: null, data: { data: { msgId: '200' } } };

test('separate room instances share the pending and completed send record', async () => {
    const { room } = setup();
    let calls = 0, finish;
    const send = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
    const first = sendOnce(room(), send);
    await Promise.resolve();
    const duplicate = await sendOnce(room(), send);
    assert.equal(duplicate.err, 'STOP_IMAGE_ALREADY_REQUESTED');
    assert.equal(calls, 1);
    finish(success);
    await first;
    assert.deepEqual(await sendOnce(room(), send), success);
    assert.equal(calls, 1);
});

test('stop record survives cleared startMsgId and changed settlement round; new betting session can send', async () => {
    const { room } = setup();
    const instance = room();
    let calls = 0;
    const send = async () => { calls++; return success; };
    await sendOnce(instance, send);
    instance.roomInfo.startMsgId = null;
    instance.roomInfo.jc++;
    await sendOnce(instance, send);
    assert.equal(calls, 1);
    instance.roomInfo.stopImageSessionId = '300';
    await sendOnce(instance, send);
    assert.equal(calls, 2);
});

test('manual stop without sending blocks another process from sending later', async () => {
    const { room } = setup();
    await sendOnce.markStopped(room());
    let calls = 0;
    const result = await sendOnce(room(), async () => { calls++; return success; });
    assert.equal(result.err, 'ROUND_ALREADY_STOPPED');
    assert.equal(calls, 0);
});

test('ambiguous delivery and success without ID never trigger a duplicate retry', async () => {
    for (const response of [{ err: 'SEND_EXCEPTION' }, { err: null, data: {} }]) {
        const { room } = setup();
        let calls = 0;
        const send = async () => { calls++; return response; };
        await sendOnce(room(), send);
        await sendOnce(room(), send);
        assert.equal(calls, 1);
    }
});

test('known pre-send upload failure can be retried', async () => {
    const { room } = setup();
    let calls = 0;
    const send = async () => ++calls === 1 ? { err: 'UPLOAD_FAILED' } : success;
    await sendOnce(room(), send);
    assert.deepEqual(await sendOnce(room(), send), success);
    assert.equal(calls, 2);
});

test('Redis failure prevents sending without duplicate protection', async () => {
    const instance = { roomInfo: { Id: 1, startMsgId: '100' },
        redis: { set(...args) { args.at(-1)(new Error('redis unavailable')); } } };
    let calls = 0;
    await assert.rejects(sendOnce(instance, async () => { calls++; }), /redis unavailable/);
    assert.equal(calls, 0);
});
