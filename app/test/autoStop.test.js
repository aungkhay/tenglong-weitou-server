const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function setup(send = async () => ({ data: { data: { msgId: '123' } } })) {
    const source = fs.readFileSync(path.join(__dirname, '../domain/sx/sxRoom.js'), 'utf8');
    const begin = source.indexOf('sxRoom.prototype.cancelAutoStopImage =');
    const end = source.indexOf('sxRoom.prototype.updateLastStopMsgId =', begin);
    function Room() {}
    const timers = [], notices = [], uploads = [];
    const stopBegin = source.indexOf('sxRoom.prototype.stopBet =');
    const stopEnd = source.indexOf('sxRoom.prototype.pushResult =', stopBegin);
    const pauseBegin = source.indexOf('sxRoom.prototype.pauseGame =');
    const pauseEnd = source.indexOf('\nsxRoom.prototype.', pauseBegin + 1);
    vm.runInNewContext(source.slice(begin, end) + source.slice(stopBegin, stopEnd) + source.slice(pauseBegin, pauseEnd), {
        sxRoom: Room, GAMESTATE: { BET: 1, STOP_BET: 2, PAUSE: 3 },
        GMResponse: require('../domain/GMResponse'), CODE: { STOP_BET2: { code: '90', msg: '停止下注' } },
        config: { imgPath: { curSystem: 'test', test: '/images' } },
        setTimeout: (fn, delay) => timers.push({ fn, delay }),
        clearTimeout: id => { timers[id - 1].cancelled = true; },
        sendChat: { sendImageMessage: (...args) => { uploads.push(args); return send(); } },
        sendStopImageOnce: (room, send) => send(),
        sendToFront: { sendNoticeToClient: (...args) => notices.push(args) },
        console: { log() {}, error() {} }
    });
    const room = new Room();
    room.roomInfo = { cc: 1, jc: 2, quick_mode: 1, quickModeJc: 3,
        gameState: 1, auto_send_img2_after_start: 1, second_send_img2_after_start: 10,
        img2_after_start: '/stop.png', img_stop: '/manual-stop.png', chat_id: 'group' };
    room.updateLastStopMsgId = id => { room.roomInfo.lastStopMsgId = id; };
    room.doStopBet = async () => { room.cancelAutoStopImage(); room.roomInfo.gameState = 2; };
    room.setStateRedis = () => {};
    room.updateGame = () => {};
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

test('pause upload cancels the image 2 timer and blocks an already queued callback', async () => {
    let finish;
    const { room, timers, uploads } = setup(() => new Promise(resolve => { finish = resolve; }));
    await room.doAutoSendAfterStartImage();
    const pause = new Promise(resolve => room.pauseGame({}, resolve));
    assert.equal(timers[0].cancelled, true);
    await timers[0].fn();
    assert.equal(uploads.length, 1);
    finish({ data: { data: { msgId: '123' } } });
    await pause;
    await timers[0].fn();
    assert.equal(uploads.length, 1);
});

test('replaced room state cannot leave an old image 2 timer active', async () => {
    const { room, timers, uploads } = setup();
    await room.doAutoSendAfterStartImage();
    room.roomInfo = { ...room.roomInfo, gameState: 2, isCurRoundStopBet: true };
    await timers[0].fn();
    assert.equal(uploads.length, 0);
});

test('manual stop in flight prevents automatic image 2 from sending', async () => {
    let finish;
    const { room, timers, uploads } = setup(() => new Promise(resolve => { finish = resolve; }));
    await room.doAutoSendAfterStartImage();
    const manual = new Promise(resolve => room.stopBet({ server_send_stop_image: true }, resolve));
    await timers[0].fn();
    assert.equal(uploads.length, 1);
    finish({ data: { data: { msgId: '123' } } });
    assert.equal((await manual).code, '90');
    assert.equal(room.roomInfo.gameState, 2);
    assert.equal(room._sendingToolStopImage, false);
});

test('successful send_index suppresses rearmed auto image 2 but permits another manual send', async () => {
    const { room, timers, uploads } = setup();
    await room.doAutoSendAfterStartImage();
    const manual = () => new Promise(resolve => room.stopBet({ server_send_stop_image: true }, resolve));
    assert.equal((await manual()).code, '90');
    assert.equal(room.roomInfo.manualStopImageSent, true);
    assert.equal(timers[0].cancelled, true);
    room.roomInfo.gameState = 1;
    room.roomInfo.isCurRoundStopBet = false;
    await room.doAutoSendAfterStartImage();
    await timers[1].fn();
    assert.equal(uploads.length, 1);
    assert.equal((await manual()).code, '90');
    assert.equal(uploads.length, 2);
});

test('send_index uploaded-image notification suppresses auto image 2 too', async () => {
    const { room, timers, uploads } = setup();
    await room.doAutoSendAfterStartImage();
    await new Promise(resolve => room.stopBet({ tool_uploaded_stop_image: true, msgId: '123' }, resolve));
    assert.equal(room.roomInfo.manualStopImageSent, true);
    assert.equal(timers[0].cancelled, true);
    await timers[0].fn();
    assert.equal(uploads.length, 0);
});

test('automatic stop in flight prevents manual duplicate and releases guard on completion', async () => {
    let finish;
    const { room, timers, uploads } = setup(() => new Promise(resolve => { finish = resolve; }));
    await room.doAutoSendAfterStartImage();
    const automatic = timers[0].fn();
    const manual = await new Promise(resolve => room.stopBet({ server_send_stop_image: true }, resolve));
    assert.equal(manual.code, 500);
    assert.equal(uploads.length, 1);
    finish({ data: { data: { msgId: '123' } } });
    await automatic;
    assert.equal(room.roomInfo.gameState, 2);
    assert.equal(room._sendingToolStopImage, false);
});

test('failed automatic upload releases guard so manual stop can retry', async () => {
    let attempts = 0;
    const { room, timers, uploads } = setup(async () => ++attempts === 1
        ? { err: 'failed' } : { data: { data: { msgId: '123' } } });
    await room.doAutoSendAfterStartImage();
    await timers[0].fn();
    assert.equal(room._sendingToolStopImage, false);
    const manual = await new Promise(resolve => room.stopBet({ server_send_stop_image: true }, resolve));
    assert.equal(manual.code, '90');
    assert.equal(uploads.length, 2);
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
