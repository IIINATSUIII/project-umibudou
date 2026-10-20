# オープンPR 20件のレビュー結果

確認日: 2026-10-06（JST）。最終参照確認: 10:01頃。

## 結論

**修正項目15件（P1: 6件、P2: 9件）。現状のまま全件を取り込むことは推奨しない。**

- 各PRのHEADと現在の取り込み先を個別に比較した20件は、すべて機械的なマージ競合なし。
- PR同士のHEADを比較した190組中95組に機械的な競合あり。残り95組も、仕様やデータ形式が整合することを保証するものではない。
- 以下は変更差分・周辺コード・仕様資料から確認した指摘。確認方法欄は修正後に行うべき検証であり、今回の実行結果ではない。
- 予約、顧客、問診・QR・名簿を3サブエージェントで分担し、主担当が指摘を再確認・統合した。

## 優先修正項目

### R01 / P1 — 既存予約データを移行せず列順を変更する

対象: #29 / #35。#36 / #37にも継承。
場所: `src/lib/sheets.ts:32-38`。

旧11列から新21列へ変更したが、既存行を新しい列位置で解釈するため、旧channelがdiveDate、旧statusがtimeSlotになる。更新すると誤読した値を全行へ書き戻す。ヘッダーだけの書き換えでは移行にならない。ローカルJSONも旧形式を変換せず返すため、diveDateを使う一覧で例外が起こる。

**修正:** Sheets・JSONの旧形式を識別し、データを保全して移行する。移行前の非互換書き込みを拒否し、予約ID・問診参照を維持する。
**確認:** 旧形式の予約を読み、一覧表示・ステータス更新後も日付・人数・連絡先・参照が一致すること。

### R02 / P1 — 同時予約で予約IDが重複する

対象: #29 / #35。#36 / #37にも継承。
場所: `src/lib/reservations.ts:18-20`、createReservationの一覧取得から追加まで。

IDが当日の既存件数+1で、読み取りと追加が別操作。2リクエストが同じ一覧を読むと同じIDになり、更新や問診の紐付けが別顧客の予約へ向く。欠番がある場合も既存IDと衝突し得る。

**修正:** 全実行環境で重複しないID方式、または排他付きの採番・追加をストアに実装する。最大値+1や単一プロセス内の排他だけでは同時実行を解決しない。
**確認:** 2件が同じ一覧を読んでから並行追加する条件で、別IDと正しい問診参照を確認する。

### R03 / P1 — 同時問診提出で顧客IDが重複する

対象: #33。#42 / #47にも継承。
場所: `src/lib/customerRegistration.ts:238-240`（一覧取得230行）。

異なる新規顧客の処理が同じ一覧を読むと、双方に最大値+1の同じIDを付与する。個人情報と問診のcustomerIdが混ざり、findによる更新は先頭の顧客へ適用される。PR本文にも既知の制約として記載されているが、公開フォームの並行提出で起こり得る。

**修正:** 顧客照合・採番・追加を、複数インスタンスでも整合する操作へまとめる。
**確認:** 異なる2人を並行登録し、顧客IDと問診参照がそれぞれ一意であること。

### R04 / P1 — 既存問診シートの列がずれる

対象: #34。#39にも継承。
場所: `src/lib/sheets.ts:36`。

旧lastNameの前へQR等7列を挿入する一方、既存データを移行しない。旧姓がqrToken、旧電話がlastNameとなり、健康情報・同意も誤読する。qrUsed更新などで全行を書き戻すと破損が固定される。

**修正:** 追加列を末尾へ置くか、版を識別して全行を明示的に移行してから新順序を利用する。
**確認:** 旧37列の行について、読取・受付済み更新の前後で氏名、健康項目、同意が一致すること。

### R05 / P1 — 予約完了QRとダッシュボードから問診に進めない

対象: #38。
場所: `src/app/questionnaire/[id]/layout.tsx:15`。

問診ページが秘密トークンと期限による予約検索へ変わるが、booking/page.tsx:66とdashboard/page.tsx:147は予約IDのURLを生成したまま。公開予約作成もトークンを発行しないため、通常の予約完了QRで404となる。

**修正:** 予約作成時にトークン・期限を発行し、すべてのURL生成箇所へ返す。予約IDだけで公開閲覧を許可する互換処理は避ける。
**確認:** 公開予約→完了QR→問診、ダッシュボード→問診の両導線を確認する。

