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

Các lệnh `db:api-check` (từ Task 15), `db:mutation-check` (từ Task 16), `server:dev` và `server:perf` đã khai báo trong `server/package.json` nhưng **chưa tồn tại**: tệp của chúng đến ở các nhiệm vụ đó, trước lúc ấy lệnh báo lỗi không tìm thấy tệp.

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
| `app_conn` | có, `NOINHERIT` | Chuỗi kết nối của ứng dụng. Không sở hữu gì và không được cấp quyền nào trên schema, bảng hay hàm của dự án, kể cả `USAGE` trên `public`. Những gì nó vẫn làm được: xem mục dưới. |
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

- Quên mở transaction thì truy vấn chạy dưới `app_conn` và hỏng ngay. Vì `app_conn` không có `USAGE` trên `public`, thông báo không phải là "permission denied for table": tên **không ghi schema** cho `42P01 relation "…" does not exist` hoặc `42883 function … does not exist`; tên **có ghi schema** cho `42501 permission denied for schema public`. Thấy "does not exist" với một bảng chắc chắn có thì hãy nghĩ ngay tới một transaction bị quên. Hỏng đóng, không âm thầm chạy với quyền rộng hơn.
- `SET LOCAL` không rò sang request sau dùng chung kết nối trong pool (có test).
- `SET ROLE` nhận một định danh, không tham số hóa được: tên vai trò chỉ đến từ hằng số trong code.
- Không vai trò `app_*` nào là superuser, `BYPASSRLS` hay chủ sở hữu bảng. RLS không áp dụng cho superuser và chủ bảng; nối ứng dụng bằng `postgres` là mọi policy ngừng tác dụng trong im lặng.
- Từ PostgreSQL 16, thừa kế là thuộc tính của **từng quan hệ thành viên** chứ không chỉ của `NOINHERIT` trên vai trò. `90-verify.sql` kiểm cả hai.
- Helper `asUser` / `asAnon` / `asJob` (và code request thật sau này) **luôn** đặt `app.user_id` trong transaction, kể cả đặt về rỗng: một giá trị ai đó để lại ở mức phiên (`set_config(…, false)`) không bao giờ được trở thành danh tính của request.
- Hàm mặc định cho `PUBLIC` quyền `EXECUTE`. `00-roles.sql` gỡ mặc định đó (`ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`) cho các hàm do vai trò chạy migration tạo ra; mỗi hàm phải cấp `EXECUTE` tường minh cho đúng vai trò.

### `app_conn` trần vẫn làm được gì

"Không có quyền" nghĩa là không có quyền trên đối tượng của dự án, không phải là bất lực. Mọi vai trò đăng nhập được của PostgreSQL đều làm được những việc sau, và `app_conn` cũng vậy (đã chạy thử trên cụm test):

- tạo bảng tạm và chạy khối `DO`;
- đọc catalog: tên bảng, tên hàm và **mã nguồn hàm** (`pg_proc.prosrc`);
- thấy nguyên văn câu truy vấn đang chạy của các phiên khác cùng vai trò (`pg_stat_activity`), và hủy hoặc ngắt các phiên đó (`pg_cancel_backend`, `pg_terminate_backend`);
- kết nối vào cơ sở dữ liệu `postgres` và `template1` của cùng cụm;
- `SET ROLE` ở mức phiên sang ba vai trò kia (chính là cơ chế chuyển vai);
- tự đổi mật khẩu của mình, và tự lưu thiết lập cho mình: `ALTER ROLE app_conn SET role = 'app_job'` có hiệu lực ngay lúc đăng nhập, trước mọi dòng code của request.

Nó **không** làm được: đổi thuộc tính của chính nó (`SUPERUSER`, `BYPASSRLS`…), đổi vai trò khác, tạo đối tượng trong `public`, tạo schema.

Điều đó chấp nhận được vì mô hình vai trò chặn **code hay quên**, không chặn **SQL bị tiêm**. Ai chạy được SQL tùy ý dưới `app_conn` thì đã chuyển được sang `app_auth` và tự đặt `app.user_id`. Hệ quả bắt buộc cho mọi dòng code của server:

- **Không ghép SQL từ dữ liệu đầu vào ở bất kỳ đâu.** Mọi giá trị đi qua tham số (`$1`); định danh (tên vai trò, tên bảng) chỉ đến từ hằng số trong code.
- **Bí mật luôn là tham số, không bao giờ là hằng trong câu SQL**: mã băm token, khóa mật khẩu, mã đặt lại. Câu truy vấn hiện ra với các phiên cùng vai trò, giá trị tham số thì không.
- Thiết lập lưu cho vai trò hay cho cơ sở dữ liệu **không ngăn được, chỉ phát hiện được**: `90-verify.sql` báo lỗi khi `pg_db_role_setting` có dòng áp dụng cho một vai trò `app_*` trong cơ sở dữ liệu này. Việc `app_conn` tự đổi mật khẩu thì không có gì phát hiện: giữ chuỗi kết nối như một bí mật và đặt lại mật khẩu từ phía quản trị khi nghi ngờ.

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

