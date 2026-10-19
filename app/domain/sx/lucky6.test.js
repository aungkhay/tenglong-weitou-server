const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parser = require('./parseResult');

// Exercise real settlement calculations without a database or running Pomelo app.
let saved;
const sandbox = {
    module: { exports: {} },
    console: { log() {}, error() {} },
    setTimeout() {},
    require(name) {
        if (name === './parseResult') return parser;
        if (name === 'pomelo') return { app: { get() {} } };
        if (name === '../../dao/userDao') return {
            async updateResult(msg, item) { saved = item; }
        };
        if (name === '../../dao/playerDao') return {
            async getRealPlayerName() { return { data: [] }; },
            async updatePointsAfterSettlement() { return {}; }
        };
        if (name === '../../dao/financialInquiriesDao') return {
            async total_gameshist_day() { return {}; }
        };
        return {};
    }
};
vm.runInNewContext(fs.readFileSync(require.resolve('./result'), 'utf8') + `
    module.exports.settlePlayer = settlement_bjl;
    fill_jc_detail = async () => {};
    sendToGameFront = () => {};
`, sandbox);

async function run() {
    const parsed = parser.parseBetStrToArray('幸运六100');
    assert.deepEqual(parsed, [{ type: '幸运六', amount: 100 }]);
    const parameters = { lucky_6_2_odds: 1200, lucky_6_3_odds: 2000, tie_odds: 800 };
    const result = sandbox.module.exports;
    for (const [code, returned, profit] of [
        [1 | 32, 1300, 1200],
        [1 | 64, 2100, 2000],
        [2, 0, -100],
        [4, 0, -100]
    ]) {
        const stake = { z: 0, x: 0, h: 0, zd: 0, xd: 0,
            l: parsed[0].amount, k: 0, m: 0, q: 0 };
        await result.settlePlayer({ result_code: code },
            { parameter_setup: parameters }, [stake]);
        assert.equal(saved.t_fh, returned);
        assert.equal(saved.lyl, profit);
        assert.equal(saved.t_yl, profit);
        const accounting = result.do_settlement_jc_bjl(code, parameters, stake);
        assert.equal(accounting.t_fh, returned);
        assert.equal(accounting.t_yl, -profit);
    }
    console.log('Lucky six: parser, player and accounting settlement passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