### R06 / P1 — 旧予約IDだけで氏名と受付QRを取得できる

対象: #40。
場所: `src/app/api/public/questionnaires/route.ts:24`。

新公開GETはquestionnaireTokenがない旧予約に対し、予約IDを閲覧資格として受け付ける。旧予約へ本PR適用後に問診を提出すると、予約IDを知る未認証者が氏名・カナ・利用日・コース・有効な受付qrTokenを取得できる。旧IDは推測困難な秘密資格として設計されていない。

**修正:** 公開読取と既存回答返却には推測困難なトークンを必須にする。旧予約はスタッフ操作でトークンを発行・移行する。
**確認:** 旧予約IDだけでは個人情報や受付QRを返さず、正しい有効トークンでのみ取得できること。

### R07 / P2 — 強制保存で他スタッフの変更まで巻き戻す

対象: #32。#33 / #42 / #47にも継承。
場所: `src/app/customers/[id]/page.tsx:45-52`（保存168行、再送245行付近）。

toDeltaが変更していない項目も含む。Aが電話、旧版を開いているBが備考を変更し、Bが409後に強制保存すると、Aの新しい電話まで古い値へ戻る。

**修正:** 編集開始時の値と比較して、実際に変更した項目のみ送る。再送時も同じ差分を使用する。
**確認:** 2画面で別項目を変更し、409後の強制保存でも両方の変更が残ること。

### R08 / P2 — 一方の保存がもう一方の未保存入力を破棄する

対象: #32。#33 / #42 / #47にも継承。
場所: `src/app/customers/[id]/page.tsx:145-150`。

基本情報とガイドメモを同時に編集できるが、一方を保存するとapplyCustomerが両方の入力をリセットし、双方の編集モードを閉じる。保存対象に入らなかった入力が失われる。

**修正:** 同時編集を抑止するか、保存したフォームだけを更新・終了する。
**確認:** 両フォームを変更し、それぞれ片方だけ保存する2通りで未保存入力を確認する。

### R09 / P2 — 氏名検索APIがフルネームに一致しない

対象: #47。
場所: `src/lib/localStore.ts:97-105`、`src/lib/sheets.ts:190-198`。

姓と名を個別に部分一致判定するため、「田中」「太郎」の顧客を「田中太郎」で検索できない。カナでも同様。既存一覧の姓名連結検索と動きが一致しない。

**修正:** 姓名・カナの連結値も検索対象へ加え、両ストアの検索・空白正規化を共通化する。
**確認:** フルネーム、姓のみ、カナ、メールの結果が両ストアで一致すること。

### R10 / P2 — 保存途中の失敗後、再送しても処理が完了しない

対象: #40 / #41。
場所: #40 `src/app/api/public/questionnaires/route.ts:74`、#41 同ファイル:47-48。

問診追加後に予約更新や顧客保存が失敗すると500になる。次の送信は問診があるだけで200 alreadySubmittedを返すため、未完了の紐付け・顧客保存を再試行しない。利用者には完了を表示しながら、予約が未提出のまま残り得る。

**修正:** 完了段階を記録して不足処理を冪等に再開し、すべての関連保存完了を確認して成功を返す。
**確認:** 各書き込みで一度だけ失敗させて再送し、紐付け・顧客保存が完了し、来店回数も重複加算されないこと。

### R11 / P2 — 写真利用に同意しないと問診を提出できない

対象: #41。
場所: `src/lib/questionnaireValidation.ts:84`。

agreePhoto=falseも必須同意違反にする。詳細設計SC-05の写真利用「可／不可」、既存の任意同意と矛盾し、写真を許可しない客が400になる。

**修正:** リスク・医療同意はtrue必須、写真利用はbooleanとして検証する。#44 / #48と契約を揃える。
**確認:** 写真true/falseの両方で提出でき、欠落・不正型は拒否すること。

### R12 / P2 — 初めての参加者に最終ダイブ年月を要求する

対象: #41。
場所: `src/lib/questionnaireValidation.ts:66-67`。

全員にYYYY-MMの最終ダイブ年月を必須とするため、未経験者が正しい情報で提出できない。画面にも初回選択がなく、詳細設計SC-05の「初めて」と一致しない。

**修正:** 初回の区分を扱うか、未経験者は年月必須の対象外にする。#48のlastDivePeriodと統一する。
**確認:** Cカードなし・総本数0・初回の正常提出を確認する。