Seeder chạy ở giữa vì dòng mồi nhử tham chiếu nội dung do seeder tạo ra (vật phẩm, bài tập, món ăn…); và `90-verify.sql` chạy cuối nên **mọi lần migrate đều kết thúc bằng phép tự kiểm**. Một bước hỏng thì transaction của bước đó được hoàn lại và lỗi nêu tên file (kể cả khi chính lệnh hoàn lại cũng hỏng). `migrate` từ chối chạy, trước khi áp dụng bất kỳ bước nào, nếu thư mục **không có** file `90-*.sql` hoặc có file SQL xếp sau nó: lược đồ không được tự kiểm ở cuối là lược đồ không ai kiểm. (Chỉ thư mục mẫu của test mới được bỏ qua bằng `{ withoutSelfCheck: true }`.) Bộ test dựng cơ sở dữ liệu mẫu bằng chính hàm này.

### Schema `app`

| Hàm | Ý nghĩa |
|---|---|
| `app.current_user_id()` | Người dùng của request hiện tại (`app.user_id`), `NULL` khi chưa đăng nhập. |
| `app.now()` | **Đồng hồ duy nhất SQL được đọc.** Trả về dòng trong `meta.test_clock` nếu có, ngược lại `now()`. |
| `app.logical_date(timestamptz, text)` | Nhãn ngày logic theo múi giờ: ngày bắt đầu lúc 03:00 giờ địa phương. Khớp với `logicalDateOf` của `domain/` (có test đối chiếu) **với tên múi giờ IANA dạng `Khu_vực/Thành_phố`**. Cách viết khác thì hai bên hiểu khác nhau: `'+07:00'` là UTC+7 với `Intl` nhưng là UTC−7 với PostgreSQL (dấu kiểu POSIX), còn `ICT` hay `UTC+7` chỉ PostgreSQL nhận. Cột lưu múi giờ của người dùng chỉ được chứa tên IANA mà cả hai bên đều biết. |
| `app.week_start(date)` | Thứ Hai của tuần chứa ngày đó. Khớp với `weekStartOf`. |

Ba vai trò `app_anon`, `app_auth`, `app_job` gọi được bốn hàm này, và chỉ ba vai trò đó. Hàm có tên bắt đầu bằng `_`, ở bất kỳ schema nào, là hàm nội bộ: không vai trò nào được cấp `EXECUTE`. Mọi hàm trong `app` đều phải đăng ký (xem dưới), kể cả hàm nội bộ.

SQL không gọi `now()` trực tiếp mà gọi `app.now()`, nhờ đó test dời được thời gian (`setTestClock`). Bảng `meta.test_clock` chỉ chủ sở hữu ghi được, và `90-verify.sql` báo lỗi khi bảng có dòng: đồng hồ test không bao giờ được tồn tại ngoài một lượt test.

### Sổ đăng ký `meta` và các lớp truy cập

Mỗi file SQL **khai báo** điều nó mong đợi ở bảng, policy và hàm của mình; `90-verify.sql` đối chiếu khai báo với catalog. Nhờ vậy các file nghiệp vụ không bao giờ phải sửa `90-verify.sql`.

```sql
SELECT meta.expect_table('users', 'own_rw', '{SELECT}', '{display_name,timezone}', 'id');
CREATE POLICY own_select ON users FOR SELECT TO app_auth USING (app.current_user_id() = id);
SELECT meta.expect_policy('users', 'own_select', 'SELECT', '(app.current_user_id() = id)', NULL);
SELECT meta.expect_function('auth_login(text, bytea, bytea)', '{app_anon}');
```

| Lớp | RLS | `app_auth` có | Ai ghi dòng | `owner_column` |
|---|---|---|---|---|
| `own_read` | bật | chỉ `SELECT` | chỉ hàm `SECURITY DEFINER` | bắt buộc |
| `own_rw` | bật | đúng các quyền đã đăng ký (chỉ trong `SELECT`, `INSERT`, `UPDATE`, `DELETE`), và `UPDATE` trên đúng các cột đã đăng ký | chính chủ dòng, qua policy | bắt buộc |
| `internal` | bật, không policy | không gì cả | chỉ hàm `SECURITY DEFINER` | `NULL` |
| `content` | không cần | chỉ `SELECT` | chủ sở hữu lược đồ (seeder) | `NULL` |

