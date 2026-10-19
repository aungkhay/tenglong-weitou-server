# Telegram 上下分通知

重启后台后，使用现有登录 token 请求 `POST /ht/system_setup/telegram_token_setup`：

```json
{
  "telegram_token": "123456:YOUR_BOT_TOKEN",
  "telegram_chat_id": "-1001234567890",
  "group_nickname": "辉煌三台"
}
```

支持直接 body 或 `{ "data": { ... } }`。机器人需要加入目标群并有发消息权限。
`telegram_chat_id` 可省略，此时从 getUpdates 最近 100 条更新中匹配群标题与
`group_nickname` 完全一致的唯一聊天。先在同名群向机器人发送 `/start`。
若机器人使用 webhook、更新已被其他消费者读取、群名不同或重名，请显式传 chat ID。
业务群昵称用于匹配通知配置，不必与 Telegram 群名一致（显式指定 chat ID 时）。

首次配置自动创建 MySQL 表 `telegram_notification_setup`，数据库账号需要 CREATE 权限。
同一业务群重复配置覆盖原 token 和目标 chat ID；响应不包含 token。
配置成功代表 token 和目标聊天校验通过、配置已保存，不代表已实测发送权限。

成功提交的上分、下分（包含整额下分和桌台入口）、撤销、积分兑换发送纯文本通知，
包含群、玩家、操作、类型、金额、操作员和 UTC 时间。未配置的业务群不发送。
网络请求超时为 5 秒。发送失败记录不含凭据的日志，不回滚已提交业务，当前不自动重试；
因此网络中断或进程退出时可能漏发，不保证可靠投递。

参考：[Telegram Bot API](https://core.telegram.org/bots/api#sendmessage)。
