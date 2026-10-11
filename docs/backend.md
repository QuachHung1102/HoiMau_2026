# Backend

Backend nằm trong `server/`: Node 24 chạy TypeScript trực tiếp (không build), driver `pg`, không ORM, không framework web. Dữ liệu ở PostgreSQL và **cơ sở dữ liệu tự bảo vệ mình**: ranh giới an ninh nằm ở vai trò, GRANT, Row-Level Security và hàm `SECURITY DEFINER`, không nằm ở code ứng dụng. Một route quên lọc theo người dùng thì truy vấn trả về 0 dòng chứ không rò dữ liệu.

`server/` là một gói npm riêng (`package.json`, lockfile và `node_modules` riêng) để `pg` và PostgreSQL nhúng không lẫn vào bản cài của app React Native. Logic nghiệp vụ thuần dùng chung với app nằm ở `domain/` và được import bằng đường dẫn tương đối có đuôi `.ts`.

Tài liệu này mô tả phần đã có trong repo. Mỗi nhiệm vụ thêm SQL sẽ bổ sung mục của mình ở cuối.

## Cài đặt và lệnh

Chạy từ thư mục gốc của repo:

```sh
npm run server:install     # npm ci trong server/ (tải cả bộ nhị phân PostgreSQL 18)
npm run server:typecheck   # tsc --noEmit theo server/tsconfig.json
npm run server:test        # test của server trên PostgreSQL thật
npm run db:verify          # cổng 1: lược đồ tự kiểm
npm run db:cleanup         # dọn PostgreSQL của dự án bị bỏ lại (đọc mục "Khôi phục" trước khi chạy)
```

Không cần cài PostgreSQL, không cần Docker. Lần chạy test đầu tiên tạo cụm cơ sở dữ liệu (`initdb`) trong `server/.pgdata/`; các lần sau dùng lại thư mục đó.

Các lệnh `db:api-check`, `db:mutation-check`, `server:dev`, `server:perf`, `content:count` đã khai báo trong `server/package.json` nhưng tệp của chúng đến ở các nhiệm vụ sau; trước lúc đó chúng báo lỗi không tìm thấy tệp.

## Hai cụm PostgreSQL của dự án

| Dùng cho | Cổng | Thư mục dữ liệu | Ai khởi động |
|---|---|---|---|
| Test và các cổng kiểm | 54329 | `server/.pgdata/` | `server/test/global.ts`, tự động trước mỗi lượt chạy |
| Phát triển | 54330 | `server/.pgdata-dev/` | script dev (nhiệm vụ sau) |

- **Không bao giờ chạm vào PostgreSQL hệ thống.** Máy phát triển có dịch vụ `postgresql-x64-18` chiếm cổng 5432. Dự án không kết nối, không dừng, không cấu hình lại nó và không dùng cổng 5432. Tiến trình của dịch vụ đó cũng tên `postgres.exe`, nên **không bao giờ diệt tiến trình theo tên**.
- Cụm được tạo với `--encoding=UTF8 --locale=C --locale-provider=icu --icu-locale=vi` và xác thực `scram-sha-256`. Thiếu `UTF8` thì Windows dùng WIN1252 và không lưu được tiếng Việt; thiếu ICU thì `upper('hồi máu')` và `ILIKE` sai với chữ có dấu. PostgreSQL production phải được tạo cùng cách.
- Đường dẫn thư mục dữ liệu chỉ được chứa ký tự ASCII (`initdb` hỏng với đường dẫn có dấu). Cả hai thư mục đã được Git bỏ qua. Xóa `server/.pgdata/` là an toàn khi không có lượt chạy nào: lần chạy sau tạo lại.
- Mật khẩu `pg_super_dev` (superuser `postgres`) và `app_conn_dev` (`app_conn`) trong `server/scripts/cluster.ts` chỉ dành cho máy phát triển. Tiến trình server chỉ đọc `DATABASE_URL` với vai trò `app_conn` (xem `server/.env.example`); thông tin superuser chỉ tồn tại trong bộ test, `scripts/` và `checks/`.

### Một cụm test, mỗi lúc một lượt chạy