- `expect_table(tên, lớp, quyền mức bảng của app_auth, các cột được UPDATE, owner_column)`. `owner_column` là cột chứa id người sở hữu dòng (`user_id`, hoặc `id` với bảng `users`). Ba hàm `expect_*` chỉ ghi lại khai báo; chính `90-verify.sql` xét từng dòng của sổ, bất kể dòng đó được ghi bằng cách nào. Khai báo trái với lớp (ví dụ `own_read` kèm `INSERT`, `own_rw` kèm `TRUNCATE`, hay một lớp không tồn tại) làm cổng 1 đỏ ngay ở lần migrate đó, kể cả khi catalog "khớp" với khai báo. **Chỉ `app_auth` được cấp quyền trên bảng**: mọi quyền cấp cho bất kỳ vai trò nào khác, kể cả `PUBLIC` hay một vai trò ngoài bộ `app_*`, là vi phạm.
- `expect_policy(bảng, policy, lệnh, using, check)`. Hai biểu thức phải là **đúng nguyên văn** chuỗi `pg_get_expr` in ra, ví dụ `(app.current_user_id() = user_id)`; không dùng thì truyền `NULL`. Mọi policy phải là `PERMISSIVE` (mặc định) và viết **`TO app_auth`**: policy `RESTRICTIVE` hay policy cho vai trò khác (kể cả bỏ `TO`, tức `PUBLIC`) bị cổng 1 từ chối. So khớp bằng `=`, không bao giờ bằng `LIKE`: `USING (owner() OR true)` vẫn *chứa* `owner()` mà mở toang cửa.
- `expect_function(chữ ký, vai trò)`. Chữ ký viết như trong `GRANT EXECUTE ON FUNCTION`, kèm tên schema nếu hàm không ở `public` (`app.now()`); hàm phải tồn tại lúc đăng ký. `vai trò` là **đúng** tập được cấp `EXECUTE`, và chỉ được gồm `app_anon`, `app_auth`, `app_job` (đăng ký `PUBLIC`, `app_conn` hay vai trò khác bị từ chối). **Mọi hàm trong `public`, `app` và `meta` đều phải đăng ký.** Hàm nội bộ (tên bắt đầu bằng `_` ở bất kỳ schema nào, và mọi hàm trong `meta`) cùng hàm không ai được gọi (hàm trigger) đăng ký với tập rỗng `'{}'`; đăng ký một hàm nội bộ kèm vai trò bị từ chối.
- View chỉ được phép khi tạo `WITH (security_invoker = true)` (và phải đăng ký như bảng lớp `content`): view thường đọc bảng bằng quyền của chủ view nên đi vòng qua RLS. Materialized view và foreign table bị cấm hẳn. Sequence không được cấp cho vai trò nào.
- `02-meta.sql` xóa sạch sổ đăng ký ở đầu mỗi lần migrate rồi các file sau đăng ký lại: sổ luôn là đúng những gì các file hiện tại khai báo, không sót dòng của thứ đã bị đổi tên hay gỡ bỏ. Vì vậy luôn migrate trọn bộ; chạy riêng lẻ `02-meta.sql` làm trống sổ.
- **Không dùng extension có hàm** (ví dụ `pgcrypto`). Cổng 1 xét mọi schema không thuộc PostgreSQL, nên đặt extension vào schema riêng cũng không thoát: từng hàm của nó sẽ phải đăng ký và bị gỡ khỏi `PUBLIC`. Dùng hàm có sẵn của PostgreSQL: `sha256()`, `gen_random_uuid()`. Thật sự cần một extension thì đó là một thay đổi có chủ ý của `90-verify.sql`, kèm ca đột biến.

## Ba cổng kiểm

Mỗi cổng mù ở chỗ cổng khác nhìn thấy.

| Cổng | Lệnh | Chạy bằng | Chứng minh |
|---|---|---|---|
| 1. Lược đồ tự kiểm | `npm run db:verify` | superuser | Catalog đúng thiết kế: vai trò, quyền, RLS, policy, hàm. |
| 2. API check | `npm run db:api-check` (từ Task 15, chưa có) | đúng vai trò ứng dụng (`app_conn` rồi chuyển vai) | Một request thật làm được gì: đi đúng đường của kẻ tấn công, trên cơ sở dữ liệu có dòng của "người khác" để tìm. |
| 3. Mutation check | `npm run db:mutation-check` (từ Task 16, chưa có) | superuser | Cổng 1 có *biết kêu* không: phá từng hàng rào một và đòi cổng 1 phải báo lỗi nêu đúng tên thứ bị phá. |

Cổng 1 không biết một request thật làm được gì; cổng 2 không biết thiết kế định nói gì; cả hai đều không biết phép kiểm của chính mình còn sống hay đã mục. Một file tự kiểm luôn xanh và một file tự kiểm đã mục trông giống hệt nhau, và cổng 3 là thứ phân biệt chúng.

### Cổng 1 kiểm những gì

`90-verify.sql` ném exception nêu tên đối tượng cho từng vi phạm. Nó mô tả trạng thái **còn nguyên** và so bằng dấu bằng; mọi thứ không nằm trong mô tả là vi phạm, bất kể ai nắm giữ. Quyền được đọc thẳng từ ACL trong catalog (`aclexplode`), không hỏi `has_*_privilege` cho một danh sách vai trò: quyền cấp cho một vai trò không ai nghĩ tới vẫn là quyền.

