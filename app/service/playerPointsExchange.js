const pomelo = require('pomelo');
const moment = require('moment');
const systemDao = require('../dao/systemDao');
const pointsExchangeDao = require('../dao/pointsExchangeDao');

// The HTTP endpoint and chat command share the same exchange lock and date.
module.exports = async function playerPointsExchange(msg) {
    let lock;
    try {
        lock = await pomelo.app.get('redlock').lock('single_player_all_group_exchange:', 60000);
        const groupInfo = await systemDao.getStatisticsDateByAnyGroup();
        const exchange = { ...msg };
        if (groupInfo.data) {
            exchange.statistics_date = moment(groupInfo.data.statistics_date).format('YYYY-MM-DD');
        }
        return await pointsExchangeDao.singlePlayerAllGroupExchange(exchange);
    } finally {
        if (lock) await lock.unlock().catch(err => console.error('积分兑换解锁失败:', err));
    }
};