`server:test` và mọi lệnh `db:*` dùng chung một cụm test (một thư mục dữ liệu, một cổng). Mỗi lúc chỉ chạy được **một** lệnh trong số đó trên một máy. Lệnh thứ hai dừng ngay với thông báo nêu rõ thứ nó tìm thấy:

```text
This project's PostgreSQL is already running on port 54329 (data directory …\server\.pgdata, PIDs …).
If another server test run is in flight, wait for it to finish.
If it is the leftover of a killed run, stop it with: npm run db:cleanup
```

Gặp thông báo này thì trước hết kiểm tra có lượt chạy nào khác đang diễn ra không (terminal khác, agent khác). Nếu có: chờ nó xong.

### Khôi phục sau một lượt chạy bị diệt

Lượt chạy kết thúc bình thường (kể cả khi test đỏ) tự dừng cụm. Lượt chạy bị diệt cưỡng bức (đóng terminal, `taskkill`, hết thời gian chờ của công cụ) có thể để lại `postgres.exe` giữ cổng và thư mục dữ liệu; lượt chạy sau sẽ báo "already running" như trên, hoặc `pre-existing shared memory block is still in use`.

```sh
npm run db:cleanup
```

- **Chỉ chạy khi không còn lượt test nào của server đang diễn ra.** Lệnh này không phân biệt được cụm bị bỏ lại với cụm của một lượt chạy đang hoạt động; chạy nhầm lúc là diệt lượt chạy của người khác.
- Lệnh chỉ tác động lên PostgreSQL của chính dự án: đọc PID trong `server/.pgdata*/postmaster.pid`, rồi chỉ diệt khi dòng lệnh của tiến trình đó cho thấy nó là `postgres` chạy từ `server/node_modules` trên đúng thư mục dữ liệu và đúng cổng, cùng các tiến trình con của nó. PID trong tệp có thể đã cũ và bị một tiến trình khác dùng lại, nên tệp pid không bao giờ là căn cứ duy nhất. Dịch vụ hệ thống ở cổng 5432 không bao giờ khớp điều kiện.
- In ra từng PID đã diệt, hoặc `nothing running`. Mã thoát 0 trong cả hai trường hợp.
- Việc nhận diện tiến trình mới được kiểm chứng trên Windows (qua PowerShell). Trên macOS/Linux mã dùng `ps` nhưng chưa được chạy thử.

## Mô hình vai trò

| Vai trò | Đăng nhập | Dùng cho |
|---|---|---|
| `app_conn` | có, `NOINHERIT` | Chuỗi kết nối của ứng dụng. Không sở hữu gì, không có quyền gì, kể cả `USAGE` trên schema `public`. |
| `app_anon` | không | Request chưa đăng nhập. |
| `app_auth` | không | Request đã đăng nhập. |
| `app_job` | không | Job định kỳ. |

`app_conn` là thành viên của ba vai trò kia với `INHERIT FALSE, SET TRUE`: nối vào xong nó vẫn trắng tay, và chỉ có thể *chuyển vai* trong một transaction:

```sql
BEGIN;
SET LOCAL ROLE app_auth;                       -- hoặc app_anon, app_job
SELECT set_config('app.user_id', $1, true);    -- true = chỉ trong transaction này
-- … truy vấn …
COMMIT;                                         -- vai trò và user id tự hết hiệu lực
```

- Quên mở transaction thì truy vấn chạy dưới `app_conn` và hỏng ngay: `permission denied for schema …` nếu ghi rõ schema, `relation … does not exist` nếu không. Hỏng đóng, không âm thầm chạy với quyền rộng hơn.
- `SET LOCAL` không rò sang request sau dùng chung kết nối trong pool (có test).
- `SET ROLE` nhận một định danh, không tham số hóa được: tên vai trò chỉ đến từ hằng số trong code.
- Không vai trò `app_*` nào là superuser, `BYPASSRLS` hay chủ sở hữu bảng. RLS không áp dụng cho superuser và chủ bảng; nối ứng dụng bằng `postgres` là mọi policy ngừng tác dụng trong im lặng.
- Từ PostgreSQL 16, thừa kế là thuộc tính của **từng quan hệ thành viên** chứ không chỉ của `NOINHERIT` trên vai trò. `90-verify.sql` kiểm cả hai.
- Hàm mặc định cho `PUBLIC` quyền `EXECUTE`. `00-roles.sql` gỡ mặc định đó (`ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`) cho các hàm do vai trò chạy migration tạo ra; mỗi hàm phải cấp `EXECUTE` tường minh cho đúng vai trò.

