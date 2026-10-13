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
npm run server:dev         # API trên cụm phát triển, http://127.0.0.1:8787/api/v1 (xem "Tầng HTTP")
npm run db:verify          # cổng 1: lược đồ tự kiểm
npm run db:cleanup         # dọn PostgreSQL của dự án bị bỏ lại (đọc mục "Khôi phục" trước khi chạy)
```

Không cần cài PostgreSQL, không cần Docker. Lần chạy test đầu tiên tạo cụm cơ sở dữ liệu (`initdb`) trong `server/.pgdata/`; các lần sau dùng lại thư mục đó.

Các lệnh `db:api-check` (từ Task 15), `db:mutation-check` (từ Task 16) và `server:perf` đã khai báo trong `server/package.json` nhưng **chưa tồn tại**: tệp của chúng đến ở các nhiệm vụ đó, trước lúc ấy lệnh báo lỗi không tìm thấy tệp.

## Hai cụm PostgreSQL của dự án

| Dùng cho | Cổng | Thư mục dữ liệu | Ai khởi động |
|---|---|---|---|
| Test và các cổng kiểm | 54329 | `server/.pgdata/` | `server/test/global.ts`, tự động trước mỗi lượt chạy |
| Phát triển | 54330 | `server/.pgdata-dev/` | `npm run server:dev` (`server/scripts/dev.ts`) |

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

- Gói `embedded-postgres` cài một exit hook quyết định mã thoát của cả tiến trình: lượt test đỏ sẽ thoát với mã 0. `server/scripts/cluster.ts` gỡ hai handler gây ra việc đó (`beforeExit`, `exit`) và để nguyên các handler tín hiệu của gói; có test giữ mã thoát đúng. Với một lượt test, việc Ctrl+C dừng được cụm chưa được kiểm chứng: nếu cụm còn lại sau khi ngắt, dùng `npm run db:cleanup`. (Script dev không dựa vào các handler đó: nó gỡ chúng và tự dừng, xem "Tầng HTTP".) Khi nâng phiên bản gói, chạy lại `npm run server:test` và kiểm tra một test cố ý đỏ vẫn cho mã thoát khác 0.
- Trên Windows gói dừng cụm bằng cách diệt cây tiến trình; postmaster có thể kịp sinh lại một tiến trình con trong lúc đó, và tiến trình sót lại giữ thư mục dữ liệu. Vì vậy sau khi dừng, `cluster.ts` quét và diệt nốt các tiến trình con của đúng postmaster đó. Nếu postmaster đã chết từ trước (bị diệt giữa chừng), `stop()` bỏ qua lệnh dừng của gói: lệnh đó sẽ chờ mãi một sự kiện không bao giờ tới.
- Phiên bản được ghim chính xác trong `server/package.json` (gói `embedded-postgres` luôn mang hậu tố `-beta`; đó là hậu tố của gói bọc, bộ nhị phân là PostgreSQL 18 gốc).

## Xác thực (`10-auth.sql`)

Tài khoản, khóa mật khẩu, phiên và mã đặt lại mật khẩu. Mọi luật (giới hạn số lần thử, câu trả lời đồng nhất, hiệu lực của phiên) nằm trong bảy hàm `auth_*`. Route chỉ băm mật khẩu, sinh token, gửi thư và đổi kết quả thành mã HTTP; nó không lách được luật nào vì không vai trò request nào chạm được vào các bảng bên dưới.

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `users` | `own_rw`: đọc dòng của mình, sửa `display_name` và `timezone` | `email` luôn ở dạng đã chuẩn hóa (có `CHECK`), duy nhất theo `lower(email)`, và vẫn bị giữ chỗ khi tài khoản đã xóa mềm, cho tới lúc dòng bị xóa hẳn. `display_name` 1–40 ký tự nhìn thấy được (có `CHECK`, xem dưới). `terms_accepted_at` bắt buộc. |
| `credentials` | `internal` | `salt` 16 byte, `key` 32 byte (kết quả scrypt tính ở Node). Không bao giờ rời cơ sở dữ liệu. |
| `sessions` | `internal` | Chỉ lưu SHA-256 của token (32 byte, duy nhất), `expires_at`, `revoked_at`. |
| `reset_codes` | `internal` | Chỉ lưu bản băm của mã, hạn 10 phút, `attempts`, `used_at`. |
| `auth_throttle` | `internal` | Bộ đếm theo khóa: `login:<email>` (15 phút), `reset:<email>` (1 giờ). |
| `app_secrets` | `internal` | Dòng `fake_salt_pepper`: 32 byte ngẫu nhiên, tạo một lần; chạy lại migrate không ghi đè. |
| `timezones` | `content` | Các tên múi giờ `users.timezone` được chứa: tên dạng `Khu_vực/Thành_phố` của PostgreSQL, và `UTC`. Chép từ `pg_timezone_names` ở mỗi lần migrate. |

Năm bảng `internal` đóng với cả ba vai trò request ở tầng GRANT (`42501 permission denied for table …`). Trên `users`, người dùng khác không hiện ra (policy, 0 dòng), và mọi cột ngoài hai cột được phép đều bị chặn ở tầng GRANT, kể cả `email`, `archetype` và `deleted_at`: các cột đó chỉ đổi qua hàm `SECURITY DEFINER` của nhiệm vụ sở hữu chúng.

### Múi giờ của người dùng

`users.timezone` là khóa ngoại tới `timezones(name)`, và bảng đó chỉ chứa các tên của `pg_timezone_names` **có dấu `/`**, cùng với `UTC`. Cơ sở dữ liệu vì thế từ chối mọi giá trị khác, trên mọi đường ghi (người dùng tự sửa qua GRANT theo cột, hàm, seeder, dòng mồi nhử): `'+07:00'`, `'ICT'`, `'UTC+7'`, chuỗi rỗng, tên không tồn tại, tên viết sai hoa thường, và cả những tên có thật nhưng không có dấu `/` như `'CET'`, `'EST'`, `'GMT'`, `'Factory'`. Lỗi là `23503 insert or update on table "users" violates foreign key constraint "users_timezone_fkey"`; route phải kiểm tra trước để người dùng nhận `422` chứ không phải `500`.

- **Vì sao bỏ tên không có dấu `/`.** PostgreSQL và JavaScript đọc chúng khác nhau. `CET`, `EET`, `MET`, `WET` vừa là tên múi giờ vừa là *chữ viết tắt*, và `AT TIME ZONE` ưu tiên chữ viết tắt: một độ lệch cố định, không có giờ mùa hè. Lúc `2026-07-15T01:30Z`, `app.logical_date(…, 'CET')` cho ngày 14 trong khi `Intl` cho ngày 15. `Factory` thì `Intl` không nhận. Với các tên được giữ lại, hai bên khớp nhau: có test so `app.logical_date` với `logicalDateOf` của `domain/` trên một mẫu 37 tên, mỗi nửa giờ của một ngày tháng Một và một ngày tháng Bảy.
- **Luật của validator ở route** (và của danh sách server công bố cho app qua endpoint ẩn danh `GET /meta/timezones`): một tên hợp lệ khi `Intl` nhận nó **và** nó có dấu `/` hoặc bằng `UTC` **và** nó có trong bảng `timezones`. Chỉ dùng `Intl.supportedValuesOf('timeZone')` là thiếu: danh sách đó có `Asia/Saigon` mà không có `Asia/Ho_Chi_Minh`.
- Vì sao là một bảng chứ không hỏi thẳng `pg_timezone_names`: view đó đọc lại các tệp múi giờ ở mỗi truy vấn (đo được khoảng 250 ms trên máy phát triển), còn khóa ngoại là một lần tra chỉ mục.
- **Migrate chỉ thêm, không bao giờ xóa.** Sau khi PostgreSQL được cập nhật tzdata, chạy migrate để bảng nhận thêm tên mới. Một tên bị dữ liệu múi giờ gỡ đi vẫn ở lại trong bảng, nên không dòng `users` nào mất múi giờ của mình; nếu PostgreSQL thật sự không còn hiểu tên đó thì `app.logical_date` sẽ báo lỗi cho đúng những người dùng ấy, và việc chuyển họ sang tên mới là một quyết định có chủ ý, không phải việc của migrate.

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
  - `auth_register` ném `HM000` với `MESSAGE` là mã lỗi của API: `REGISTRATION_UNAVAILABLE` (email đã có, kể cả của tài khoản đã xóa mềm; `DETAIL` là `{}`), hoặc `VALIDATION_FAILED` kèm `DETAIL` dạng `{"fields":[{"field":"email","rule":"format"}]}` (`email`: `format`; `displayName`: `min`, `max`, `format`) khi route quên kiểm tra;
  - mọi hàm ném `P0001` khi một tham số nhị phân sai kích thước (salt 16 byte; khóa, bản băm token, bản băm mã 32 byte). Đó là lỗi của server, không phải của người dùng: thông báo nêu kích thước mong đợi và không bao giờ chứa giá trị;
  - `auth_login` và `auth_register` ném `P0001` (`auth: this token hash already names a session`) nếu bản băm token đã thuộc về một phiên khác; thông báo không lặp lại bản băm;
  - `auth_salt` ném `P0001` (`auth_salt: app_secrets has no fake_salt_pepper`) nếu dòng pepper bị mất: trả `NULL` cho email lạ sẽ vừa làm route hỏng vừa để lộ email nào có tài khoản.
- **Email được chuẩn hóa trong hàm**, không phải ở nơi gọi: cắt dấu cách hai đầu rồi `lower()` theo collation ICU của cơ sở dữ liệu, tức đổi chữ thường theo Unicode đầy đủ, cho cùng kết quả với `toLowerCase()` của JavaScript (`ĐẶNG@…` và `đặng@…` là một). Cú pháp không được kiểm tra ở đây: đó là việc của `isEmail`.
- **Email không thể là tài khoản** thì không hàm nào coi là tài khoản: rỗng; dài quá 254 ký tự; chứa ký tự điều khiển (U+0001–U+001F, U+007F–U+009F) hay ký tự vô hình hoặc đổi chiều chữ (U+200B–U+200F, U+202A–U+202E, U+2060–U+2069, U+FEFF); hoặc không ở dạng chuẩn NFKC (chữ viết ở dạng tổ hợp NFD, `＠` và chữ cái toàn chiều rộng, chữ ghép: tất cả là bản trông-giống của một địa chỉ khác). Với email như vậy `auth_login` trả `NULL`, hai hàm đặt lại trả `false`, `auth_salt` trả một salt giả, không dòng đếm nào được tạo, và `auth_register` ném `VALIDATION_FAILED`. Cơ sở dữ liệu **không sửa** email thay người gọi: route phải tự chuẩn hóa (`normalize('NFC')`) rồi mới gọi, nếu không người gõ dạng NFD sẽ bị từ chối thay vì được nhận.
- **Byte NUL (U+0000) là ngoại lệ mà SQL không xử lý được.** Kiểu `text` không chứa được NUL, nên PostgreSQL từ chối ngay lúc đọc tham số, trước khi hàm chạy: `22021 invalid byte sequence for encoding "UTF8": 0x00`. Không hàm nào biến lỗi đó thành câu trả lời thất bại chung được. `isEmail` hiện không chặn NUL, nên route phải từ chối mọi chuỗi đầu vào có U+0000 (email, tên hiển thị, múi giờ) trước khi chạm tới cơ sở dữ liệu, nếu không người dùng nhận `500`.
- **Bản băm của mã đặt lại do route tính** (`sha256(email + ':' + mã)`). Cơ sở dữ liệu so nguyên văn, nên route phải dùng cùng một cách viết email ở cả hai lần gọi: cắt dấu cách và đổi chữ thường trước khi băm.
- **Tên hiển thị** có `CHECK` ngay trên cột (`users_display_name_check`), vì chủ dòng tự sửa được cột này: 1–40 ký tự, không có dấu cách ở hai đầu, không ký tự điều khiển và không ký tự vô hình hay đổi chiều chữ (cùng các khoảng mã như ở email). `auth_register` đổi vi phạm thành `VALIDATION_FAILED` (`displayName`: `format`); một `UPDATE` trực tiếp thì nhận `23514 new row for relation "users" violates check constraint "users_display_name_check"`, nên route sửa hồ sơ phải kiểm tra trước. Chữ có dấu và emoji đơn được nhận; emoji ghép bằng U+200D (ví dụ emoji gia đình) bị từ chối vì U+200D nằm trong khoảng vô hình. Cắt dấu cách và lọc từ cấm vẫn là việc của route.
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

Cổng 1 đối chiếu vai trò, GRANT, RLS, policy và `search_path`. Nó không đọc **thân hàm**, **ràng buộc** hay **dữ liệu**: thay thân `auth_login` bằng một bản không so khóa, gỡ khóa ngoại `users_timezone_fkey`, gỡ `CHECK` của `email` hay của `display_name`, chép cả tên múi giờ không có dấu `/`, xóa chỉ mục duy nhất của email hay xóa dòng pepper đều không làm nó đỏ. Những thứ đó do `server/test/auth.sql.test.ts` giữ: mỗi luật ở trên có một test đỏ khi luật bị phá. Sửa `10-auth.sql` thì chạy `npm run server:test`, không chỉ `npm run db:verify`.

## Tầng HTTP (`server/src`, `11-idempotency.sql`)

Server là `node:http` trần: không framework, không middleware. Mọi route của mọi nhiệm vụ sau thừa hưởng những gì mục này mô tả, nên chúng được giữ bằng test trên cơ sở dữ liệu thật (`server/src/*.test.ts`).

| File | Việc |
|---|---|
| `app.ts` | Kiểu `Route`, `Ctx`; nạp `src/routes/*.ts`; đường đi của một request (`createApp`). |
| `http.ts` | Đọc body, khớp đường dẫn, ghi phản hồi. |
| `db.ts` | `withRole`: transaction có chuyển vai, nơi duy nhất điều khiển transaction. `createPool` và các giới hạn thời gian. |
| `session.ts` | Token phiên, băm token, đọc header `Authorization`. |
| `idempotency.ts` | Khóa idempotency: băm request, giữ khóa, lưu phản hồi. |
| `rateLimit.ts` | Bộ giới hạn tần suất trong bộ nhớ. |
| `errors.ts` | Bảng mã lỗi → mã HTTP, `AppError`, `errorResponse`. |
| `log.ts` | Log JSON, `log.ledger`. |
| `config.ts`, `main.ts` | Đọc môi trường (`DATABASE_URL`, `JOURNAL_KEY`, `HOST`, `PORT`); tiến trình server. |
| `routes/meta.ts` | `GET /healthz`, `GET /meta/timezones`. |
| `routes/auth.ts` | Năm route xác thực: đăng ký, đăng nhập, đăng xuất, quên và đặt lại mật khẩu. |
| `password.ts` | `deriveKey` (scrypt), `newSalt`, cổng giới hạn scrypt. |
| `mailer.ts` | `outboxMailer`: thư ghi vào file, chỉ để phát triển. |

### Chạy

```sh
npm run server:dev     # cụm phát triển (54330) + migrate + API ở http://127.0.0.1:8787/api/v1
node server/src/main.ts   # tiến trình thật: cần DATABASE_URL và JOURNAL_KEY
```

- `server:dev` khởi động cụm phát triển, tạo cơ sở dữ liệu `hoimau` nếu chưa có, chạy `migrate` (gồm seeder và `90-verify.sql`), đặt mật khẩu dev cho `app_conn`, rồi mở API trên `127.0.0.1`. Nó luôn nối vào cụm nó vừa khởi động, bất kể `DATABASE_URL` trong môi trường; `JOURNAL_KEY` lấy từ môi trường hoặc `server/.env`, thiếu thì dùng một khóa cố định chỉ dành cho máy phát triển. Nó không bao giờ chạm cụm test (54329) hay dịch vụ hệ thống (5432).
- **Dừng bằng Ctrl+C** (`SIGINT`; `SIGTERM` cũng vậy): API thôi nhận kết nối và chờ request đang chạy, đóng pool, rồi dừng cụm. Đã chạy thử trên Windows: sau Ctrl+C, `npm run db:cleanup` báo `nothing running`. Script gỡ các handler tín hiệu của `embedded-postgres` (chúng dừng cụm ngay dưới chân API rồi gọi `process.exit`). Diệt cưỡng bức tiến trình thì cụm bị bỏ lại: dùng `npm run db:cleanup`.
- `main.ts` đọc `server/.env` nếu có (biến đã có trong môi trường thắng). `config.ts` dừng ngay với thông báo nêu **tên biến** và điều sai, không bao giờ in giá trị: `DATABASE_URL` phải là URL `postgres://` có người dùng, máy chủ và tên cơ sở dữ liệu (vai trò `app_conn`); `JOURNAL_KEY` là đúng 32 byte viết bằng base64 (44 ký tự); `PORT` mặc định 8787.
- **`HOST` mặc định là `127.0.0.1`**: API chỉ nghe trên chính máy đó. Server thật nhận request từ mạng phải đặt `HOST` (địa chỉ của nó, hoặc `0.0.0.0` cho mọi giao diện); mở API ra mạng là một quyết định, không phải mặc định.
- Lỗi không ai bắt (`unhandledRejection`) được ghi một dòng log và server chạy tiếp. Exception không ai bắt (`uncaughtException`) được ghi log, server được dừng như khi nhận tín hiệu, và tiến trình thoát với mã 1. Cả hai dòng log đều không có thông báo của lỗi (xem "Log").
- **`MAIL_MODE=outbox` là chế độ thư duy nhất** và bắt buộc phải đặt: thiếu hay giá trị khác thì `main.ts` dừng ngay lúc khởi động, trước khi nối cơ sở dữ liệu, với thông báo trỏ về mục "Thư" ở cuối file này. `server:dev` mặc định `outbox`. Chi tiết ở mục "Route xác thực và thư".

### Đường đi của một request

Theo đúng thứ tự; bước nào trả lời thì các bước sau không chạy.

1. Tìm route theo phương thức và đường dẫn dưới `/api/v1`. Không có: `404 NOT_FOUND`. Tham số đường dẫn được giải mã `%` (handler nhận giá trị đã giải mã); chuỗi `%` hỏng, tham số rỗng hoặc chứa U+0000 cũng là `404`. Tham số query chứa U+0000: `422 VALIDATION_FAILED`.
2. Giới hạn theo địa chỉ (xem "Giới hạn tần suất"): trước body, trước `prepare`, trước cơ sở dữ liệu.
3. Route `session` / `user`: header phải là đúng `Authorization: Bearer <token>` với token 43 ký tự base64url, nếu không `401 SESSION_INVALID` mà không chạm cơ sở dữ liệu. **Route `anon` không đọc header này**, kể cả khi nó mang một phiên còn sống: route đó luôn chạy bằng `app_anon` (các hàm `auth_*` chỉ mở cho `app_anon`).
4. Route `idempotent`: thiếu `Idempotency-Key` là `400 IDEMPOTENCY_KEY_REQUIRED`; có mà không phải UUID là `422 VALIDATION_FAILED` với `details.fields = [{ field: "Idempotency-Key", rule: "format" }]`.
5. Đọc body (mọi phương thức trừ `GET`): quá 64 KiB là `413 PAYLOAD_TOO_LARGE`; có body mà không khai `Content-Type: application/json`, không phải JSON UTF-8, có U+0000 hoặc một nửa cặp surrogate trong một chuỗi hay tên thuộc tính (PostgreSQL không lưu được cả hai), hoặc lồng sâu quá 32 tầng là `400 BAD_JSON`. Không có body thì `ctx.body` là `undefined`. Thuộc tính lạ không bị từ chối: route tự kiểm tra hình dạng.
6. `prepare` của route, nếu có (chỉ route `anon`): chạy **trước khi mở transaction**, lúc request chưa giữ kết nối nào.
7. Lấy một kết nối, mở transaction, chuyển sang `app_anon`, đặt `app.user_id` rỗng.
8. Có token: `auth_session(sha256(token))`. Không ra người dùng: `401 SESSION_INVALID`. Ra: chuyển sang `app_auth`, đặt `app.user_id`, rồi giới hạn theo tài khoản; route `user` còn đòi `users.onboarded_at`, thiếu là `409 ONBOARDING_REQUIRED`.
9. Route `idempotent`: giữ khóa (xem "Idempotency").
10. `SELECT app.now()` thành `ctx.now`, rồi gọi `handler(ctx)`.
11. Kết thúc transaction, trả kết nối về pool, ghi phản hồi, ghi một dòng log.

Một request bị trả lời **trước khi body của nó được đọc hết** (404, 401, 413, một `GET` có body…) nhận `Connection: close` và kết nối bị đóng ngay sau phản hồi: phần body còn lại không được đọc, dù client khai nó dài bao nhiêu.

Quy tắc của transaction:

- **Commit khi handler trả về, bất kể mã HTTP; rollback chỉ khi nó ném lỗi.** Vì vậy thất bại cần được giữ lại (một lần đăng nhập sai đã đếm, một lượt nhập mã đã tiêu) phải được **trả về** bằng `errorResponse(code)`; `throw new AppError(code)` là từ chối và xóa sạch mọi thứ request đã ghi. Có test cho cả hai chiều, gồm cả bộ đếm của `auth_login`.
- **Đừng bắt lỗi của cơ sở dữ liệu rồi đi tiếp.** Sau một câu lệnh hỏng, transaction đã hỏng theo, và PostgreSQL trả lời lệnh commit của nó bằng `ROLLBACK`. `withRole` kiểm tra câu trả lời đó: handler nuốt lỗi rồi trả về (kể cả trả về `errorResponse`) thì request kết thúc bằng `500 INTERNAL` có ghi log, không bao giờ bằng một "thành công" không ghi được gì.
- **Mức cô lập là `READ COMMITTED`** (mặc định), không đặt `REPEATABLE READ` hay `SERIALIZABLE` ở đâu cả. Đã đo với `auth_login`: dưới `REPEATABLE READ`, chín trong mười lần đăng nhập gửi cùng lúc hỏng với `40001` và bộ đếm đếm thiếu. Các hàm của dự án tự tuần tự hóa bằng khóa dòng và khóa advisory, và cần thấy dữ liệu vừa được commit sau khi chờ khóa.
- **Chuyển vai và điều khiển transaction chỉ nằm trong `db.ts`.** `app.user_id` **luôn** được đặt, rỗng với request ẩn danh, nên giá trị ai đó để lại trên kết nối không bao giờ thành danh tính. Một test đọc toàn bộ `server/src` (trừ `db.ts` và `migrate.ts`) và đỏ khi thấy lệnh mở, kết thúc transaction hay đổi vai ở bất kỳ file nào khác: route không bao giờ tự quản transaction.
- **Kết nối bẩn không quay lại pool.** Khi kết thúc transaction, `withRole` hỏi luôn (cùng một lượt gửi) kết nối còn là `app_conn` trần không có `app.user_id` hay không. Không phải (ai đó đã kết thúc transaction giữa chừng và đặt vai trò cho cả phiên), hoặc kết nối đã chết, hoặc không rollback được: kết nối bị hủy thay vì trả về pool.
- **Không giữ transaction qua việc chậm.** scrypt và gọi mạng đặt trong `prepare`. Có test: trong lúc `prepare` chạy, pool không có kết nối nào đang được mượn. Gửi thư không nằm trong request: handler gọi `ctx.afterCommit(…)` (xem "Route xác thực và thư").
- **Mỗi request giữ nhiều nhất một kết nối.** Handler đã giữ một kết nối (`ctx.db`) và **không bao giờ được lấy kết nối thứ hai**: đủ số request làm vậy là mọi kết nối cùng chờ một kết nối không bao giờ tới. `ctx.pool` trong handler ném lỗi ngay khi bị chạm vào. Kết nối thứ hai chỉ có trong `prepare` (và trong `direct`): `withRole(pre.pool, vai trò, userId, fn)`, một transaction ngắn kết thúc trước khi transaction của request bắt đầu.
- Câu lệnh chạy **ngoài** `withRole` chạy bằng `app_conn` trần và hỏng với `42501` / `42P01` / `42883`. Đó là hàng rào; đừng bao giờ "sửa" nó bằng một GRANT.
- Client ngắt kết nối giữa chừng không hủy việc đang chạy: handler chạy hết, transaction được commit và kết nối trở về pool (có test). Với request ghi, lần gửi lại cùng khóa nhận đúng phản hồi đã lưu.

### Giới hạn thời gian

Không gì chờ mãi. `createPool` (`db.ts`) đặt bốn giới hạn; ba giới hạn phía PostgreSQL đi theo gói mở kết nối nên có hiệu lực với **mọi** kết nối của pool từ câu lệnh đầu tiên (có test đọc lại bằng `SHOW` trên ba kết nối).

| Giới hạn | Giá trị | Khi vượt |
|---|---|---|
| Chờ một kết nối rảnh của pool, hoặc chờ nối | 5 giây | request nhận `500` |
| Một câu lệnh (`statement_timeout`) | 10 giây | PostgreSQL hủy câu lệnh (`57014`), request nhận `500` |
| Chờ một khóa (`lock_timeout`) | 5 giây | `55P03`, request nhận `500`; riêng chờ khóa idempotency thì `429` (xem dưới) |
| Transaction mở mà không gửi gì (`idle_in_transaction_session_timeout`) | 15 giây | PostgreSQL ngắt phiên (`25P03`), request nhận `500`, kết nối bị hủy |

- Mọi trường hợp đều là `500 INTERNAL` (hợp đồng API không có mã riêng cho "server đang bận"), không lộ thông báo SQL, transaction được rollback, kết nối được trả về pool (hoặc bị hủy nếu đã hỏng), và đúng một dòng log ghi lại với `code` là SQLSTATE.
- Handler không bao giờ kết thúc (chờ một thứ không tới) cũng không giữ kết nối mãi: sau 15 giây PostgreSQL ngắt phiên, `withRole` thôi chờ handler, request nhận `500` và kết nối bị hủy.
- `GET /healthz` trả lời trong 2 giây dù pool ở trạng thái nào: hết kết nối rảnh, cơ sở dữ liệu im lặng hay không nối được đều là `200` với `ok: false`.
- **Job cần câu lệnh dài hơn 10 giây** thì nói rõ trong transaction của chính nó: `SET LOCAL statement_timeout = '60s'` (chỉ có hiệu lực tới hết transaction đó). Không nới giới hạn của pool.

### Viết một route

Mỗi file trong `server/src/routes/` export mặc định một `Route[]`; `app.ts` tự nạp mọi file (trừ `*.test.ts`), không có sổ đăng ký nào để sửa. Một test đối chiếu mọi route với `OPERATIONS` của `domain/contract/operations.ts` (cùng `auth`, cùng `idempotent`). File route chỉ `import type` từ `app.ts`; giá trị (`errorResponse`, `AppError`, `withRole`) lấy từ `errors.ts`, `db.ts`.

```ts
import type { Route } from '../app.ts';
import { AppError } from '../errors.ts';

const routes: Route[] = [
  {
    method: 'POST', path: '/guilds/nudge', auth: 'user', idempotent: true,
    rateLimit: { perMinute: 10 },
    handler: async ({ db, body, actionId }) => {
      const { receiverId } = body as { receiverId?: unknown };
      if (typeof receiverId !== 'string') {
        throw new AppError('VALIDATION_FAILED', { fields: [{ field: 'receiverId', rule: 'required' }] });
      }
      // minh họa: hàm này đến ở một nhiệm vụ sau
      const { rows } = await db.query('SELECT nudge_send($1, $2) AS result', [receiverId, actionId]);
      return { status: 200, body: rows[0].result };
    },
  },
];
export default routes;
```

- `auth`: `anon` (chạy bằng `app_anon`, `ctx.userId` là `null`), `session` (phiên hợp lệ), `user` (phiên và đã onboarding).
- `ctx.db` là kết nối **đang ở trong** transaction của request, đã chuyển vai: mọi truy vấn của handler đi qua nó, và chỉ qua nó. `ctx.tokenHash` là SHA-256 của token (cho đăng xuất); token gốc không rời khỏi tầng HTTP và không có trên `ctx`.
- `ctx.body` là `unknown`: route kiểm tra từng trường. Mọi giá trị đi vào SQL qua tham số.
- Lỗi do hàm SQL ném với `SQLSTATE HM000` tự thành phản hồi: `MESSAGE` là mã lỗi của API, `DETAIL` là JSON của `details`. Mọi lỗi khác là `500 INTERNAL`, không lộ gì trong phản hồi.
- `status` phải là số nguyên từ 200 tới 599. Giá trị khác là lỗi lập trình: transaction được rollback, request nhận `500` và được ghi log.
- **`prepare` chỉ dành cho route `anon`** (nó chạy trước khi phiên được xác nhận, nên trên route khác nó sẽ làm việc cho bất kỳ ai gửi một token đúng hình dạng). Kết quả của nó là `ctx.prepared`; ném `AppError` trong đó để từ chối mà không mở transaction.
- `direct` thay cho `handler`: route `anon` không cần transaction của request (hai route `meta`). Nó tự lo việc đọc cơ sở dữ liệu của mình.
- Lỗi lúc khởi động: trùng `phương thức + đường dẫn` (không kể tên tham số); route `idempotent` mà là `anon` hoặc `GET`; route có cả `handler` lẫn `direct`, hoặc không có cái nào; `direct` kèm `prepare`; `direct` hoặc `prepare` trên route không phải `anon`.

### Idempotency

**Một khóa là một thao tác của người dùng, và chỉ phản hồi 2xx được ghi nhớ.**

Bảng `idempotency_keys` (lớp `internal`): khóa chính `(user_id, key)`, `request_hash`, `status`, `response`, `created_at` (từ `app.now()`). Phản hồi đã lưu có thể chứa dữ liệu cá nhân nên **không vai trò nào đọc được bảng**; tầng HTTP chỉ chạm nó qua ba hàm `SECURITY DEFINER` cấp cho `app_auth`, và cả ba lấy người dùng từ `app.current_user_id()`:

| Hàm | Việc |
|---|---|
| `idempotency_begin(key, request_hash)` | Chèn dòng nếu chưa có, rồi trả về trạng thái của dòng. Request thứ hai cùng khóa chờ ngay ở lệnh chèn tới khi request thứ nhất kết thúc. |
| `idempotency_store(key, status, response)` | Lưu phản hồi 2xx vào dòng đang giữ. Không bao giờ ghi đè phản hồi đã lưu. |
| `idempotency_release(key)` | Trả khóa lại (xóa dòng chưa có phản hồi). Không bao giờ xóa phản hồi đã lưu. |

- Cùng khóa, cùng request, đã có phản hồi: trả lại đúng mã và body đã lưu, handler không chạy.
- Cùng khóa, request khác (phương thức, đường dẫn, query hay body khác): `409 IDEMPOTENCY_KEY_REUSED`.
- **Phản hồi không phải 2xx không để lại gì**, dù handler *trả về* lỗi hay *ném* lỗi: khóa được trả lại trong chính transaction đó, và lần gửi sau với khóa ấy chạy từ đầu, với cùng body hoặc với body đã sửa. Vì vậy không dòng nào đã commit mà thiếu `status`.
- Hai request cùng khóa gửi cùng lúc: request sau chờ tới khi request trước commit, rồi nhận phản hồi đã lưu. Có test với 20 request song song (một lần chạy, 20 phản hồi giống nhau), và với các lần gửi lại song song của một request từng bị từ chối.
- **Request sau không chờ quá `lock_timeout` (5 giây).** Hết hạn mà request đầu vẫn đang chạy thì nó trả kết nối về pool và nhận `429 RATE_LIMITED` với `Retry-After: 1`. Hợp đồng API không có mã cho "chính request này đang được xử lý"; `429` được chọn vì đó là mã mà app **giữ** thao tác lại để gửi lại (với `409` app sẽ bỏ thao tác đi, và mất nó nếu request đầu rốt cuộc hỏng). Lần gửi lại nhận phản hồi đã lưu.
- **Khóa thuộc về người dùng.** Người khác gửi đúng khóa và đúng request đó thì chạy mới trên dòng của chính họ và không bao giờ thấy phản hồi của người kia (có test). Route ẩn danh không thể idempotent.
- **`request_hash` là HMAC-SHA-256**, không phải SHA-256 trần, của phương thức, đường dẫn kèm query, và body đã chuẩn hóa thứ tự thuộc tính. Body có thể chứa mật khẩu (xóa tài khoản); một bản băm trần của nó nằm trong bảng nhiều ngày sẽ cho phép dò mật khẩu với tốc độ hàng trăm nghìn lần thử mỗi giây. Khóa của HMAC được dẫn xuất từ `JOURNAL_KEY` với nhãn riêng (`HMAC(JOURNAL_KEY, "idempotency-request-hash-v1")`); bản thân `JOURNAL_KEY` không bao giờ được dùng trực tiếp. Hệ quả: **đổi `JOURNAL_KEY` thì mọi bản băm đã lưu không còn khớp**, và một lần gửi lại với khóa cũ nhận `409 IDEMPOTENCY_KEY_REUSED` thay vì phản hồi đã lưu.
- **Phản hồi được lưu dài nhất 256 KiB.** Handler của route `idempotent` trả body lớn hơn là lỗi lập trình: rollback, `500`, có ghi log. Không bao giờ "trả lời mà không lưu": lần gửi lại sẽ chạy handler lần thứ hai.
- `ctx.actionId` là chính khóa đó, viết thường. Body trả lại từ `jsonb` có thể khác thứ tự thuộc tính so với lần đầu; giá trị thì như nhau.
- Chưa có gì xóa dòng cũ: job dọn dẹp (nhiệm vụ về quyền riêng tư) xóa theo `created_at` sau 7 ngày. Dòng mất theo người dùng (`ON DELETE CASCADE`).

Cổng 1 không đọc thân ba hàm này: bỏ điều kiện `user_id`, hay bỏ `status IS NULL`, không làm nó đỏ. `server/src/idempotency.test.ts` giữ chúng.

### Giới hạn tần suất

Cửa sổ cố định, trong bộ nhớ của tiến trình (một tiến trình server là giới hạn của thiết kế này; chạy tiến trình thứ hai thì phải chuyển bộ đếm vào cơ sở dữ liệu). Vượt giới hạn: `429 RATE_LIMITED` kèm `Retry-After` (số giây tới hết cửa sổ).

| Áp dụng cho | Giới hạn | Đếm theo |
|---|---|---|
| Mọi request ghi (không phải `GET`) | 300 / phút | địa chỉ client |
| Mọi request ghi có phiên | 120 / phút | tài khoản |
| Route có `rateLimit: { perMinute, perHour }` | như khai báo | tài khoản; địa chỉ client với route `anon` |
| Phản hồi `401 SESSION_INVALID` trên route cần phiên | 60 / phút | địa chỉ client |

- **Địa chỉ client là địa chỉ của socket. `X-Forwarded-For` không được đọc**: bản triển khai này không có proxy phía trước, nên header đó là thứ client tự viết (có test). Đặt một proxy phía trước thì mọi client sẽ chung một địa chỉ: khi đó phải sửa chỗ này một cách có chủ ý.
- **IPv4 đếm theo đúng địa chỉ; IPv6 đếm theo dải `/64`** (một thuê bao giữ cả một dải `/64`, nên đếm theo từng địa chỉ là không đếm gì). IPv4 đi trong vỏ IPv6 (`::ffff:a.b.c.d`) được coi là IPv4.
- **Mọi giới hạn theo địa chỉ được xét trước mọi việc khác**: trước khi đọc body, trước `prepare` (một trận lũ ẩn danh không mua được thời gian scrypt; có test về thứ tự), trước cơ sở dữ liệu. Giới hạn theo tài khoản được xét ngay sau khi phiên được xác nhận. Request bị từ chối vẫn được đếm.
- **Dò phiên.** Mỗi `401` trên route cần phiên được đếm cho địa chỉ đó; tới 60 trong một phút thì các request sau tới route cần phiên nhận `429` **trước khi** cơ sở dữ liệu được hỏi gì (có test đếm số lần mượn kết nối). Cái giá: trong phút đó một phiên thật từ cùng địa chỉ cũng phải chờ. Route `anon` không bị ảnh hưởng.
- Cửa sổ đã hết được thay khi khóa của nó quay lại, và một lượt quét mỗi phút gỡ cửa sổ của những client không quay lại, nên bảng đếm không lớn mãi. Bộ hẹn giờ của lượt quét không giữ tiến trình sống và mất theo `server.close()`.
- Cửa sổ cố định cho phép dồn request quanh ranh giới của hai cửa sổ (tới gấp đôi giới hạn trong một khoảng ngắn): đó là bản chất của cách đếm này.
- `startTestApp` tắt giới hạn trừ khi truyền `rateLimits: true`.

### Log

Mỗi request một dòng JSON trên stdout: `ts`, `level`, `method`, `route`, `status`, `ms`, `userId`. `route` là **mẫu** của route (`/day/quests/:questCode/progress`), `null` với đường dẫn lạ; đường dẫn thật, query, header và body không bao giờ được ghi. Trạng thái `499` là client đã ngắt trong lúc gửi body.

- Lỗi `500` thêm vào dòng đó mô tả lỗi, chỉ ở phía server: `error` (tên lớp của lỗi), `code` (SQLSTATE hoặc tên errno), với lỗi của PostgreSQL thêm tên bảng / cột / ràng buộc / routine, và `stack` chỉ gồm các khung (`at … file:dòng:cột`). **Thông báo của lỗi không bao giờ được ghi, với mọi loại lỗi**: thông báo trích nguyên dữ liệu đầu vào (`invalid input syntax for type uuid: "…"`, `Invalid time zone specified: …`, câu trả lời của máy chủ thư kèm địa chỉ nhận), và `detail` của PostgreSQL in cả dòng. Thông báo nhiều dòng bị cắt nguyên khối, không cắt theo dòng, nên không dòng nào của nó lọt vào `stack`.
- `ctx.log.ledger({ kind: 'xp' | 'coin', userId, amount, reason, refId })` ghi `{"evt":"ledger", …}`: route gọi nó cho **mỗi** dòng sổ cái mà một hàm báo về.
- `ctx.log.line({...})` cho dòng khác. Không bao giờ đưa vào log: body, giá trị query hay đường dẫn, token, bản băm token, email, mật khẩu, nội dung nhật ký, số đo cơ thể, số calo. Có test: token, bản băm của nó và email không xuất hiện ở dòng log nào, kể cả khi request kết thúc bằng `500` vì lỗi của cơ sở dữ liệu, của JavaScript hay của mailer.

### Request Node không đọc được

Khối header (gồm cả URL) quá 16 KiB, giới hạn mặc định của Node, nhận `431` với body lỗi của API (mã `PAYLOAD_TOO_LARGE`); cú pháp HTTP hỏng nhận `400` (mã `BAD_JSON`). Hai trường hợp này không đi qua route nào và được ghi một dòng `client_error`.

### `GET /healthz` và `GET /meta/timezones`

- `healthz` luôn trả `200`, trong 2 giây: `{ ok, db, jobs }`, `ok` sai đúng khi `db` sai. `db` là kết quả của một transaction thật bằng `app_anon`, nên nó cũng sai khi chuyển vai hỏng, khi pool hết kết nối rảnh và khi cơ sở dữ liệu không trả lời kịp. `jobs` rỗng cho tới khi có bộ lập lịch.
- `meta/timezones` trả các tên có trong bảng `timezones` **mà** `Intl.DateTimeFormat` của Node nhận, đã sắp xếp: đúng những tên `users.timezone` chứa được và hai bên đọc giống nhau. Bảng là lớp `content`, chỉ `app_auth` đọc được, và route thì ẩn danh, nên danh sách được đọc **một lần mỗi tiến trình** bằng một transaction `app_auth` không có người dùng rồi giữ trong bộ nhớ. Sau một lần migrate thêm tên mới, khởi động lại server.

### Test cho route

```ts
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { newUser, startTestApp } from '../../test/http.ts';
import type { TestApp } from '../../test/http.ts';
import { createTestDb } from '../../test/testdb.ts';
import type { TestDb } from '../../test/testdb.ts';

let db: TestDb;
let app: TestApp;
before(async () => {
  db = await createTestDb();
  app = await startTestApp(db);
});
after(async () => {
  await app.close();
  await db.drop();
});

test('GET /me cần một phiên', async () => {
  const { token } = await newUser(db);
  assert.equal((await app.call('GET', '/me')).status, 401);
  assert.equal((await app.call('GET', '/me', { token })).status, 200);
});
```

- `startTestApp(db, { mailer?, rateLimits?, routes?, journalKey? })` chạy app thật trên một cổng trống, qua pool `app_conn` của cơ sở dữ liệu test; `routes` thêm route thăm dò vào các route thật. Luôn `await app.close()` trong `after`.
- `db.app` không có giới hạn thời gian nào. Test về giới hạn thời gian hay về kích thước pool dùng `serverPool(db, { lockMs: 300, … })`: một pool tạo bằng chính `createPool` của server, rồi `startTestApp({ ...db, app: pool })`; test tự `pool.end()`.
- `app.call(method, path, { token?, body?, key?, headers?, rawBody?, signal? })` trả `{ status, body, headers }`. `app.logs` / `app.logText()` là log đã ghi, `app.mail` là thư đã "gửi".
- `newUser(db)` trả `{ userId, token, email }`: một tài khoản có phiên, **chưa onboarding**, tạo thẳng qua `auth_register` bằng `app_anon`.
- Thư của `ctx.afterCommit` tới `app.mail` **sau** phản hồi: test chờ tới khi thư xuất hiện (và chờ một nhịp ngắn trước khi khẳng định rằng *không* có thư).

## Route xác thực và thư (`routes/auth.ts`, `password.ts`, `mailer.ts`)

Năm route đặt trên các hàm `auth_*` của `10-auth.sql`. Hợp đồng (mã HTTP, mã lỗi, tên trường) nằm ở `docs/api/openapi.yaml`; mục này ghi cách server giữ nó.

| Route | Thành công | Lỗi |
|---|---|---|
| `POST /auth/register` | `201 { token, userId, onboarded: false }` | `409 REGISTRATION_UNAVAILABLE` (email đã có, kể cả tài khoản đã xóa), `422 VALIDATION_FAILED`, `422 NAME_NOT_ALLOWED` |
| `POST /auth/login` | `200 { token, userId, onboarded }` | `401 INVALID_CREDENTIALS`, `422 VALIDATION_FAILED` |
| `POST /auth/logout` (`session`) | `204` | `401 SESSION_INVALID` |
| `POST /auth/password/forgot` | `202 {}` luôn luôn | `422 VALIDATION_FAILED` |
| `POST /auth/password/reset` | `204` | `400 RESET_CODE_INVALID`, `422 VALIDATION_FAILED` |

Không route nào nhận `Idempotency-Key` (app không gửi). Token do `newToken()` của `session.ts` tạo (43 ký tự base64url); cơ sở dữ liệu chỉ giữ `hashToken(token)`.

### Kiểm tra đầu vào

Dùng đúng luật của `domain/validation.ts` (app dùng cùng file). Mọi trường sai được liệt kê một lượt, theo thứ tự `displayName, email, password, acceptedTerms` / `email, code, newPassword`:

- email: cắt dấu cách và đổi chữ thường (`normalizeEmail`), rồi `isEmail`. **Thư và bản băm của mã đều dùng địa chỉ đã chuẩn hóa đó.**
- `displayName`: cắt dấu cách, 1–40 ký tự (đếm theo code point), `isDisplayName` (không ký tự điều khiển hay vô hình), rồi mới tới từ cấm: `422 NAME_NOT_ALLOWED` chỉ khi mọi trường khác hợp lệ.
- mật khẩu mới (`password` khi đăng ký, `newPassword` khi đặt lại): 8–128 ký tự theo code point, **không bao giờ cắt khoảng trắng**. Đăng nhập chỉ đòi không rỗng và không quá 128 (mật khẩu ngắn hơn 8 chỉ là sai, nhận `401`).
- `code`: đúng 8 chữ số (`^[0-9]{8}$`), độ dài lấy từ `LIMITS.resetCode.length`, không có số 8 nào trong code server.
- `acceptedTerms` phải đúng là `true`.
- Mọi chuỗi có U+0000 là `VALIDATION_FAILED` của chính trường đó (nếu để lọt, PostgreSQL trả `22021`); thân request không phải object coi như thiếu mọi trường.

### Đường đi của từng route

- **scrypt chỉ chạy trong `prepare`**, trước khi request mở transaction (không giữ kết nối nào). Đăng ký: kiểm tra, salt mới, scrypt. Đăng nhập: kiểm tra, `auth_salt` (một transaction ngắn riêng, `withRole(pre.pool, 'app_anon', …)`), **đúng một** scrypt, cả với email không có tài khoản (salt giả), rồi handler gọi `auth_login`. Đặt lại: kiểm tra, salt mới, scrypt; mã sai hay đúng đều tốn như nhau.
- **Cổng scrypt** (`password.ts`): tối đa 4 lần chạy đồng thời và 32 lần chờ; lần thứ 37 trở đi nhận `429 RATE_LIMITED` (`deriveKey` ném `AppError`). Phản hồi `429` này **chưa có header `Retry-After`**, vì `AppError` không mang header.
- **Thất bại được trả về, không ném.** Đăng nhập thất bại là `return errorResponse('INVALID_CREDENTIALS')`, nên lần thử mà `auth_login` vừa đếm được commit: sau 5 lần sai, mật khẩu đúng cũng bị `401` trong 15 phút (có test qua HTTP, dời đồng hồ test). Email lạ, mật khẩu sai, tài khoản bị khóa và tài khoản đã xóa nhận **cùng từng byte**. Đặt lại thất bại cũng được trả về: mã sai đã tiêu một lần thử, và sau 5 lần sai, mã đúng cũng nhận `400`.
- `onboarded` của đăng nhập được đọc từ `users` sau khi đổi sang `app_auth`, vẫn trong transaction đó.
- **Quên mật khẩu** luôn `202 {}` (email lạ, vượt 3 lần/giờ, hay có tài khoản). Mã (`crypto.randomInt`, đệm số 0 tới `LIMITS.resetCode.length` chữ số) được tạo và băm `sha256(email + ':' + mã)` dù tài khoản có hay không; `auth_reset_request` trả `true` thì thư được xếp hàng bằng `ctx.afterCommit`.
- **Mã, mật khẩu và token không bao giờ vào log**; test gom log của cả lượt chạy rồi tìm từng giá trị.

### `ctx.afterCommit(run)`

Việc được xếp hàng chạy **sau khi transaction đã commit và phản hồi đã được ghi**. Nhờ vậy thời gian gửi thư không nằm trong thời gian trả lời (không lộ email nào có tài khoản), và không bao giờ có thư cho một transaction bị rollback. Không chạy khi request kết thúc bằng lỗi bị ném (kể cả `500` do transaction hỏng); chạy khi handler *trả về* `errorResponse`. Lỗi của `run` (reject hay ném) chỉ được ghi một dòng `{evt:'after_commit', route, error, code, stack}` (không có thông báo lỗi) và không ảnh hưởng ai. Hệ quả: **thư có thể tới sau phản hồi**; thư gửi hỏng thì người dùng bấm "Gửi lại" (tối đa 3 lần/giờ); server dừng giữa chừng có thể làm mất thư đang chờ gửi.

### Giới hạn tần suất của năm route

`rateLimit: { perMinute: 10 }` trên mỗi route: **10 request/phút cho mỗi địa chỉ client trên từng route ẩn danh** (đếm trước body, trước scrypt, trước cơ sở dữ liệu, nên không phụ thuộc tài khoản có tồn tại hay không) và 10/phút cho mỗi tài khoản với `logout` (route cần phiên chỉ có giới hạn theo tài khoản). Mỗi route một cửa sổ riêng, không dùng chung.

### Thư

`Mailer = ({ to, subject, text }) => Promise<void>` (khai báo ở `app.ts`). Chủ đề "Mã đặt lại mật khẩu Hồi Máu"; nội dung có mã và câu "Mã có hiệu lực trong 10 phút", **không có đường dẫn** (mã được gõ vào màn hình S55).

- `MAIL_MODE=outbox` (`server/.env.example`) là chế độ duy nhất: `outboxMailer` thêm một dòng JSON `{ts, to, subject, text}` cho mỗi thư vào `server/.outbox/mail.jsonl` (thư mục tự tạo, đã nằm trong `.gitignore`). **Chỉ để phát triển**: file chứa mã đặt lại ở dạng đọc được. Giá trị khác, hoặc không đặt, thì `main.ts` dừng khi khởi động.
- **Chỉ chủ sở hữu đọc được:** thư mục `.outbox` được tạo với mode `0o700` và file với `0o600`. Trên Windows mode phần lớn bị bỏ qua (quyền do ACL của thư mục cha quyết định), nên đó không phải hàng rào ở đó; hàng rào là file chỉ dùng khi phát triển.
- **Từ chối khi `NODE_ENV=production`:** `MAIL_MODE=outbox` kèm `NODE_ENV=production` dừng khởi động với cùng thông báo như giá trị không hỗ trợ; mã đặt lại không bao giờ được ghi xuống đĩa ngoài môi trường phát triển (có test). `server/.outbox/` đã nằm trong `.gitignore`.
- Lấy mã khi chạy `npm run server:dev`: dòng cuối của file đó.
- **Cắm SMTP: chưa kiểm chứng, chưa có dòng code nào được chạy.** Việc cần làm: viết một hàm `Mailer` (ví dụ `smtpMailer(options)` dùng một thư viện như `nodemailer`, thêm vào `server/package.json`); thêm nhánh `MAIL_MODE=smtp` vào `mailerFromEnv` của `main.ts`, đọc máy chủ, cổng, tài khoản và người gửi từ môi trường (mật khẩu SMTP không vào log hay repo); `server:dev` có thể giữ `outbox`. Hàm phải reject khi gửi hỏng (`ctx.afterCommit` ghi log không có thông báo lỗi; thông báo của máy chủ thư thường chứa địa chỉ người nhận). Chưa kiểm chứng: nhịp gửi, thử lại, hàng đợi khi tiến trình dừng.
