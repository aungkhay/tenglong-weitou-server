const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load({ updates = [], fail = false, rows = [] } = {}) {
    const calls = [], queries = [];
    const context = { module: { exports: {} }, console: { error() {} }, Date, Map,
        require(name) {
            if (name === 'axios') return { post: async (url, body) => {
                calls.push({ url, body });
                if (fail) throw new Error('secret token in URL');
                return { data: { ok: true, result: url.endsWith('getUpdates') ? updates : { id: -123 } } };
            } };
            return { app: { get: () => ({ query: async (db, sql, args) => {
                queries.push({ sql, args }); return rows;
            } }) } };
        } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../service/telegram.js'), 'utf8'), context);
    return { api: context.module.exports, calls, queries };
}
const config = { group_nickname: '辉煌三台', telegram_token: '123:secret' };

test('score notifications run only after successful commit for both directions', async () => {
    for (const committed of [true, false]) {
        const events = [];
        const mysql = { _getNewSqlParamEntity: () => ({}), tranExecSync: async () => {
            events.push('commit'); return committed;
        } };
        const context = { module: { exports: {} }, console,
            require: name => name === 'pomelo' ? { app: { get: () => mysql } } : {
                notify: async (msg, action) => events.push(action)
            } };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dao/playerOptionDao.js'), 'utf8'), context);
        for (const method of ['add_score', 'subtract_score']) {
            events.length = 0;
            await context.module.exports[method]({ group_nickname: '群', player_name: '玩家', option_score: 10 });
            assert.deepEqual(events, committed ? ['commit', method === 'add_score' ? '上分' : '下分'] : ['commit']);
        }
    }
});

test('setup POST route accepts plain and wrapped request bodies', async () => {
    const routes = {};
    const router = { post: (path, handler) => { routes[path] = handler; } };
    const context = { module: { exports: {} }, console, require: name => {
        if (name === 'express') return { Router: () => router };
        if (name === 'pomelo') return { app: { get() {} } };
        if (name === '../../telegram') return { setup: async msg => ({ group_nickname: msg.group_nickname }) };
        return {};
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../service/route/ht/system_setup.js'), 'utf8'), context);
    for (const body of [config, { data: config }]) {
        let result;
        await routes['/telegram_token_setup']({ body }, { send: value => { result = value; } });
        assert.equal(result.code, 200);
        assert.equal(result.data.group_nickname, config.group_nickname);
    }
});

test('setup resolves exact group title and persists without returning token', async () => {
    const { api, queries } = load({ updates: [{ message: { chat: { title: config.group_nickname, id: -123 } } }] });
    const result = await api.setup(config);
    assert.equal(result.telegram_chat_id, '-123');
    assert.equal(result.telegram_token, undefined);
    assert.equal(queries[1].args[1], config.telegram_token);
});
test('explicit chat ID skips update discovery', async () => {
    const { api, calls } = load();
    await api.setup({ ...config, telegram_chat_id: '-123' });
    assert.ok(calls.every(c => !c.url.endsWith('getUpdates')));
});
test('missing or ambiguous destination is not saved', async () => {
    for (const updates of [[], [1, 2].map(id => ({ message: { chat: { title: config.group_nickname, id } } }))]) {
        const { api, queries } = load({ updates });
        await assert.rejects(api.setup(config), /telegram_chat_id/);
        assert.equal(queries.length, 0);
    }
});
test('unconfigured group sends nothing; configured group sends plain score details', async () => {
    const empty = load();
    await empty.api.notify(config, '上分');
    assert.equal(empty.calls.length, 0);
    const configured = load({ rows: [{ ...config, telegram_chat_id: '-123' }] });
    assert.equal(await configured.api.notify({ ...config, player_name: '张三', option_score: 50 }, '下分'), true);
    assert.match(configured.calls[0].body.text, /下分/);
    assert.equal(configured.calls[0].body.chat_id, '-123');
});
test('Telegram failures are isolated and do not expose credentials', async () => {
    const { api } = load({ fail: true, rows: [{ ...config, telegram_chat_id: '-123' }] });
    await assert.rejects(api.setup(config), err => !err.message.includes('secret'));
    assert.equal(await api.notify(config, '上分'), false);
});