## Lược đồ là các file SQL

Lược đồ nằm ở `server/sql/NN-*.sql`. Không có migration của ORM, không có file "theo ngày": một mối quan tâm một file, và **mọi file chạy lặp lại được** (`CREATE … IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` rồi tạo lại).

| File | Nội dung |
|---|---|
| `00-roles.sql` | Bốn vai trò, quan hệ thành viên, quyền trên schema `public`, mặc định `EXECUTE`. |
| `01-app-context.sql` | Schema `app`: các hàm dùng trong policy, giá trị mặc định và hàm nghiệp vụ. |
| `02-meta.sql` | Schema `meta`: đồng hồ test và sổ đăng ký kiểm chứng. |
| `10`–`79` | Bảng và hàm theo từng mảng nghiệp vụ (các nhiệm vụ sau). |
| `80`–`89` | Dòng mồi nhử (xem "Thêm một file SQL"). |
| `90-verify.sql` | Lược đồ tự kiểm. |

### Thứ tự áp dụng

`migrate(client, sqlDir)` trong `server/src/migrate.ts` chạy bằng superuser (chủ sở hữu lược đồ), mỗi bước một transaction:

1. các file `NN-*.sql` có số **nhỏ hơn 80**, theo thứ tự tên;
2. mọi seeder trong `server/src/seed/*.ts` (`export async function seed(db)`), theo thứ tự tên; thư mục chưa có hoặc rỗng thì bỏ qua;
3. các file còn lại: `8N-*.sql` rồi `90-verify.sql`.

Seeder chạy ở giữa vì dòng mồi nhử tham chiếu nội dung do seeder tạo ra (vật phẩm, bài tập, món ăn…); và `90-verify.sql` chạy cuối nên **mọi lần migrate đều kết thúc bằng phép tự kiểm**. Một bước hỏng thì transaction của bước đó được hoàn lại và lỗi nêu tên file. Bộ test dựng cơ sở dữ liệu mẫu bằng chính hàm này.

### Schema `app`

| Hàm | Ý nghĩa |
|---|---|
| `app.current_user_id()` | Người dùng của request hiện tại (`app.user_id`), `NULL` khi chưa đăng nhập. |
| `app.now()` | **Đồng hồ duy nhất SQL được đọc.** Trả về dòng trong `meta.test_clock` nếu có, ngược lại `now()`. |
| `app.logical_date(timestamptz, text)` | Nhãn ngày logic theo múi giờ: ngày bắt đầu lúc 03:00 giờ địa phương. Khớp với `logicalDateOf` của `domain/` (có test đối chiếu). |
| `app.week_start(date)` | Thứ Hai của tuần chứa ngày đó. Khớp với `weekStartOf`. |

Ba vai trò `app_anon`, `app_auth`, `app_job` gọi được bốn hàm này. Hàm trong `app` có tên bắt đầu bằng `_` là hàm nội bộ: không vai trò `app_*` nào được cấp `EXECUTE`.

SQL không gọi `now()` trực tiếp mà gọi `app.now()`, nhờ đó test dời được thời gian (`setTestClock`). Bảng `meta.test_clock` chỉ chủ sở hữu ghi được, và `90-verify.sql` báo lỗi khi bảng có dòng: đồng hồ test không bao giờ được tồn tại ngoài một lượt test.

### Sổ đăng ký `meta` và các lớp truy cập

Mỗi file SQL **khai báo** điều nó mong đợi ở bảng, policy và hàm của mình; `90-verify.sql` đối chiếu khai báo với catalog. Nhờ vậy các file nghiệp vụ không bao giờ phải sửa `90-verify.sql`.

