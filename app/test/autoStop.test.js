const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function setup(send = async () => ({ data: { data: { msgId: '123' } } })) {
    const source = fs.readFileSync(path.join(__dirname, '../domain/sx/sxRoom.js'), 'utf8');
    const begin = source.indexOf('sxRoom.prototype.doAutoSendAfterStartImage =');
    const end = source.indexOf('sxRoom.prototype.updateLastStopMsgId =', begin);
    function Room() {}
    const timers = [], notices = [], uploads = [];
    vm.runInNewContext(source.slice(begin, end), {
        sxRoom: Room, GAMESTATE: { BET: 1 },
        config: { imgPath: { curSystem: 'test', test: '/images' } },
        setTimeout: (fn, delay) => timers.push({ fn, delay }),
        sendChat: { sendImageMessage: (...args) => { uploads.push(args); return send(); } },
        sendToFront: { sendNoticeToClient: (...args) => notices.push(args) },
        console: { log() {}, error() {} }
    });
    const room = new Room();
    room.roomInfo = { cc: 1, jc: 2, quick_mode: 1, quickModeJc: 3,
        gameState: 1, auto_send_img2_after_start: 1, second_send_img2_after_start: 10,
        img2_after_start: '/stop.png', chat_id: 'group' };
    room.updateLastStopMsgId = id => { room.roomInfo.lastStopMsgId = id; };
    room.doStopBet = async () => { room.roomInfo.gameState = 2; };
    return { room, timers, notices, uploads };
}

test('quick-mode auto stop survives settlement of the previous round', async () => {
    const { room, timers, uploads } = setup();
    await room.doAutoSendAfterStartImage();
    room.roomInfo.jc++;
    assert.equal(timers[0].delay, 10000);
    await timers[0].fn();
    assert.equal(uploads.length, 1);
    assert.equal(room.roomInfo.gameState, 2);
    assert.equal(room.roomInfo.lastStopMsgId, '123');
});

test('image 2 is skipped when betting already stopped before the timer fires', async () => {
    for (const stoppedState of [
        { gameState: 2 },
        { gameState: 1, isCurRoundStopBet: true }
    ]) {
        const { room, timers, uploads, notices } = setup();
        await room.doAutoSendAfterStartImage();
        Object.assign(room.roomInfo, stoppedState, { lastStopMsgId: '100' });
        await timers[0].fn();
        assert.equal(uploads.length, 0);
        assert.equal(notices.length, 0);
        assert.equal(room.roomInfo.lastStopMsgId, '100');
    }
});

test('old timers and late upload responses cannot stop a new betting session', async () => {
    let finish;
    const { room, timers, uploads } = setup(() => new Promise(resolve => { finish = resolve; }));
    await room.doAutoSendAfterStartImage();
    const pending = timers[0].fn();
    await room.doAutoSendAfterStartImage();
    finish({ data: { data: { msgId: '123' } } });
    await pending;
    await timers[0].fn();
    assert.equal(uploads.length, 1);
    assert.equal(room.roomInfo.gameState, 1);
    assert.equal(room.roomInfo.lastStopMsgId, undefined);
});

test('failed uploads and invalid IDs report failure without falsely stopping', async () => {
    for (const send of [async () => { throw Error('network'); }, async () => ({}),
        async () => ({ err: 'FILE_NOT_FOUND' }),
        async () => ({ data: { data: { msgId: 9007199254740992 } } })]) {
        const { room, timers, notices } = setup(send);
        await room.doAutoSendAfterStartImage();
        await timers[0].fn();
        assert.equal(notices.length, 1);
        assert.equal(room.roomInfo.gameState, 1);
        assert.equal(room.roomInfo.lastStopMsgId, undefined);
    }
});

test('normal mode skips an obsolete round; missing image reports configuration error', async () => {
    const { room, timers, notices, uploads } = setup();
    room.roomInfo.quick_mode = 0;
    await room.doAutoSendAfterStartImage();
    room.roomInfo.jc++;
    await timers[0].fn();
    assert.equal(uploads.length, 0);
    room.roomInfo.img2_after_start = null;
    await room.doAutoSendAfterStartImage();
    await timers[1].fn();
    assert.equal(notices.length, 1);
    assert.equal(room.roomInfo.gameState, 1);
});
