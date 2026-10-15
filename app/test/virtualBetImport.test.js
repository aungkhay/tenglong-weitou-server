const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cacheVirtualBet = require('../domain/sx/cacheVirtualBet');
const parseMessage = require('../util/parseMessageResponse');

function setup() {
    const context = {
        module: { exports: {} }, __filename, console: { log() {}, error() {} },
        require(name) {
            if (name === 'pomelo') return { app: { get: () => ({ lock: async () => ({ unlock() {} }) }) } };
            if (name === '../GMResponse') return require('../domain/GMResponse');
            if (name === '../../dao/userDao') return { getUserByName: async () => ({ data: { Id: 7, score: 1000 } }) };
            if (name === '../../util/code') return require('../util/code');
            if (name === './parseResult') return { parseBetStrToArray: () => [{ type: '庄', amount: 100 }] };
            if (name === 'pomelo-logger') return { getLogger: () => ({ info() {} }) };
            return {};
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../domain/sx/bet.js'), 'utf8'), context);
    const bet = context.module.exports;
    const session = {};
    const room = { _virtualRoundToken: session,
        roomInfo: { Id: 1, cc: 1, jc: 2, startMsgId: '10', group_nickname: 'group', chat_id: 'chat' },
        doBet(msg, cb) { return bet.doBet(msg, this.roomInfo, '', 0, null, cb); }
    };
    return { bet, room, session };
}
const bot = { playername: 'robot' };
const sent = { code: 200, data: { msgId: '676216923775565801' } };

test('successful robot send is cached without a webhook; callback cannot duplicate it even after import', async () => {
    const { bet, room, session } = setup();
    assert.equal(await cacheVirtualBet(room, bot, 'z100', sent, session, '10'), true);
    assert.equal(bet.tempBetCache[1][7].length, 1);
    const callback = parseMessage('{"msgId":676216923775565801}');
    const deliver = () => new Promise(resolve => room.doBet({ username: 'robot', bet: 'z100', msgId: callback.msgId }, resolve));
    await deliver();
    assert.equal(bet.tempBetCache[1][7].length, 1);
    delete bet.tempBetCache[1]; // Successful import consumes the cache, not deduplication state.
    await deliver();
    assert.equal(bet.tempBetCache[1], undefined);
    bet.clearBetCache(1);
    assert.equal(bet.receivedBetMessageIds[1], undefined);
});

test('callback arriving before send response also produces only one cached bet', async () => {
    const { bet, room, session } = setup();
    await new Promise(resolve => room.doBet({ username: 'robot', bet: 'z100', msgId: sent.data.msgId }, resolve));
    await cacheVirtualBet(room, bot, 'z100', sent, session, '10');
    assert.equal(bet.tempBetCache[1][7].length, 1);
});

test('failed sends and missing or rounded message IDs do not create bets', async () => {
    for (const response of [undefined, { err: 'failed' }, { data: {} },
        { data: { msgId: 9007199254740992 } }, { data: { msgId: '0' } }]) {
        const { bet, room, session } = setup();
        await assert.rejects(cacheVirtualBet(room, bot, 'z100', response, session, '10'));
        assert.equal(bet.tempBetCache[1], undefined);
    }
});

test('late response is ignored after a new start image, but same-round stop keeps the real ID for import filtering', async () => {
    const { bet, room, session } = setup();
    room.roomInfo.startMsgId = '20';
    assert.equal(await cacheVirtualBet(room, bot, 'z100', sent, session, '10'), false);
    assert.equal(bet.tempBetCache[1], undefined);
    room.roomInfo.startMsgId = '10';
    room.roomInfo.lastStopMsgId = '676216923775565800';
    await cacheVirtualBet(room, bot, 'z100', sent, session, '10');
    assert.equal(bet.tempBetCache[1][7][0].msgId, sent.data.msgId);
});

test('current bet query includes virtual users regardless of the global yxtz flag', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../dao/playerDao.js'), 'utf8');
    const start = source.indexOf('playerDao.getPlayerBetData =');
    const end = source.indexOf('\nplayerDao.', start + 1);
    let sql;
    const context = { playerDao: {}, console,
        mysql: { query: async (db, query) => { sql = query; return [{ userName: 'robot', z: 100 }]; } } };
    vm.runInNewContext(source.slice(start, end < 0 ? undefined : end), context);
    const result = await context.playerDao.getPlayerBetData({ group_nickname: 'group', statistics_date: '2026-10-15', round: 3 });
    assert.equal(result.data[0].userName, 'robot');
    assert.doesNotMatch(sql, /yxtz|is_virtual/);
    assert.match(sql, /g.closed = 0/);
});

test('table endpoint selects the active quick-mode betting round', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../service/route/data_query.js'), 'utf8');
    const start = source.indexOf("router.post('/get_player_bet_data'");
    const end = source.indexOf('\nrouter.post(', start + 1);
    for (const quick_mode of [0, 1]) {
        let handler, query;
        vm.runInNewContext(source.slice(start, end), {
            router: { post: (route, fn) => { handler = fn; } },
            redlock: { lock: async () => ({ unlock() {} }) },
            systemDao: { getGroupPullDataSetup: async () => ({ data: [{ Id: 1, rType: 1, statistics_date: '2026-10-15' }] }) },
            moment: () => ({ format: () => '2026-10-15' }),
            cache: { get: async () => ({ cc: 1, jc: 2, quickModeJc: 3, quick_mode }) },
            playerDao: { getPlayerBetData: async msg => { query = msg; return { data: [] }; } },
            console: { log() {} }
        });
        await handler({ body: { group_nickname: 'group', userId: 1 } }, { send() {} });
        assert.equal(query.round, quick_mode ? 3 : 2);
    }
});