```sql
SELECT meta.expect_table('users', 'own_rw', '{SELECT}', '{display_name,timezone}', 'id');
SELECT meta.expect_policy('users', 'own_select', 'SELECT', '(app.current_user_id() = id)', NULL);
SELECT meta.expect_function('auth_login(text, bytea, bytea)', '{app_anon}');
```

| Lớp | RLS | `app_auth` có | Ai ghi dòng | `owner_column` |
|---|---|---|---|---|
| `own_read` | bật | chỉ `SELECT` | chỉ hàm `SECURITY DEFINER` | bắt buộc |
| `own_rw` | bật | đúng các quyền đã đăng ký, và `UPDATE` trên đúng các cột đã đăng ký | chính chủ dòng, qua policy | bắt buộc |
| `internal` | bật, không policy | không gì cả | chỉ hàm `SECURITY DEFINER` | `NULL` |
| `content` | không cần | chỉ `SELECT` | chủ sở hữu lược đồ (seeder) | `NULL` |

- `expect_table(tên, lớp, quyền mức bảng của app_auth, các cột được UPDATE, owner_column)`. `owner_column` là cột chứa id người sở hữu dòng (`user_id`, hoặc `id` với bảng `users`). Khai báo trái với lớp (ví dụ `own_read` kèm `INSERT`) bị từ chối ngay lúc đăng ký.
- `expect_policy(bảng, policy, lệnh, using, check)`. Hai biểu thức phải là **đúng nguyên văn** chuỗi `pg_get_expr` in ra, ví dụ `(app.current_user_id() = user_id)`; không dùng thì truyền `NULL`. So khớp bằng `=`, không bao giờ bằng `LIKE`: `USING (owner() OR true)` vẫn *chứa* `owner()` mà mở toang cửa.
- `expect_function(chữ ký, vai trò)`. Chữ ký viết như trong `GRANT EXECUTE ON FUNCTION`; hàm phải tồn tại lúc đăng ký. `vai trò` là đúng tập được `EXECUTE` trong số `app_anon`, `app_auth`, `app_job`, `app_conn` và `PUBLIC`.
- `02-meta.sql` xóa sạch sổ đăng ký ở đầu mỗi lần migrate rồi các file sau đăng ký lại: sổ luôn là đúng những gì các file hiện tại khai báo, không sót dòng của thứ đã bị đổi tên hay gỡ bỏ. Vì vậy luôn migrate trọn bộ; chạy riêng lẻ `02-meta.sql` làm trống sổ.
- Extension có hàm (ví dụ `pgcrypto`) không được cài vào `public`: mọi hàm trong `public` đều phải đăng ký.

## Ba cổng kiểm

Mỗi cổng mù ở chỗ cổng khác nhìn thấy.

| Cổng | Lệnh | Chạy bằng | Chứng minh |
|---|---|---|---|
| 1. Lược đồ tự kiểm | `npm run db:verify` | superuser | Catalog đúng thiết kế: vai trò, quyền, RLS, policy, hàm. |
| 2. API check | `npm run db:api-check` (nhiệm vụ sau) | đúng vai trò ứng dụng (`app_conn` rồi chuyển vai) | Một request thật làm được gì: đi đúng đường của kẻ tấn công, trên cơ sở dữ liệu có dòng của "người khác" để tìm. |
| 3. Mutation check | `npm run db:mutation-check` (nhiệm vụ sau) | superuser | Cổng 1 có *biết kêu* không: phá từng hàng rào một và đòi cổng 1 phải báo lỗi nêu đúng tên thứ bị phá. |

Cổng 1 không biết một request thật làm được gì; cổng 2 không biết thiết kế định nói gì; cả hai đều không biết phép kiểm của chính mình còn sống hay đã mục. Một file tự kiểm luôn xanh và một file tự kiểm đã mục trông giống hệt nhau, và cổng 3 là thứ phân biệt chúng.

### Cổng 1 kiểm những gì

`90-verify.sql` ném exception nêu tên đối tượng cho từng vi phạm:

1. `app_conn` là `LOGIN NOINHERIT`; ba vai trò kia không đăng nhập được; không vai trò `app_*` nào là superuser, `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, `REPLICATION`; quan hệ thành viên của các vai trò `app_*` chỉ gồm `app_conn` trong ba vai trò kia với `INHERIT FALSE, SET TRUE`. Về schema: chỉ `app_anon`, `app_auth`, `app_job` có `USAGE` trên `public` và `app`; không ai có `CREATE`; `meta` đóng với tất cả.
2. Không bảng nào thuộc sở hữu của một vai trò `app_*`.
3. Mọi bảng (và view) trong `public` đều đã đăng ký; mọi bảng đã đăng ký đều tồn tại.
4. Theo lớp: RLS bật với `own_read`, `own_rw`, `internal`; quyền mức bảng của `app_auth` bằng đúng tập đã đăng ký; quyền `UPDATE` theo cột bằng đúng các cột đã đăng ký; không có quyền theo cột nào khác; `app_anon`, `app_conn`, `app_job` không có quyền trên bất kỳ bảng nào, ở bất kỳ schema nào của dự án; cột `owner_column` tồn tại.
5. Policy trên mỗi bảng là đúng các policy đã đăng ký: cùng lệnh, biểu thức `USING` và `WITH CHECK` bằng nguyên văn; bảng `internal` không có policy nào.
6. Mọi hàm `SECURITY DEFINER` đều có `SET search_path`.
7. Mọi hàm trong `public` đều đã đăng ký; tập vai trò có `EXECUTE` bằng đúng tập đã đăng ký; hàm đã đăng ký thì tồn tại.
8. Hàm `app._*` và mọi hàm trong `meta` không thực thi được bởi vai trò `app_*` nào hay `PUBLIC`.
9. `meta.test_clock` rỗng.

`server/checks/verify.test.ts` chạy ba việc trên lược đồ thật (áp dụng lại toàn bộ file SQL trên một cơ sở dữ liệu đã có lược đồ; chạy `90-verify.sql`; xác nhận nó báo lỗi khi `meta.test_clock` có dòng), rồi dựng một lược đồ mẫu có đủ bốn lớp và phá lần lượt từng hàng rào để chứng minh mỗi quy tắc trên đều phát hiện được vi phạm và nêu đúng tên. Cổng 3 lặp lại phép chứng minh đó trên toàn bộ bảng và hàm thật.

## Thêm một file SQL

1. Tạo `server/sql/NN-<mảng>.sql` với số nhỏ hơn 80, viết sao cho chạy lặp lại được. Mỗi file thuộc về một nhiệm vụ.
2. Bảng do superuser sở hữu. Bật RLS theo lớp, tạo policy, rồi `GRANT` đúng những gì lớp cho phép. Dùng GRANT theo cột khi client chỉ được sửa một phần (`GRANT UPDATE (cột) …`).
3. Việc đặc quyền là hàm `SECURITY DEFINER` có `SET search_path = public, pg_temp`, nhận *ý định* của người dùng chứ không nhận số tiền hay user id; id lấy từ `app.current_user_id()`. Hàm nhận user id tường minh đặt trong `app` với tên bắt đầu bằng `_` và không cấp `EXECUTE` cho ai. `SECURITY DEFINER` không chịu RLS: điều kiện policy đang lọc hộ phải viết lại trong thân hàm. Đọc thời gian bằng `app.now()`.
4. **Đăng ký** mọi bảng, policy và hàm bằng `meta.expect_*` ngay trong file đó. Hàm trong `public` mà không vai trò nào được gọi (hàm trigger chẳng hạn) vẫn phải đăng ký, với tập vai trò rỗng `'{}'`.
5. **Mồi nhử**: thêm `8N-decoy-<mảng>.sql` cho người dùng mồi nhử ít nhất một dòng trong mỗi bảng dữ liệu người dùng mới. Phép kiểm "A không đọc được dữ liệu của B" luôn đạt nếu B không có dòng nào để tìm. Dòng mồi nhử là vĩnh viễn và **không bao giờ được dọn**. File mồi nhử chạy sau seeder nên tham chiếu được nội dung đã seed.
6. **Ca tấn công**: thêm `server/checks/attacks/<mảng>.ts` cho cổng 2.
7. Test đi qua `app_conn` với chuyển vai thật (`asUser`, `asAnon`, `asJob`), không bao giờ qua kết nối của chủ sở hữu; kết nối đó chỉ để dựng dữ liệu và đọc lại kết quả.
8. Bổ sung một mục vào tài liệu này, và để `npm run db:verify` (cùng hai cổng còn lại khi đã có) xanh.

## Viết test cho server

Test chạy bằng `node:test`. `server/test/global.ts` chạy một lần cho mỗi lệnh: khởi động cụm test, dựng lại cơ sở dữ liệu mẫu `hm_template` bằng `migrate`, đặt mật khẩu dev cho `app_conn`; kết thúc thì dừng cụm.

```ts
import { after, before, test } from 'node:test';
import { asUser, expectPgError } from './helpers.ts';
import { createTestDb } from './testdb.ts';
import type { TestDb } from './testdb.ts';