1. **Vai trò.** `app_conn` là `LOGIN NOINHERIT`; không vai trò `app_*` nào khác đăng nhập được; không vai trò `app_*` nào là superuser, `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, `REPLICATION`. Quan hệ thành viên có dính tới một vai trò `app_*` (ở cả hai chiều) chỉ gồm đúng ba dòng: `app_conn` trong `app_anon`, `app_auth`, `app_job` với `INHERIT FALSE, SET TRUE`, không `ADMIN`. Không vai trò `app_*` nào là thành viên của vai trò khác (kể cả `pg_read_all_data`), và không vai trò ngoài nào là thành viên của một vai trò `app_*`.
2. **Thiết lập lưu sẵn và quyền trên tham số.** `pg_db_role_setting` không có dòng nào áp dụng cho một vai trò `app_*` trong cơ sở dữ liệu này (`ALTER ROLE … SET`, `ALTER DATABASE … SET`, `ALTER ROLE ALL SET`). `pg_parameter_acl` không cấp tham số cấu hình nào cho một vai trò `app_*` hay `PUBLIC` (`GRANT SET ON PARAMETER …`).
3. **Sở hữu.** Không cơ sở dữ liệu, schema, bảng, view, sequence hay hàm nào thuộc sở hữu của một vai trò `app_*`: chủ sở hữu không cần GRANT và không chịu policy.
4. **Sổ đăng ký tự nó hợp lệ, và khớp catalog.** Mỗi dòng đăng ký bảng có lớp thuộc bốn lớp và đúng những gì lớp cho phép (`own_read`, `content`: chỉ `{SELECT}`; `internal`: không gì; `own_rw`: chỉ trong `SELECT`, `INSERT`, `UPDATE`, `DELETE`; `owner_column` có với `own_*`, rỗng với hai lớp kia); mỗi dòng đăng ký hàm chỉ nêu `app_anon`, `app_auth`, `app_job`. Mọi bảng và view trong `public` đều đã đăng ký; mọi bảng đã đăng ký đều tồn tại; cột `owner_column` và các cột `UPDATE` đã đăng ký đều tồn tại. Mọi hàm trong `public`, `app`, `meta` đều đã đăng ký; mọi hàm đã đăng ký đều tồn tại; hàm nội bộ (tên bắt đầu bằng `_` ở bất kỳ schema nào, và `meta.*`) đăng ký với tập vai trò rỗng.
5. **View.** View phải là `security_invoker`; không có materialized view, không có foreign table.
6. **RLS** bật với các lớp `own_read`, `own_rw`, `internal`.
7. **Quyền, đọc từ ACL, bằng đúng tập mong đợi** (`WITH GRANT OPTION` cũng là sai lệch):
   - cơ sở dữ liệu: chỉ mặc định `CONNECT` và `TEMPORARY` cho `PUBLIC` (không ai có `CREATE`);
   - schema: chỉ `USAGE` trên `public` và `app` cho `app_anon`, `app_auth`, `app_job`; `meta` không cấp cho ai; không ai có `CREATE`;
   - bảng và view: chỉ `app_auth`, đúng tập quyền đã đăng ký; bảng ngoài `public` không cấp cho ai;
   - cột: chỉ `UPDATE` cho `app_auth` trên đúng các cột đã đăng ký; không có quyền theo cột nào khác;
   - sequence: không cấp cho ai;
   - hàm: `EXECUTE` cho đúng tập vai trò đã đăng ký.
8. **Policy** trên mỗi bảng là đúng các policy đã đăng ký: `PERMISSIVE`, `TO app_auth`, cùng lệnh, biểu thức `USING` và `WITH CHECK` bằng nguyên văn; bảng `internal` không có policy nào.
9. **Thiết lập của hàm `SECURITY DEFINER`** phải là đúng một `SET search_path` với một trong hai giá trị `public, pg_temp` hoặc `pg_catalog, pg_temp`, **và không có `SET` nào khác** (một `SET session_replication_role = replica` đi kèm sẽ tắt trigger trong thân hàm). Không đặt, đặt `public` (thiếu `pg_temp` ở cuối), hay `pg_temp, public` đều bị từ chối: mọi vai trò đều tạo được bảng tạm, và bảng tạm trùng tên sẽ che bảng thật trong thân hàm đặc quyền.
10. `meta.test_clock` rỗng.

Giới hạn cần biết: phép so ACL coi mọi quyền ngoài mô tả là vi phạm, nên một vai trò vận hành (sao lưu, đọc báo cáo) được cấp quyền trực tiếp trên bảng sẽ làm cổng 1 đỏ; quyền `CONNECT` cấp riêng cho `app_conn` trên cơ sở dữ liệu cũng vậy, và một vai trò quản trị không phải superuser tạo ra các vai trò `app_*` sẽ tự có quan hệ thành viên `ADMIN` với chúng. Muốn có những thứ đó thì sửa mô tả trong `90-verify.sql` cùng một ca đột biến tương ứng, không nới phép so.

`server/checks/verify.test.ts` chạy ba việc trên lược đồ thật (áp dụng lại toàn bộ file SQL trên một cơ sở dữ liệu đã có lược đồ và xác nhận catalog không đổi một dòng nào; chạy `90-verify.sql`; xác nhận nó báo lỗi khi `meta.test_clock` có dòng), rồi dựng một lược đồ mẫu có đủ bốn lớp và phá lần lượt từng hàng rào, mỗi lần đòi đúng SQLSTATE `P0001` và đúng phần đầu thông báo nêu tên thứ bị phá. **Thêm hay siết một phép kiểm trong `90-verify.sql` thì thêm ca đột biến của nó vào file test này trong cùng thay đổi.** Cổng 3 (từ Task 16) lặp lại phép chứng minh đó trên toàn bộ bảng và hàm thật.

## Cách đăng ký bảng, policy, hàm

Mẫu dưới đây đi qua cổng 1 nguyên văn (đã chạy thử). Tên bảng và hàm chỉ để minh họa.

```sql
-- Bảng own_rw: client đọc dòng của mình và chỉ sửa được hai cột.
CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY,
  display_name text NOT NULL,
  timezone text NOT NULL,
  level_seen int NOT NULL DEFAULT 1
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select ON profiles;
CREATE POLICY own_select ON profiles FOR SELECT TO app_auth
  USING (app.current_user_id() = user_id);
DROP POLICY IF EXISTS own_update ON profiles;
CREATE POLICY own_update ON profiles FOR UPDATE TO app_auth
  USING (app.current_user_id() = user_id) WITH CHECK (app.current_user_id() = user_id);

REVOKE ALL ON profiles FROM PUBLIC, app_anon, app_auth, app_job;
GRANT SELECT ON profiles TO app_auth;                          -- mức bảng: chỉ SELECT
GRANT UPDATE (display_name, timezone) ON profiles TO app_auth; -- UPDATE chỉ theo cột