### R13 / P2 — CSVへ利用者入力の数式が入り込む

対象: #39。
場所: `src/app/roster/page.tsx:15`。

CSVは引用符だけをエスケープする。住所などに「=1+1」を入力した問診を名簿に載せて出力すると、Excelで数式として解釈される。CSVの引用符は数式を無効化しない。

**修正:** 数式開始文字や先頭制御文字を持つ文字列を、安全な文字列セルとして扱う出力処理を追加する。
**確認:** 氏名・住所・連絡先の式開始文字を含むCSVを表計算アプリで開き、式として評価されないこと。

### R14 / P2 — QRトークンの手入力検索が一致しない

対象: #34。#39にも継承。
場所: `src/app/questionnaire/scan/page.tsx:84`。

入力欄はQRトークンも案内するが、manualSearchは姓名・カナ・電話しか検索しない。カメラが使えずトークンを貼り付けた場合に回答が見つからず、旧問診IDによる手入力も失われる。

**修正:** qrTokenまたは問診IDの完全一致で照合してから、姓名・電話検索へ進む。
**確認:** カメラなしで当日の有効トークン・問診IDを貼り付けて表示できること。

### R15 / P2 — 提供されていない当日の最低気温を表示する

対象: #31 / #37。
場所: #31 `src/lib/weather.ts:74-75`、#37 同ファイル:71-72。

気象庁のtempsを日別に集めて最大・最小を取るが、これは観測時系列ではなく予報要素。当日分に最高気温が重複して入る場合、最低気温まで同じ値にしてしまう。#37のテストも当日の最高34・最低34を期待し、この誤りを固定する。