let db: TestDb;
before(async () => {
  db = await createTestDb();   // một cơ sở dữ liệu riêng cho file test này, sao từ hm_template
});
after(() => db.drop());
```

- `db.admin` là pool superuser: chỉ để dựng dữ liệu và khẳng định kết quả. `db.app` là pool `app_conn`, đúng như ứng dụng kết nối.
- `asUser(db.app, userId, fn)`, `asAnon(db.app, fn)`, `asJob(db.app, fn)` mở transaction và chuyển vai như một request thật.
- `setTestClock(db.admin, iso | null)` đóng băng `app.now()` trong cơ sở dữ liệu của file test; truyền `null` để trả về thời gian thật. Luôn trả lại trong `finally`.
- `expectPgError(promise, { code, messagePrefix })` chỉ đạt khi lỗi có **đúng** SQLSTATE và message **bắt đầu** bằng chuỗi đã cho. "Có ném lỗi" không chứng minh gì: `42501` dùng chung cho cả thiếu GRANT (`permission denied for table …`) lẫn bị policy chặn (`new row violates row-level security policy …`), và một lỗi không liên quan (không tìm thấy, vi phạm khóa ngoại) phải làm test đỏ. Mỗi hàng rào khẳng định theo đúng cơ chế của chính nó.
- Trong một file, cô lập các test bằng người dùng ngẫu nhiên mới (`randomUUID()`), không bằng `ROLLBACK` bao ngoài: code được test tự `COMMIT`.
- Không test nào được đổi thuộc tính vai trò ngoài một transaction sẽ `ROLLBACK`: vai trò là của cả cụm, các file test chạy song song dùng chung. Cũng vì vậy chỉ các file trong `server/checks/` (mỗi file chạy một mình bằng lệnh `db:*` riêng) mới áp dụng lại toàn bộ lược đồ, trong đó có `00-roles.sql`.

## Điều cần biết về PostgreSQL nhúng

- Gói `embedded-postgres` cài một exit hook quyết định mã thoát của cả tiến trình: lượt test đỏ sẽ thoát với mã 0. `server/scripts/cluster.ts` gỡ hai handler gây ra việc đó (`beforeExit`, `exit`) và để nguyên các handler tín hiệu của gói; có test giữ mã thoát đúng. Việc Ctrl+C dừng được cụm chưa được kiểm chứng: nếu cụm còn lại sau khi ngắt, dùng `npm run db:cleanup`. Khi nâng phiên bản gói, chạy lại `npm run server:test` và kiểm tra một test cố ý đỏ vẫn cho mã thoát khác 0.
- Trên Windows gói dừng cụm bằng cách diệt cây tiến trình; postmaster có thể kịp sinh lại một tiến trình con trong lúc đó, và tiến trình sót lại giữ thư mục dữ liệu. Vì vậy sau khi dừng, `cluster.ts` quét và diệt nốt các tiến trình con của đúng postmaster đó.
- Phiên bản được ghim chính xác trong `server/package.json` (gói `embedded-postgres` luôn mang hậu tố `-beta`; đó là hậu tố của gói bọc, bộ nhị phân là PostgreSQL 18 gốc).
