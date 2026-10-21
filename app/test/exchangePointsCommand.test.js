const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function load(file, dependencies) {
    const context = { module: { exports: {} }, console: { log() {}, error() {} },
        require: name => {
            if (Object.hasOwn(dependencies, name)) return dependencies[name];
            if (name === 'crypto') return require('node:crypto');
            throw new Error('Unexpected dependency: ' + name);
        } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
    return context.module.exports;
}

function commandFixture({ user = { username: '光头强' }, result = { data: { res: true, points: 10, score: 20 } }, fail = false } = {}) {
    const exchanges = [], replies = [], seen = new Set();
    const command = load('../chat/exchangePointsCommand.js', {
        '../dao/Cache': { setIfAbsent: async key => {
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        } },
        '../dao/userDao': { getPlayerByChatUserId: async id => {
            assert.equal(id, 'sender');
            return { data: user };
        } },
        '../service/playerPointsExchange': async msg => {
            exchanges.push(msg);
            if (fail) throw new Error('unavailable');
            return result;
        },
        './sendChat': { sendTextMessage: async (text, chat) => replies.push({ text, chat }) }
    });
    const message = { content: '/兑换积分', senderId: 'sender', chatId: 'group', msgId: '1' };
    return { command, exchanges, replies, message };
}

test('exact command exchanges the linked player once and replies to the originating group', async () => {
    const f = commandFixture();
    assert.equal(await f.command({ ...f.message, content: ' /兑换积分\n' }), true);
    await f.command(f.message);
    assert.equal(f.exchanges.length, 1);
    assert.equal(f.exchanges[0].player_name, '光头强');
    assert.equal(f.exchanges[0].userName, '光头强');
    assert.equal(f.replies[0].chat, 'group');
    assert.match(f.replies[0].text, /10积分兑换20分/);
    assert.equal(f.replies.length, 1);
});

test('ordinary chat and commands naming another player do not exchange', async () => {
    const f = commandFixture();
    for (const content of ['庄100', '请/兑换积分', '/兑换积分 光头强', '']) {
        assert.equal(await f.command({ ...f.message, content }), false);
    }
    assert.equal(f.exchanges.length, 0);
});

test('unlinked players and messages without identity or message IDs cannot exchange', async () => {
    for (const overrides of [{ senderId: null }, { msgId: null }]) {
        const f = commandFixture();
        await f.command({ ...f.message, ...overrides });
        assert.equal(f.exchanges.length, 0);
    }
    const f = commandFixture({ user: null });
    await f.command(f.message);
    assert.equal(f.exchanges.length, 0);
    assert.match(f.replies[0].text, /尚未绑定/);
});

test('empty balance and service errors produce useful replies', async () => {
    const empty = commandFixture({ result: { err: null, data: { total_points: 0 } } });
    await empty.command(empty.message);
    assert.match(empty.replies[0].text, /没有可兑换/);
    const failed = commandFixture({ fail: true });
    await failed.command(failed.message);
    assert.match(failed.replies[0].text, /核实/);
});

test('shared service applies statistics date and releases its lock on success and failure', async () => {
    for (const fail of [false, true]) {
        let unlocked = 0;
        const exchange = load('../service/playerPointsExchange.js', {
            pomelo: { app: { get: () => ({ lock: async key => {
                assert.equal(key, 'single_player_all_group_exchange:');
                return { unlock: async () => { unlocked++; } };
            } }) } },
            moment: value => ({ format: () => value }),
            '../dao/systemDao': { getStatisticsDateByAnyGroup: async () => ({ data: { statistics_date: '2026-10-21' } }) },
            '../dao/pointsExchangeDao': { singlePlayerAllGroupExchange: async msg => {
                assert.equal(msg.statistics_date, '2026-10-21');
                if (fail) throw new Error('database failed');
                return { data: { res: true } };
            } }
        });
        if (fail) await assert.rejects(exchange({ player_name: '光头强' }));
        else assert.ok((await exchange({ player_name: '光头强' })).data.res);
        assert.equal(unlocked, 1);
    }
});

test('existing exchange applies group default and positive personal override across all groups', async () => {
    let transaction;
    const mysql = {
        query: async (db, sql) => {
            if (sql.includes('SELECT Id, username, score')) return [{ Id: 7, username: '光头强', score: 100 }];
            if (sql.includes('FROM points_group_user')) return [
                { group_nickname: 'A', userId: 7, points: 10, player_name: '光头强' },
                { group_nickname: 'B', userId: 7, points: 20, player_name: '光头强' }
            ];
            if (sql.includes('FROM group_parameter_setup')) return [
                { group_nickname: 'A', default_exchange: 2 }, { group_nickname: 'B', default_exchange: 3 }
            ];
            if (sql.includes('FROM finance_personal_setup')) return [
                { group_nickname: 'A', userId: 7, username: '光头强', personal_points_redemption_ratio: 0 },
                { group_nickname: 'B', userId: 7, username: '光头强', personal_points_redemption_ratio: 5 }
            ];
            throw new Error('Unexpected SQL: ' + sql);
        },
        _getNewSqlParamEntity: (sql, args) => ({ sql, args }),
        tranExecSync: async (db, entries) => { transaction = entries; return true; }
    };
    const dao = load('../dao/pointsExchangeDao.js', {
        pomelo: { app: { get: () => mysql } },
        '../domain/sx/sendToFrontEnd': { sendNoticeToGameClient() {}, sendNoticeToClient() {} },
        '../service/telegram': { notify: async () => {} }
    });
    const result = await dao.singlePlayerAllGroupExchange({ player_name: '光头强', userName: '光头强' });
    assert.equal(result.data.points, 30);
    assert.equal(result.data.score, 120);
    const balance = transaction.find(entry => entry.sql.includes('UPDATE user'));
    assert.deepEqual(Array.from(balance.args), [120, 120, 30, 30, 7]);
    assert.ok(transaction.some(entry => entry.sql.includes('UPDATE points_group_user')));
    for (const table of ['points_log', 'score_operation_record']) {
        const inserts = transaction.filter(entry => entry.sql.includes('INSERT INTO ' + table));
        assert.deepEqual(Array.from(inserts, entry => entry.args[entry.args.length - 1]), [2, 5]);
        for (const entry of inserts) {
            assert.match(entry.sql, /exchange_ratio/);
            assert.equal((entry.sql.match(/\?/g) || []).length, entry.args.length);
        }
    }
});

test('exchange history returns saved, zero and legacy effective rates, not current settings', async () => {
    const dao = load('../dao/pointsExchangeDao.js', {
        pomelo: { app: { get: () => ({ query: async (db, sql) => {
            if (sql.includes('COUNT(*)')) return [{ total: 4 }];
            return [
                { type: 'exchange', exchange_ratio: '2.500000000000', personal_points_redemption_ratio: 99 },
                { type: 'exchange', exchange_ratio: '0.000000000000' },
                { type: 'cancel', exchange_ratio: null, points_change: 10, score_change: -30 },
                { type: 'reset', exchange_ratio: null, points_change: -10, score_change: 0 }
            ];
        } }) } },
        '../domain/sx/sendToFrontEnd': {}
    });
    const result = await dao.getExchangeInfo({});
    assert.deepEqual(Array.from(result.data.list, item => item.exchange_ratio), [2.5, 0, 3, null, null]);
});

test('score operation history exposes numeric snapshots and null for unknown rates', async () => {
    const dao = load('../dao/playerOptionDao.js', {
        pomelo: { app: { get: () => ({ query: async (db, sql) => {
            if (sql.includes('COUNT(*)')) return [{ count: 3 }];
            return [{ exchange_ratio: '2.500000000000' }, { exchange_ratio: '0.000000000000' }, {}];
        } }) } }
    });
    const result = await dao.getScoreOptionRecord({});
    assert.deepEqual(Array.from(result.data.list, item => item.exchange_ratio), [2.5, 0, null]);
});

test('group exchanges and batch reversals persist rates in both logs with matching SQL parameters', async () => {
    for (const method of ['singleGroupExchange', 'allGroupExchange', 'cancelExchange']) {
        let transaction;
        const record = { group_nickname: 'A', userId: 7, player_name: '光头强', points: 10,
            type: 'exchange', points_change: -10, score_change: 25, exchange_ratio: '2.500000000000', batch_id: 'old' };
        const mysql = {
            query: async (db, sql) => {
                if (sql.includes('FROM group_parameter_setup')) return [{ group_nickname: 'A', default_exchange: 2 }];
                if (sql.includes('FROM finance_personal_setup')) return [{ ...record, username: '光头强', personal_points_redemption_ratio: 2.5 }];
                if (sql.includes('FROM user')) return [{ username: '光头强', score: 100 }];
                return [record];
            },
            _getNewSqlParamEntity: (sql, args) => ({ sql, args }),
            tranExecSync: async (db, entries) => { transaction = entries; return true; }
        };
        const dao = load('../dao/pointsExchangeDao.js', {
            pomelo: { app: { get: () => mysql } },
            '../domain/sx/sendToFrontEnd': { sendNoticeToGameClient() {}, sendNoticeToClient() {} },
            '../service/telegram': { notify: async () => {} }
        });
        await dao[method]({ group_nickname: 'A' });
        for (const table of ['points_log', 'score_operation_record']) {
            const entry = transaction.find(item => item.sql.includes('INSERT INTO ' + table));
            assert.match(entry.sql, /exchange_ratio/);
            assert.equal(Number(entry.args[entry.args.length - 1]), 2.5);
            assert.equal((entry.sql.match(/\?/g) || []).length, entry.args.length);
        }
    }
});