SELECT meta.expect_table('profiles', 'own_rw', '{SELECT}', '{display_name,timezone}', 'user_id');
SELECT meta.expect_policy('profiles', 'own_select', 'SELECT', '(app.current_user_id() = user_id)', NULL);
SELECT meta.expect_policy('profiles', 'own_update', 'UPDATE',
  '(app.current_user_id() = user_id)', '(app.current_user_id() = user_id)');

-- Hàm nội bộ nhận user id tường minh: không ai được gọi.
CREATE OR REPLACE FUNCTION app._mark_level_seen(p_user uuid, p_level int) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ UPDATE profiles SET level_seen = p_level WHERE user_id = p_user $$;
REVOKE ALL ON FUNCTION app._mark_level_seen(uuid, int) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._mark_level_seen(uuid, int)', '{}');

-- Hàm client gọi: nhận ý định, lấy id từ app.current_user_id().
CREATE OR REPLACE FUNCTION profile_mark_level_seen(p_level int) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT app._mark_level_seen(app.current_user_id(), p_level) $$;
REVOKE ALL ON FUNCTION profile_mark_level_seen(int) FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION profile_mark_level_seen(int) TO app_auth;
SELECT meta.expect_function('profile_mark_level_seen(int)', '{app_auth}');
```

Quy tắc dùng, mỗi dòng là một điều cổng 1 sẽ bắt:

- **`own_rw` cho sửa một phần**: `GRANT SELECT` ở mức bảng, `GRANT UPDATE (cột…)` theo cột, và **không** `GRANT UPDATE` ở mức bảng. Đăng ký quyền mức bảng (`'{SELECT}'`) và danh sách cột (`'{display_name,timezone}'`) riêng nhau.
- **Policy** viết `… TO app_auth` (bỏ `TO` là `PUBLIC`, bị từ chối), để mặc định `PERMISSIVE`, và đăng ký biểu thức bằng **đúng nguyên văn** `pg_get_expr` in ra: có ngoặc ngoài, tên hàm kèm schema, ví dụ `(app.current_user_id() = user_id)`. Lấy nguyên văn bằng `SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polname = '…'`. Làm cho chạy lại được bằng `DROP POLICY IF EXISTS` rồi `CREATE POLICY`.
- **Hàm `SECURITY DEFINER`**: đúng `SET search_path = public, pg_temp` và không `SET` nào khác; `REVOKE ALL … FROM PUBLIC` (cùng các vai trò `app_*`, để file tự đủ khi chạy lại); rồi `GRANT EXECUTE` cho **đúng** các vai trò sẽ đăng ký.
- **Hàm nội bộ và hàm trigger**: tên bắt đầu bằng `_` (hàm nhận user id tường minh luôn thuộc loại này), không `GRANT EXECUTE` cho ai, đăng ký với `'{}'`.
- **View**: `CREATE VIEW … WITH (security_invoker = true)`, đăng ký như bảng lớp `content`. Không materialized view, không foreign table.
- **Khóa chính**: `uuid` (`gen_random_uuid()`) hoặc cột `GENERATED … AS IDENTITY`. Không dùng `serial`: nó đòi `GRANT USAGE` trên sequence, mà sequence không được cấp cho ai.
- **`app_anon` và `app_job` không bao giờ được cấp quyền trên bảng.** Việc của request chưa đăng nhập và của job đi qua hàm `SECURITY DEFINER` cấp `EXECUTE` cho đúng vai trò đó.
- Đăng ký sai (lớp lạ, `own_rw` kèm `TRUNCATE`, hàm kèm `PUBLIC`) không báo lỗi ở dòng đăng ký mà ở `90-verify.sql` cuối lần migrate, với thông báo bắt đầu bằng `registry:` và nêu tên bảng hoặc hàm.

## Thêm một file SQL

1. Tạo `server/sql/NN-<mảng>.sql` với số nhỏ hơn 80, viết sao cho chạy lặp lại được. Mỗi file thuộc về một nhiệm vụ.
2. Bảng do superuser sở hữu. Bật RLS theo lớp, tạo policy `… TO app_auth`, rồi `GRANT` cho `app_auth` đúng những gì lớp cho phép, và không cấp gì cho vai trò khác. Dùng GRANT theo cột khi client chỉ được sửa một phần (`GRANT UPDATE (cột) …`).
3. Việc đặc quyền là hàm `SECURITY DEFINER` có đúng `SET search_path = public, pg_temp` (`pg_temp` luôn đứng cuối; gọi hàm trong `app` thì ghi rõ `app.`), nhận *ý định* của người dùng chứ không nhận số tiền hay user id; id lấy từ `app.current_user_id()`. Hàm nhận user id tường minh đặt trong `app` với tên bắt đầu bằng `_` và không cấp `EXECUTE` cho ai (quy tắc "tên bắt đầu bằng `_` = không ai được gọi" áp dụng ở mọi schema). `SECURITY DEFINER` không chịu RLS: điều kiện policy đang lọc hộ phải viết lại trong thân hàm. Đọc thời gian bằng `app.now()`.
4. **Đăng ký** mọi bảng, policy và hàm bằng `meta.expect_*` ngay trong file đó, kể cả hàm trong `app`. Hàm không vai trò nào được gọi (hàm `app._*`, hàm trigger) vẫn phải đăng ký, với tập vai trò rỗng `'{}'`.
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
- `asUser(db.app, userId, fn)`, `asAnon(db.app, fn)`, `asJob(db.app, fn)` mở transaction, chuyển vai và đặt `app.user_id` (rỗng với `asAnon` / `asJob`) như một request thật.
- `setTestClock(db.admin, iso | null)` đóng băng `app.now()` trong cơ sở dữ liệu của file test; truyền `null` để trả về thời gian thật. Luôn trả lại trong `finally`.
- `expectPgError(promise, { code, messagePrefix })` chỉ đạt khi lỗi có **đúng** SQLSTATE và message **bắt đầu** bằng chuỗi đã cho. "Có ném lỗi" không chứng minh gì: `42501` dùng chung cho cả thiếu GRANT (`permission denied for table …`) lẫn bị policy chặn (`new row violates row-level security policy …`), và một lỗi không liên quan (không tìm thấy, vi phạm khóa ngoại) phải làm test đỏ. Mỗi hàng rào khẳng định theo đúng cơ chế của chính nó.
- Trong một file, cô lập các test bằng người dùng ngẫu nhiên mới (`randomUUID()`), không bằng `ROLLBACK` bao ngoài: code được test tự `COMMIT`.
- Không test nào được đổi thuộc tính vai trò ngoài một transaction sẽ `ROLLBACK`: vai trò là của cả cụm, các file test chạy song song dùng chung. Cũng vì vậy chỉ các file trong `server/checks/` (mỗi file chạy một mình bằng lệnh `db:*` riêng) mới áp dụng lại toàn bộ lược đồ, trong đó có `00-roles.sql`.

## Điều cần biết về PostgreSQL nhúng

- Gói `embedded-postgres` cài một exit hook quyết định mã thoát của cả tiến trình: lượt test đỏ sẽ thoát với mã 0. `server/scripts/cluster.ts` gỡ hai handler gây ra việc đó (`beforeExit`, `exit`) và để nguyên các handler tín hiệu của gói; có test giữ mã thoát đúng. Việc Ctrl+C dừng được cụm chưa được kiểm chứng: nếu cụm còn lại sau khi ngắt, dùng `npm run db:cleanup`. Khi nâng phiên bản gói, chạy lại `npm run server:test` và kiểm tra một test cố ý đỏ vẫn cho mã thoát khác 0.
- Trên Windows gói dừng cụm bằng cách diệt cây tiến trình; postmaster có thể kịp sinh lại một tiến trình con trong lúc đó, và tiến trình sót lại giữ thư mục dữ liệu. Vì vậy sau khi dừng, `cluster.ts` quét và diệt nốt các tiến trình con của đúng postmaster đó. Nếu postmaster đã chết từ trước (bị diệt giữa chừng), `stop()` bỏ qua lệnh dừng của gói: lệnh đó sẽ chờ mãi một sự kiện không bao giờ tới.
- Phiên bản được ghim chính xác trong `server/package.json` (gói `embedded-postgres` luôn mang hậu tố `-beta`; đó là hậu tố của gói bọc, bộ nhị phân là PostgreSQL 18 gốc).

## Xác thực (`10-auth.sql`)

Tài khoản, khóa mật khẩu, phiên và mã đặt lại mật khẩu. Mọi luật (giới hạn số lần thử, câu trả lời đồng nhất, hiệu lực của phiên) nằm trong bảy hàm `auth_*`. Route chỉ băm mật khẩu, sinh token, gửi thư và đổi kết quả thành mã HTTP; nó không lách được luật nào vì không vai trò request nào chạm được vào các bảng bên dưới.

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `users` | `own_rw`: đọc dòng của mình, sửa `display_name` và `timezone` | `email` luôn ở dạng đã chuẩn hóa (có `CHECK`), duy nhất theo `lower(email)`, và vẫn bị giữ chỗ khi tài khoản đã xóa mềm, cho tới lúc dòng bị xóa hẳn. `display_name` 1–40 ký tự. `terms_accepted_at` bắt buộc. |
| `credentials` | `internal` | `salt` 16 byte, `key` 32 byte (kết quả scrypt tính ở Node). Không bao giờ rời cơ sở dữ liệu. |
| `sessions` | `internal` | Chỉ lưu SHA-256 của token (32 byte, duy nhất), `expires_at`, `revoked_at`. |
| `reset_codes` | `internal` | Chỉ lưu bản băm của mã, hạn 10 phút, `attempts`, `used_at`. |
| `auth_throttle` | `internal` | Bộ đếm theo khóa: `login:<email>` (15 phút), `reset:<email>` (1 giờ). |
| `app_secrets` | `internal` | Dòng `fake_salt_pepper`: 32 byte ngẫu nhiên, tạo một lần; chạy lại migrate không ghi đè. |
| `timezones` | `content` | Tên múi giờ PostgreSQL biết, chép từ `pg_timezone_names` ở mỗi lần migrate. |

Năm bảng `internal` đóng với cả ba vai trò request ở tầng GRANT (`42501 permission denied for table …`). Trên `users`, người dùng khác không hiện ra (policy, 0 dòng), và mọi cột ngoài hai cột được phép đều bị chặn ở tầng GRANT, kể cả `email`, `archetype` và `deleted_at`: các cột đó chỉ đổi qua hàm `SECURITY DEFINER` của nhiệm vụ sở hữu chúng.

### Múi giờ của người dùng

`users.timezone` là khóa ngoại tới `timezones(name)`, nên cơ sở dữ liệu từ chối mọi giá trị không phải một tên trong `pg_timezone_names`, trên mọi đường ghi (người dùng tự sửa qua GRANT theo cột, hàm, seeder, dòng mồi nhử): `'+07:00'`, `'ICT'`, `'UTC+7'`, chuỗi rỗng, tên không tồn tại, và cả tên viết sai hoa thường. Lỗi là `23503 insert or update on table "users" violates foreign key constraint "users_timezone_fkey"`; route phải kiểm tra trước (bằng validator của `domain/`) để người dùng nhận `422` chứ không phải `500`.

- Vì sao là một bảng chứ không hỏi thẳng `pg_timezone_names`: view đó đọc lại các tệp múi giờ ở mỗi truy vấn (đo được khoảng 250 ms trên máy phát triển), còn khóa ngoại là một lần tra chỉ mục.
- Sau khi PostgreSQL được cập nhật tzdata, chạy migrate để bảng nhận thêm tên mới. Tên cũ không bao giờ bị gỡ khỏi bảng.
- Bảng liệt kê đúng những gì PostgreSQL liệt kê, trong đó có vài tên `Intl` của JavaScript có thể không nhận (ví dụ `Factory`). Danh sách server công bố cho app phải là phần chung của hai bên; `app_auth` đọc được bảng này để làm việc đó.

### Bảy hàm

Tất cả là `SECURITY DEFINER` với `SET search_path = public, pg_temp`. `app_anon` gọi được cả bảy; `app_auth` chỉ gọi được `auth_logout` (route đăng xuất chạy khi đã có phiên); `app_job` không gọi được hàm nào.

| Hàm | Trả về | Luật |
|---|---|---|
| `auth_salt(email)` | `bytea` 16 byte | Salt đã lưu, hoặc 16 byte đầu của `sha256(pepper ‖ email)` với email không có tài khoản đang hoạt động. Cùng một email luôn cho cùng một kết quả. |
| `auth_register(email, display_name, salt, key, token_hash)` | id người dùng | Tạo người dùng, khóa mật khẩu và phiên đầu tiên trong một lần; ghi `terms_accepted_at`. |
| `auth_login(email, key, token_hash)` | id người dùng hoặc `NULL` | So khóa trong cơ sở dữ liệu và mở phiên mới. `NULL` cho email lạ, khóa sai, tài khoản đã xóa, email đang bị khóa. |
| `auth_session(token_hash)` | id người dùng hoặc `NULL` | `NULL` nếu phiên không có, đã thu hồi, đã hết hạn, hoặc người dùng đã xóa. Còn dưới 29 ngày thì gia hạn thành 30 ngày, nên mỗi phiên bị ghi nhiều nhất một lần mỗi ngày. |
| `auth_logout(token_hash)` | – | Thu hồi đúng phiên đó. Token lạ hay phiên đã thu hồi: không làm gì, không báo lỗi. |
| `auth_reset_request(email, code_hash)` | `boolean` | `true`: đã lưu mã mới (hạn 10 phút) và vô hiệu mọi mã cũ chưa dùng; route gửi thư. `false`: không lưu gì. |
| `auth_reset_confirm(email, code_hash, salt, key)` | `boolean` | So với mã mới nhất còn hạn và chưa dùng. Khớp: thay salt và khóa, đánh dấu mã đã dùng, thu hồi **mọi** phiên, gỡ khóa đăng nhập. |

Giới hạn, tất cả tính trong hàm:

- **Đăng nhập**: mỗi lần gọi `auth_login` được đếm vào `login:<email>` *trước khi* so khóa, kể cả với email lạ. Trong một cửa sổ 15 phút (tính từ lần gọi đầu, các lần sau không dời cửa sổ), từ lần gọi thứ 6 trở đi câu trả lời là `NULL` bất kể khóa đúng hay sai; tức là sau 5 lần sai, khóa đúng cũng bị từ chối cho tới hết cửa sổ. Một lần đăng nhập thành công xóa bộ đếm. Đếm trước nên nhiều lần thử gửi cùng lúc cũng không vượt được giới hạn.
- **Xin mã**: nhiều nhất 3 lần mỗi email mỗi giờ (`reset:<email>`), đếm cả email lạ. Lần thứ 4 trả `false` và không đụng tới mã đang có.
- **Nhập mã**: mỗi lần gọi `auth_reset_confirm` tiêu một lượt của mã hiện hành; mã sai, hoặc bất kỳ lần gọi nào từ lần thứ 6, đều trả `false`. Mã hết hạn sau 10 phút và chỉ dùng được một lần.

### Điều route phải làm đúng

- **Thất bại là giá trị trả về, không phải exception.** `auth_login` trả `NULL`, hai hàm đặt lại trả `false`, và lần thử vừa đếm nằm trong transaction của request. Route phải **trả** phản hồi lỗi (`401`, `400`) để transaction được `COMMIT`; ném lỗi là `ROLLBACK`, và lần thử sai biến mất khỏi bộ đếm (có test).
- **Lỗi được ném ra** chỉ có các loại sau. Hai loại đầu xảy ra trước khi hàm ghi bất cứ thứ gì; hai loại cuối là lỗi vận hành của server, không phải một lần thử sai, nên không có gì cần được đếm:
  - `auth_register` ném `HM000` với `MESSAGE` là mã lỗi của API: `REGISTRATION_UNAVAILABLE` (email đã có, kể cả của tài khoản đã xóa mềm; `DETAIL` là `{}`), hoặc `VALIDATION_FAILED` kèm `DETAIL` dạng `{"fields":[{"field":"email","rule":"format"}]}` (`email`: `format`; `displayName`: `min`, `max`) khi route quên kiểm tra;
  - mọi hàm ném `P0001` khi một tham số nhị phân sai kích thước (salt 16 byte; khóa, bản băm token, bản băm mã 32 byte). Đó là lỗi của server, không phải của người dùng: thông báo nêu kích thước mong đợi và không bao giờ chứa giá trị;
  - `auth_login` và `auth_register` ném `P0001` (`auth: this token hash already names a session`) nếu bản băm token đã thuộc về một phiên khác; thông báo không lặp lại bản băm;
  - `auth_salt` ném `P0001` (`auth_salt: app_secrets has no fake_salt_pepper`) nếu dòng pepper bị mất: trả `NULL` cho email lạ sẽ vừa làm route hỏng vừa để lộ email nào có tài khoản.
- **Email được chuẩn hóa trong hàm**, không phải ở nơi gọi: cắt dấu cách hai đầu rồi `lower()` theo collation ICU của cơ sở dữ liệu, tức đổi chữ thường theo Unicode đầy đủ, cho cùng kết quả với `toLowerCase()` của JavaScript (`ĐẶNG@…` và `đặng@…` là một). Không chuẩn hóa Unicode (dạng dựng sẵn và dạng tổ hợp là hai email khác nhau) và không kiểm tra cú pháp: đó là việc của `isEmail`. Email rỗng hoặc dài quá 254 ký tự sau chuẩn hóa không là tài khoản nào: các hàm trả đúng câu trả lời thất bại chung và không tạo dòng đếm; riêng `auth_register` ném `VALIDATION_FAILED`.
- **Bản băm của mã đặt lại do route tính** (`sha256(email + ':' + mã)`). Cơ sở dữ liệu so nguyên văn, nên route phải dùng cùng một cách viết email ở cả hai lần gọi: cắt dấu cách và đổi chữ thường trước khi băm.
- **Tên hiển thị** chỉ được kiểm tra độ dài (1–40 ký tự). Cắt dấu cách và lọc từ cấm là việc của route.
- **Salt chỉ dùng trong server.** `auth_salt` tồn tại để server luôn chạy đúng một lần scrypt cho mọi email; kết quả của nó không được trả cho client.
- Khóa, bản băm và salt luôn đi qua tham số (`$1`), không bao giờ nằm trong chuỗi SQL.

### Câu trả lời đồng nhất tới đâu

`auth_login` chạy cùng các câu lệnh cho mọi email: khóa theo email, tăng bộ đếm, tra người dùng, tính một khóa giả từ pepper, rồi so 32 byte bằng phép so không dừng ở byte khác đầu tiên; với email lạ, thứ được so là khóa giả. `auth_salt` cũng tính cả salt thật lẫn salt giả ở mọi lần gọi. Đo trên máy phát triển, trung vị của email có thật (khóa sai) và email lạ lệch nhau vài micro giây.

Đó không phải là "thời gian hằng": lần tra người dùng trúng hay trượt vẫn khác nhau ở mức đọc thêm một dòng, và nhánh thành công ghi thêm (xóa bộ đếm, tạo phiên). Thứ che phần còn lại là route: luôn một lần scrypt, cùng một thân phản hồi. Đăng ký thì cố ý để lộ email đã dùng (không có bước xác minh email), và được chặn bằng giới hạn theo IP của tầng HTTP.

Một đăng nhập và một lần đặt lại mật khẩu của cùng email không bao giờ chạy chồng nhau (khóa advisory theo email, giữ tới hết transaction): đặt lại mật khẩu thu hồi cả phiên của lần đăng nhập đang dở bằng mật khẩu cũ.

### Dọn dữ liệu cũ

File này không tự xóa gì. Những dòng sau là rác an toàn để xóa, và job dọn dẹp (nhiệm vụ về quyền riêng tư) cần xóa chúng:

- `auth_throttle`: dòng có `window_start` cũ hơn 1 giờ (cửa sổ dài nhất). Bảng này có một dòng cho **mỗi email từng được thử**, kể cả email không có tài khoản, và khóa của dòng chứa chính email đó: không dọn thì bảng lớn mãi và giữ lại email của cả tài khoản đã xóa hẳn.
- `sessions`: dòng đã hết hạn hoặc đã thu hồi. `reset_codes`: dòng đã dùng hoặc đã hết hạn. Cả hai tự mất theo người dùng khi tài khoản bị xóa hẳn (`ON DELETE CASCADE`).

### Phần cổng 1 không nhìn thấy

Cổng 1 đối chiếu vai trò, GRANT, RLS, policy và `search_path`. Nó không đọc **thân hàm**, **ràng buộc** hay **dữ liệu**: thay thân `auth_login` bằng một bản không so khóa, gỡ khóa ngoại `users_timezone_fkey`, gỡ `CHECK` của `email`, xóa chỉ mục duy nhất của email hay xóa dòng pepper đều không làm nó đỏ. Những thứ đó do `server/test/auth.sql.test.ts` giữ: mỗi luật ở trên có một test đỏ khi luật bị phá. Sửa `10-auth.sql` thì chạy `npm run server:test`, không chỉ `npm run db:verify`.