**修正:** 発表時刻と予報要素を区別し、提供されない最低気温は欠測表示とする。明示的なtempsMin/tempsMaxがある日にはそれを利用する。
**確認:** 朝・昼・夕の応答を使い、最高のみの日の最低が「－」となること。
一次資料: [気象庁予報データ](https://www.jma.go.jp/bosai/forecast/data/forecast/471000.json)、[予報の説明](https://www.data.jma.go.jp/yoho/kensho/tenki.pdf)、[表示例](https://www.jma.go.jp/jma/press/2501/08b/20250108_1.pdf)。担当レビュー時の2026-10-06朝の応答では当日の2値が28・28。実API内容は後日変化する。

## 単体の指摘と分けて対応する統合項目

| ID | 対象 | 必要な調整 |
|---|---|---|
| I01 | #29 / #35 / #36 / #37 | #29と#35の予約実装は重複。後続が乗る#35側など一方を選び、二重取り込みを避ける。 |
| I02 | #34 / #41 / #43 / #48 | 問診列の単一定義と移行を作る。#43のAL〜AOは郵便番号等、#48のAL〜ANは睡眠区分等で、同じ列が別の意味。単なる競合行の結合では既存データを守れない。 |
| I03 | #38 / #40 / #41 / #43 / #44 / #48 | 入力資格のbody.token / accessToken / reservationIdを統一する。入力URL用トークンと受付qrTokenを区別し、発行・期限・無効化・閲覧を共通化する。 |
| I04 | #29 / #35 / #38 / #40 / #41 | questionnaireExpiresAtとquestionnaireTokenExpiresAtを統一。#40 / #41の新規発行にも期限を保存する。#40の旧行更新では旧ヘッダー選択により追加トークンが保存されないため、旧行も移行する。 |
| I05 | #41 / #43 / #48 | 睡眠のnull、初回ダイブ、総本数null、conditionDetail/conditionDetails、gender=unansweredのフォーム・検証契約を統一する。 |
| I06 | #34 / #43 / #48 | 本人申告のmedicalCertificateとスタッフ確認のdoctorClearanceを区別する。受付画面にも追加された健康・体調情報を表示する。 |
| I07 | #32 / #46 | patchCustomerの結果オブジェクトに対するstatus分岐を保持し、通信例外のcatch/finallyを取り込む。awaitだけではHTTPエラーを成功表示する組み合わせになる。 |
| I08 | #36 / #37 | 実画面の予約更新にexpectedUpdatedAtを渡し、409表示と再取得につなぐ。APIの任意チェックだけでは現在の画面操作は保護されない。照合と書込の排他も検討する。 |
| I09 | #31 / #37 | 海況実装を一つにまとめ、#31のエラー全文表示・予約一覧への表示を失わないようにする。 |

## 修正・取り込み順の提案

1. **先にデータ形式・ID・公開トークンを決める。** R01〜R06とI02〜I05を優先し、SheetsとローカルJSONの両方へ反映する。
2. 予約系は **#35（#29と選択）→ #36 → #37**。後続はmain向けでも先行変更を含むため、順次差分を整理する。海況は#31と統合する。
3. 顧客系は **#32 → #33 → #42 / #47**。#46の例外処理もI07に従って統合する。
4. 問診系は共通契約を確定後、**#43、#44 → #48、#38、#40、#41**をその契約へ合わせる。これは現ブランチをそのまま順番にマージすればよいという意味ではない。
5. 受付は **#34 → #39**。問診の追加項目と列移行を反映してから取り込む。
6. #28・#30は確認範囲内で指摘なし。上記機能群とは別に取り込める候補だが、統合後の再確認は必要。
7. 各段階で現在のbaseに対する競合を再計算し、修正項目の確認方法と公開予約→問診→受付→顧客反映の一連の流れを検証する。

## 確認範囲と限界

- 全20件の差分・HEADスナップショット・関連呼出箇所、CLAUDE.mdと関連設計資料を確認した。作業ツリーの未コミット変更はレビュー対象に混ぜていない。
- 一時的なbareリポジトリでmerge-treeを使用し、実際のマージ・リベース・ブランチ変更は行っていない。190組は固定HEAD同士の組み合わせであり、20件を順次マージした最終結果の検証ではない。
- テスト・ビルド・ブラウザ動作・実Sheetsへの読み書きは実行していない。GitHubのstatusCheckRollupは20件とも空で、CI合格を確認できない。PR本文のテスト記載は今回の実行結果に含めない。
- コード修正、GitHubへのコメント・レビュー送信、公開・マージは行っていない。このレポートと比較一覧のみ作成した。
- 「指摘なし」は確認範囲で新たな具体的不具合が見つからなかった意味であり、不具合がない保証ではない。
- 再確認時、20件のHEAD・base名とmainのSHAに変更なし。main: `3cb4feb085547e28eda9a2ff0395dc8bb333eabf`。正確な各取り込み先SHAは参照一覧CSVを参照。


## 全20件の確認結果

| PR | タイトル | 確認したHEAD | 結果 |
|---|---|---|---|
| [#28](https://github.com/IIINATSUIII/project-umibudou/pull/28) | docs: Firebase Authentication前提の記述を独自JWT認証に修正 | [40468ec](https://github.com/IIINATSUIII/project-umibudou/tree/40468ec5d5d94fbe267850e3a285978249203cbe) | 指摘なし |
| [#29](https://github.com/IIINATSUIII/project-umibudou/pull/29) | [reservations] 予約データ（Reservationsシート）のスキーマ定義・データアクセス実装 | [747ed35](https://github.com/IIINATSUIII/project-umibudou/tree/747ed35898efcf8af3ff7e77448429a63f873d21) | R01・R02（#35と実装重複） |
| [#30](https://github.com/IIINATSUIII/project-umibudou/pull/30) | 顧客一覧に最終来店日・Cカード種別の絞り込みを追加 (SC-07, #22) | [8286063](https://github.com/IIINATSUIII/project-umibudou/tree/8286063d850bb380132eb63f8211f8c5c1d543c2) | 指摘なし |
| [#31](https://github.com/IIINATSUIII/project-umibudou/pull/31) | feat: 海況表示機能（気温取得・SC-02/SC-03組み込み） (#8, #9) | [dd7600f](https://github.com/IIINATSUIII/project-umibudou/tree/dd7600f5c6e63d54c1be69fb3a74779ceabddc29) | R15 |
| [#32](https://github.com/IIINATSUIII/project-umibudou/pull/32) | feat: 顧客情報編集の実装（#25） | [3a787fb](https://github.com/IIINATSUIII/project-umibudou/tree/3a787fb9b168a2d42525fddb826fd5d6a465a671) | R07・R08 |
| [#33](https://github.com/IIINATSUIII/project-umibudou/pull/33) | feat: 問診送信時の顧客自動登録を実装（#24） | [c1447e9](https://github.com/IIINATSUIII/project-umibudou/tree/c1447e90011d9995f1b1bb142ade27ba5a009cd6) | R03、継承R07・R08 |
| [#34](https://github.com/IIINATSUIII/project-umibudou/pull/34) | [questionnaire] QRコード読取・問診表示（SC-06）の実装 | [3d65bd2](https://github.com/IIINATSUIII/project-umibudou/tree/3d65bd221d8cd554bcb9dd63d543f6ee1ce56c99) | R04・R14 |
| [#35](https://github.com/IIINATSUIII/project-umibudou/pull/35) | 予約（Reservations）のスキーマを基本設計書§3-2準拠に再定義 | [6200663](https://github.com/IIINATSUIII/project-umibudou/tree/620066377b0464dce496dd2f91873172c0d34e5d) | R01・R02 |
| [#36](https://github.com/IIINATSUIII/project-umibudou/pull/36) | feat: 予約登録API(採番・サーバーサイド検証)の実装 (#7) | [c7847a1](https://github.com/IIINATSUIII/project-umibudou/tree/c7847a196159dc4955c5645c500a1a8c75ba801a) | 継承R01・R02。画面連携はI08 |
| [#37](https://github.com/IIINATSUIII/project-umibudou/pull/37) | test: 予約API・バリデーション・後勝ち検知・海況フォールバックの単体テスト (#10) | [865bac4](https://github.com/IIINATSUIII/project-umibudou/tree/865bac4baff9f38a9bb041c7987d268d5fb0a179) | R15、継承R01・R02。I08・I09 |
| [#38](https://github.com/IIINATSUIII/project-umibudou/pull/38) | feat: 問診票URL発行・ランダムトークン生成を実装 | [dedf868](https://github.com/IIINATSUIII/project-umibudou/tree/dedf8684d8b9f5fa3f19cab6aee0481b9faef71e) | R05 |
| [#39](https://github.com/IIINATSUIII/project-umibudou/pull/39) | feat: 名簿エクスポート画面(SC-09)の実装 (#19) | [849c642](https://github.com/IIINATSUIII/project-umibudou/tree/849c642540c51e1afe7c4e6b7087e7db19126a3f) | R13、継承R04・R14 |
| [#40](https://github.com/IIINATSUIII/project-umibudou/pull/40) | Codex/issue 17 qr display | [85637bf](https://github.com/IIINATSUIII/project-umibudou/tree/85637bff420b6fbbd1a1a7780658fb8eecca35c5) | R06・R10 |
| [#41](https://github.com/IIINATSUIII/project-umibudou/pull/41) | [questionnaire] 問診回答保存API（サーバーサイド検証）の実装  #16 | [b785872](https://github.com/IIINATSUIII/project-umibudou/tree/b7858729deacb9068efd1c208bbae98f412a3da4) | R10・R11・R12 |
| [#42](https://github.com/IIINATSUIII/project-umibudou/pull/42) | test: 顧客台帳の自動登録・編集バリデーションの単体テスト (#27) | [2ae35c5](https://github.com/IIINATSUIII/project-umibudou/tree/2ae35c5244d814eb3a3fcabbdccacb0c628b688c) | 差分内は指摘なし。継承R03・R07・R08 |
| [#43](https://github.com/IIINATSUIII/project-umibudou/pull/43) | feat: 問診票の基本情報・健康状態フォームを実装 (#13) | [1798cd2](https://github.com/IIINATSUIII/project-umibudou/tree/1798cd21f15724dc9a9a564f3eb33278843d64b7) | 単体指摘なし。I02・I05・I06 |
| [#44](https://github.com/IIINATSUIII/project-umibudou/pull/44) | feat: 問診票の必須同意と送信エラー処理を実装 (#15) | [eead9bd](https://github.com/IIINATSUIII/project-umibudou/tree/eead9bd1ff18c55b131eb7fb06e7b665f8b31de0) | 単体指摘なし。I03 |
| [#46](https://github.com/IIINATSUIII/project-umibudou/pull/46) | fix: ガイドメモ保存結果を表示する (#26) | [7f1386c](https://github.com/IIINATSUIII/project-umibudou/tree/7f1386c6d3da25030e49bcb635bd06494faf287c) | 単体指摘なし。I07 |
| [#47](https://github.com/IIINATSUIII/project-umibudou/pull/47) | fix: 顧客台帳の不足列と検索APIを補完する (#21) | [d8b3ada](https://github.com/IIINATSUIII/project-umibudou/tree/d8b3ada95d788932e44df808dd810d3dd9e4966c) | R09、継承R03・R07・R08 |
| [#48](https://github.com/IIINATSUIII/project-umibudou/pull/48) | feat: 問診票の当日体調・フライト・経験の必須制御を実装 (#14) | [61e74c9](https://github.com/IIINATSUIII/project-umibudou/tree/61e74c910268b896561cdcbdf87d54bfc26e105b) | 差分内は指摘なし。I02・I03・I05・I06 |

参照一覧: [取り込み先とHEADの固定SHA](2026-10-06-pr-refs.csv)。競合一覧: [全190組の判定と競合ファイル](2026-10-06-pr-pairs.csv)。

## 指摘箇所への固定リンク

- [R01 / #35 / src/lib/sheets.ts:32](https://github.com/IIINATSUIII/project-umibudou/blob/620066377b0464dce496dd2f91873172c0d34e5d/src/lib/sheets.ts#L32)
- [R02 / #35 / src/lib/reservations.ts:18](https://github.com/IIINATSUIII/project-umibudou/blob/620066377b0464dce496dd2f91873172c0d34e5d/src/lib/reservations.ts#L18)
- [R03 / #33 / src/lib/customerRegistration.ts:238](https://github.com/IIINATSUIII/project-umibudou/blob/c1447e90011d9995f1b1bb142ade27ba5a009cd6/src/lib/customerRegistration.ts#L238)
- [R04 / #34 / src/lib/sheets.ts:36](https://github.com/IIINATSUIII/project-umibudou/blob/3d65bd221d8cd554bcb9dd63d543f6ee1ce56c99/src/lib/sheets.ts#L36)
- [R05 / #38 / src/app/questionnaire/[id]/layout.tsx:15](https://github.com/IIINATSUIII/project-umibudou/blob/dedf8684d8b9f5fa3f19cab6aee0481b9faef71e/src/app/questionnaire/%5Bid%5D/layout.tsx#L15)
- [R06 / #40 / src/app/api/public/questionnaires/route.ts:24](https://github.com/IIINATSUIII/project-umibudou/blob/85637bff420b6fbbd1a1a7780658fb8eecca35c5/src/app/api/public/questionnaires/route.ts#L24)
- [R07 / #32 / src/app/customers/[id]/page.tsx:45](https://github.com/IIINATSUIII/project-umibudou/blob/3a787fb9b168a2d42525fddb826fd5d6a465a671/src/app/customers/%5Bid%5D/page.tsx#L45)
- [R08 / #32 / src/app/customers/[id]/page.tsx:145](https://github.com/IIINATSUIII/project-umibudou/blob/3a787fb9b168a2d42525fddb826fd5d6a465a671/src/app/customers/%5Bid%5D/page.tsx#L145)
- [R09 / #47 / src/lib/localStore.ts:97](https://github.com/IIINATSUIII/project-umibudou/blob/d8b3ada95d788932e44df808dd810d3dd9e4966c/src/lib/localStore.ts#L97)
- [R10 / #40 / src/app/api/public/questionnaires/route.ts:74](https://github.com/IIINATSUIII/project-umibudou/blob/85637bff420b6fbbd1a1a7780658fb8eecca35c5/src/app/api/public/questionnaires/route.ts#L74)
- [R11 / #41 / src/lib/questionnaireValidation.ts:84](https://github.com/IIINATSUIII/project-umibudou/blob/b7858729deacb9068efd1c208bbae98f412a3da4/src/lib/questionnaireValidation.ts#L84)
- [R12 / #41 / src/lib/questionnaireValidation.ts:66](https://github.com/IIINATSUIII/project-umibudou/blob/b7858729deacb9068efd1c208bbae98f412a3da4/src/lib/questionnaireValidation.ts#L66)
- [R13 / #39 / src/app/roster/page.tsx:15](https://github.com/IIINATSUIII/project-umibudou/blob/849c642540c51e1afe7c4e6b7087e7db19126a3f/src/app/roster/page.tsx#L15)
- [R14 / #34 / src/app/questionnaire/scan/page.tsx:84](https://github.com/IIINATSUIII/project-umibudou/blob/3d65bd221d8cd554bcb9dd63d543f6ee1ce56c99/src/app/questionnaire/scan/page.tsx#L84)
- [R15 / #31 / src/lib/weather.ts:74](https://github.com/IIINATSUIII/project-umibudou/blob/dd7600f5c6e63d54c1be69fb3a74779ceabddc29/src/lib/weather.ts#L74)
