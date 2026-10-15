const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
    const source = fs.readFileSync(path.join(__dirname, '../service/route/opt.js'), 'utf8');
    const start = source.indexOf("router.post('/send_index'");
    const end = source.indexOf("router.post('/edit_bet_data'", start);
    let handler;
    const calls = [];
    vm.runInNewContext(source.slice(start, end), {
        router: { post: (name, fn) => { handler = fn; } },
        redlock: { lock: async () => {} },
        systemDao: { getGroupPullDataByChatGroupNickname: async () => ({ data: [
            { Id: 1, group_nickname: 'table', chat_id: 'chat' }
        ] }) },
        resolveToolUploadChatId: () => 'chat',
        pomelo: { app: { rpc: { bjl: { bjlRemote: { stopBet(id, msg, cb) {
            calls.push(msg);
            cb({ code: '90', data: { msgId: msg.msgId || '999' } });
        } } } } } },
        console: { log() {} }
    });
    const run = async msg => {
        let response;
        await handler({ body: { group_nickname: 'chat group', index: 2, ...msg } },
            { send: result => { response = result; } });
        return response;
    };
    return { run, calls };
}

test('send_index with uploaded image ID records the stop without requesting a second send', async () => {
    const { run, calls } = setup();
    const result = await run({ msgId: '676216923775565801' });
    assert.equal(result.code, 200);
    assert.equal(calls[0].server_send_stop_image, false);
    assert.equal(calls[0].tool_uploaded_stop_image, true);
    assert.equal(calls[0].msgId, '676216923775565801');
});

test('send_index without an image ID still requests a server send', async () => {
    const { run, calls } = setup();
    assert.equal((await run({})).code, 200);
    assert.equal(calls[0].server_send_stop_image, true);
    assert.equal(calls[0].tool_uploaded_stop_image, false);
});

test('invalid uploaded IDs cannot fall through to sending another image', async () => {
    for (const msgId of ['bad', '0', -1, 676216923775565800]) {
        const { run, calls } = setup();
        assert.equal((await run({ msgId })).code, 500);
        assert.equal(calls.length, 0);
    }
});
