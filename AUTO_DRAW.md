# 微投

> Base URL: `http://127.0.0.1:5197`    
> Method: `POST`

### 获取台号
``` js
const url = `${baseUrl}/data_query/get_desk_info`;
const data = {
    group_nickname: '腾龙微投'
}
// Response Data
const res = {
    code: 200,
    msg: '获取记录成功',
    data: {
        desk_number: 1,
        shoe: 1,
        round: 1
    }
}
``` 

### 开奖
```js
const url = `${baseUrl}/opt/lottery_auto_draw`;
const data = {
    desk_number: 28
    group_nickname: "腾龙微投"
    shoe: 2
    round: 20
    result: 1
}
// result
// 庄：1
// 闲：2
// 和：4
// 庄对：8
// 闲对：16
// 幸运六2：32
// 幸运六3：64
// 完美：128
```