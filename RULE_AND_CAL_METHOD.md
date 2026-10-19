# Betting rules and calculation methods

This document describes the current baccarat implementation, including the updated 幸运六 settlement rule. It is based on `app/domain/sx/parseResult.js`, `app/domain/sx/bet.js`, and `app/domain/sx/result.js`. Actual odds and limits come from the group's configuration; example odds below are illustrative, not hardcoded guarantees.

## 1. Input format

Enter a bet name or code followed by a positive integer amount:

```text
庄100
x100
庄对100
幸运六100
幸运七100
完美100
```

English codes are case-insensitive. Amount-first input such as `100x` and `100幸运六` is also supported. Multiple bets can be written together, for example `庄100幸运六100`.

| Bet | Codes / names | Stored field |
| --- | --- | --- |
| Banker | `Z`, `庄` | `z` |
| Player | `X`, `闲` | `x` |
| Tie | `H`, `和` | `h` |
| Banker pair | `ZD`, `Z对`, `庄对` | `zd` |
| Player pair | `XD`, `X对`, `闲对` | `xd` |
| Lucky six | `L`, `幸运六` | `l` |
| Big tiger | `K`, `大老虎` | `k` |
| Lucky seven | `Q`, `幸运七` | `q` |
| Perfect pair | `M`, `完美`, `完美对` | `m` |

### Amount units

- `幸运六1万` and `幸运六1w` mean 10,000.
- `幸运六万1` and `幸运六w1` also mean 10,000.
- The parser recognizes integer amounts. Decimal notation is not supported and should not be used.
- `千` / `K` amount multiplication is disabled. `K` is a bet code for 大老虎.
- An unknown name, missing amount for an ordinary bet, or nonpositive amount is not a valid payable bet.

### Internal naming of 幸运六

`幸运六100` currently parses to `{ type: "幸运六", amount: 100 }` for compatibility with existing bet processing and database mapping. The field is still `l`, but settlement now treats it as 幸运六, winning on either two-card or three-card banker six.

The Chinese input alias and internal type are both `幸运六`. Historical `l` records have no separate marker distinguishing the former two-card-only rule from the current rule. Re-settling those records uses the current rule.

## 2. Combination bets

For ordinary combination bets, the amount applies to EACH component, not to the whole combination.

| Input | Components | Total stake |
| --- | --- | --- |
| `对子100`, `对100`, `D100`, `DZ100` | Banker pair 100 + player pair 100 | 200 |
| `三宝100`, `SB100` | Banker pair 100 + player pair 100 + tie 100 | 300 |
| `四宝100`, `BB100` | Banker pair 100 + player pair 100 + tie 100 + perfect pair 100 | 400 |
| `N100`, `老虎100` | 幸运六 (`l`) 100 + 大老虎 (`k`) 100 | 200 |

四宝 includes **perfect pair**, as implemented by the parser, even though an older comment in `result.js` calls the fourth component 幸运六.

Since `l` now means 幸运六, the `N` combination wins on both components when the three-card banker-six result occurs. With 20× profit odds, `N100` returns 4,200 on that result, for net profit 4,000 against its 200 stake.

## 3. All-in / 梭哈

Supported examples include `庄梭`, `庄梭哈`, `庄S`, `ZS`, `幸运六梭`, `幸运六梭哈`, `幸运六S`, `LS`, `对子梭`, `DS`, `三宝梭`, `SBS`, `四宝梭`, `BBS`, and `老虎梭` / `NS`.

All-in amounts are calculated at import time using the latest player balance:

```text
precedingStake = sum of positive ordinary amounts before the first all-in item
remaining = max(0, currentBalance - precedingStake)
```

| All-in type | Allocation of remaining balance R |
| --- | --- |
| Single bet | R to that bet; individual pair all-ins use floor(R) |
| 对子梭 | Banker pair floor(R/2); player pair receives the remainder |
| 老虎梭 | 幸运六 floor(R/2); 大老虎 receives the remainder |
| 三宝梭 | Banker pair and player pair each floor(R/3); tie receives the remainder |
| 四宝梭 | Banker pair, player pair and tie each floor(R/4); perfect pair receives the remainder |

For example, `四宝梭` with R = 1,003 allocates 250, 250, 250, and 253. A component cancelled before import is skipped without redistributing its share.

The calculation function uses the same R for each separate all-in item in one array; it does not progressively reduce R for successive all-ins. Each resulting item still undergoes balance validation. Do not interpret several single all-in commands as an automatic equal split.

## 4. Replacement, changes, cancellation, and import

- Banker and player share one replacement slot. `庄100闲200` keeps the final valid player bet of 200.
- Later valid bets replace earlier bets in the same category rather than automatically adding to them. Combination bets affect their component categories.
- `改` or `G` before a new bet marks a replacement of the previous order, for example `改幸运六200`.
- `撤`, `撤销`, or `C` alone cancels the order.
- `撤幸运六` or `幸运六撤` cancels the lucky-six category. Category cancellation also supports combinations.
- Incoming messages are cached. Import applies the final stop-betting message boundary; changes and cancellations are also evaluated against that boundary.
- Import processes items individually. Old replaced bets are removed/refunded before the current balance is read for the replacement item.
- Each item must have sufficient balance and pass the applicable maximum limit before it is saved through `userDao.fillBetInfo`.
- Some items can succeed while another fails. Failed or balance-insufficient items may remain in the retry cache; receiving a message is not proof that every item was imported.

## 5. Limits

| Category | Maximum configuration | Minimum configuration |
| --- | --- | --- |
| Banker / player | `pb_max_limit` | `pb_min_limit` |
| Tie / either pair | `sanbao_max_limit` | `sanbao_min_limit` |
| 幸运六 | `lucky6_2_max_limit` | `lucky6_2_min_limit` |
| 大老虎 | `lucky6_3_max_limit` | `lucky6_3_min_limit` |
| 幸运七 | `lucky7_max_limit` | `lucky7_min_limit` |
| 完美 | `perfect_max_limit` | `perfect_min_limit` |

`chkLimit` rejects amounts above the maximum or at/below zero. `chkMinLimit` rejects amounts below the minimum or at/below zero. Equality with a configured boundary passes. The inspected import path calls `chkLimit`; the existence of `chkMinLimit` does not mean that this path enforces minimum limits.

## 6. Result codes and winning conditions

Settlement reads a bitmask from the result feed; it does not independently evaluate cards in these functions. Multiple flags may be present together.

| Flag | Meaning in settlement |
| --- | --- |
| 1 | Banker wins |
| 2 | Player wins |
| 4 | Tie |
| 8 | Banker pair |
| 16 | Player pair |
| 32 | Two-card banker six (small tiger result) |
| 64 | Three-card banker six (big tiger result) |
| 128 | Perfect pair |
| 256 | Lucky-seven four-card result |
| 512 | Lucky-seven five-card result |
| 1024 | Lucky-seven six-card result |

幸运六 wins on flag 32 OR 64. 大老虎 wins only on flag 64. The code trusts these flags; the lucky-six branch does not separately require banker flag 1. Normal feed results should be consistent, for example `1 | 64`.

## 7. Payout formula

Odds settings are scaled by 100:

```text
profitMultiplier = configuredOdds / 100
winningProfit = floor(stake × profitMultiplier)
winningReturn = stake + winningProfit
losingReturn = 0
losingNetProfit = -stake
```

For example, setting 95 means 0.95× profit; 1200 means 12× profit. Returned funds include the original stake. Player settlement rounds each positive winning profit down to a whole unit.

| Bet / outcome | Odds setting | Example setting | Return on 100 |
| --- | --- | --- | --- |
| Banker wins | `banker_odds` | 95 | 195 |
| Player wins | `player_odds` | 100 | 200 |
| Tie wins | `tie_odds` | 800 | 900 |
| Banker/player pair wins | `pair_odds` | 1100 | 1,200 |
| 幸运六: two-card banker six | `lucky_6_2_odds` | 1200 | 1,300 |
| 幸运六: three-card banker six | `lucky_6_3_odds` | 2000 | 2,100 |
| 大老虎: three-card banker six | `lucky_6_3_odds` | 2000 | 2,100 |
| Perfect pair wins | `perfect_pair` | 2500 | 2,600 |
| Lucky seven: four cards | `lucky7_4_odds` | 3000 | 3,100 |
| Lucky seven: five cards | `lucky7_5_odds` | 4000 | 4,100 |
| Lucky seven: six cards | `lucky7_6_odds` | 5000 | 5,100 |

A tie returns banker/player stakes with zero profit. Side bets are not automatically refunded on a tie; they depend on their own result flags.

Settlement and re-settlement refresh the group's odds from the database. They use the current configuration, not necessarily the configuration that existed when the bet was submitted.

### 幸运六100 examples

With two-card odds 1200 and three-card odds 2000:

| Outcome | Stake | Profit/loss | Returned funds |
| --- | --- | --- | --- |
| Two-card banker six | 100 | +1,200 | 1,300 |
| Three-card banker six | 100 | +2,000 | 2,100 |
| Other result, without either six flag | 100 | -100 | 0 |

The 100 stake is charged once. It is not split into two 50 bets, and it is not charged twice for covering both six results.

## 8. Player totals and accounting

```text
totalStake (t_xz) = z + x + h + zd + xd + l + k + m + q
totalReturn (t_fh) = sum of returned funds from winning/refunded bets
playerNetProfit (t_yl) = totalReturn - totalStake
```

If the balance before accepted betting was B, the conceptual balance after settlement is `B - totalStake + totalReturn`, excluding unrelated deposits, withdrawals, refunds, or other rounds.

The accounting function uses the platform perspective:

```text
platformProfit = -floor(totalReturn - totalStake)
personalShareProfit = -floor(personalShareReturn - personalShareStake)
bankerPlayerProfit = -floor(bankerPlayerReturn - (z + x))
hedgeProfit = floor(2 × hedgeStake - hedgeReturn)
looseChangeProfit = -floor(looseChangeReturn - looseChangeStake)
tableShareProfit = -floor(tableShareReturn - (d_z + d_x))
upstreamProfit = floor(upstreamReturn - upstreamStake)
```

Thus a lucky-six player profit of +2,000 appears as platform profit -2,000.

### Banker/player exposure allocation

1. Subtract personal shares: `Z = max(0, z - g_z)`, `X = max(0, x - g_x)`.
2. Where both sides were bet, hedge `min(Z, X)` and take `abs(Z - X)` as the directional remainder.
3. Calculate table share from that remainder: `floor(tableSharePercent / 100 × remainder)`, capped by the configured table-share maximum and the remainder itself.
4. Subtract table share. If the remaining amount is below `pb_min_bet_amount`, put it entirely into loose change.
5. Otherwise, loose change is the remainder modulo the configured unit (`十`=10, `百`=100, `千`=1000, `万`=10000). The rest is upstream stake.

### Effective turnover and washing volume

- Normal settlement sets `yxxz` to zero for a record with banker/player stakes on a tie; otherwise it uses that record's total stake.
- Re-settlement preserves the record's previously confirmed `yxxz`.
- `zx_xml` selects the losing banker stake, otherwise the losing player stake.
- `sb_xml` selects the first losing side-bet stake in this order: banker pair, tie, player pair, 幸运六, 大老虎, 幸运七, perfect pair. It does not sum every losing side bet in a combined record.
- `xml_d = zx_xml + sb_xml`; `xml_s = 0` in this settlement function.

## 9. Implementation limits to keep in mind

- The `l` field now covers both six results. It cannot simultaneously represent a separate two-card-only bet without additional storage/type changes.
- Lucky-six profit is rounded per item in both player and accounting settlement. Other accounting branches mostly retain fractional returns until the final aggregate `floor`; fractional odds can therefore expose differences from per-item player rounding.
- Player settlement uses zero calculated category profit as a loss fallback. A winning bet whose profit rounds to zero can consequently have an incorrect category profit label, even though the return includes its stake. Use positive, appropriate odds and review this edge case before supporting very small fractional payouts.
- If both six flags are supplied, the lucky-six branch chooses two-card odds. Such a contradictory result should be corrected at the feed/source.

## 10. Code and verification reference

| Responsibility | File / function |
| --- | --- |
| Input names, codes, units, combinations | `app/domain/sx/parseResult.js` — `parseBetStrToArray` |
| Result flags | `app/domain/sx/parseResult.js` — `isLucky6_2`, `isLucky6_3`, other predicates |
| Cache, replacement, cancellation, import | `app/domain/sx/bet.js` — `doBet`, `flushBetsToDb` |
| All-in allocation | `app/domain/sx/bet.js` — `processShuoTypeAtFlush` |
| Limits and total input amount | `app/domain/sx/bet.js` — `chkLimit`, `chkMinLimit`, `GetTotalBet` |
| Player payout | `app/domain/sx/result.js` — `settlement_bjl` |
| Platform/accounting payout | `app/domain/sx/result.js` — `settlement_jc_bjl` |
| Exposure and round summary | `app/domain/sx/result.js` — `fill_jc_detail` |

Run `node app/domain/sx/lucky6.test.js` for isolated input, player-payout, and accounting checks covering both lucky-six wins, a loss, and a tie. The broader `node app/domain/sx/result.test.js` requires project dependencies, including Pomelo.
