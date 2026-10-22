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
npm --prefix server run scenario -- list   # kịch bản dev và dời đồng hồ (xem "Kịch bản phát triển và dịch chuyển thời gian")
npm run db:verify          # cổng 1: lược đồ tự kiểm
npm run db:api-check       # cổng 2: một request thật làm được gì
npm run db:mutation-check  # cổng 3: cổng 1 có biết kêu không
npm run db:cleanup         # dọn PostgreSQL của dự án bị bỏ lại (đọc mục "Khôi phục" trước khi chạy)
```

Không cần cài PostgreSQL, không cần Docker. Lần chạy test đầu tiên tạo cụm cơ sở dữ liệu (`initdb`) trong `server/.pgdata/`; các lần sau dùng lại thư mục đó.

Lệnh `server:perf` đã khai báo trong `server/package.json` nhưng **chưa tồn tại**: tệp của nó đến ở một nhiệm vụ sau, trước lúc ấy lệnh báo lỗi không tìm thấy tệp.

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
| `app.logical_date(timestamptz, text)` | Nhãn ngày logic theo múi giờ: ngày bắt đầu lúc 03:00 giờ địa phương. Khớp với `logicalDateOf` của `domain/` (có test đối chiếu) **với tên múi giờ IANA dạng `Khu_vực/Thành_phố`**. Cách viết khác thì hai bên hiểu khác nhau: `'+07:00'` là UTC+7 với `Intl` nhưng là UTC−7 với PostgreSQL (dấu kiểu POSIX), còn `ICT` hay `UTC+7` chỉ PostgreSQL nhận. Cột lưu múi giờ của người dùng chỉ được chứa tên IANA mà cả hai bên đều biết. Ngay cả với tên đúng, hai bên là hai bản sao của cơ sở dữ liệu múi giờ và có lúc lệch nhau ở một vài múi giờ: nhãn của hàm này là thẩm quyền, `logicalDateOf` chỉ để app vẽ (xem "Ngày và nhiệm vụ"). |
| `app.week_start(date)` | Thứ Hai của tuần chứa ngày đó. Khớp với `weekStartOf`. |

Ba vai trò `app_anon`, `app_auth`, `app_job` gọi được bốn hàm này, và chỉ ba vai trò đó. Hàm có tên bắt đầu bằng `_`, ở bất kỳ schema nào, là hàm nội bộ: không vai trò nào được cấp `EXECUTE`. Mọi hàm trong `app` đều phải đăng ký (xem dưới), kể cả hàm nội bộ.

SQL không gọi `now()` trực tiếp mà gọi `app.now()`, nhờ đó test dời được thời gian (`setTestClock`). Bảng `meta.test_clock` chỉ chủ sở hữu ghi được, và `90-verify.sql` báo lỗi khi bảng có dòng: đồng hồ test không bao giờ được tồn tại ngoài một lượt test.

### Sổ đăng ký `meta` và các lớp truy cập

Mỗi file SQL **khai báo** điều nó mong đợi ở bảng, policy và hàm của mình; `90-verify.sql` đối chiếu khai báo với catalog. Nhờ vậy các file nghiệp vụ không bao giờ phải sửa `90-verify.sql`.

```sql
SELECT meta.expect_table('users', 'own_rw', '{SELECT}', '{display_name,timezone}', 'id');
CREATE POLICY own_select ON users FOR SELECT TO app_auth USING (app.current_user_id() = id);
SELECT meta.expect_policy('users', 'own_select', 'SELECT', '(app.current_user_id() = id)', NULL);
SELECT meta.expect_function('auth_login(text, bytea, bytea)', 'definer', '{app_anon}');
```

| Lớp | RLS | `app_auth` có | Ai ghi dòng | `owner_column` |
|---|---|---|---|---|
| `own_read` | bật | chỉ `SELECT` | chỉ hàm `SECURITY DEFINER` | bắt buộc |
| `own_rw` | bật | đúng các quyền đã đăng ký (chỉ trong `SELECT`, `INSERT`, `UPDATE`, `DELETE`), và `UPDATE` trên đúng các cột đã đăng ký | chính chủ dòng, qua policy | bắt buộc |
| `internal` | bật, không policy | không gì cả | chỉ hàm `SECURITY DEFINER` | `NULL` |
| `content` | không cần | chỉ `SELECT` | chủ sở hữu lược đồ (seeder) | `NULL` |

- `expect_table(tên, lớp, quyền mức bảng của app_auth, các cột được UPDATE, owner_column)`. `owner_column` là cột chứa id người sở hữu dòng (`user_id`, hoặc `id` với bảng `users`). Ba hàm `expect_*` chỉ ghi lại khai báo; chính `90-verify.sql` xét từng dòng của sổ, bất kể dòng đó được ghi bằng cách nào. Khai báo trái với lớp (ví dụ `own_read` kèm `INSERT`, `own_rw` kèm `TRUNCATE`, hay một lớp không tồn tại) làm cổng 1 đỏ ngay ở lần migrate đó, kể cả khi catalog "khớp" với khai báo. **Chỉ `app_auth` được cấp quyền trên bảng**: mọi quyền cấp cho bất kỳ vai trò nào khác, kể cả `PUBLIC` hay một vai trò ngoài bộ `app_*`, là vi phạm.
- `expect_policy(bảng, policy, lệnh, using, check)`. Hai biểu thức phải là **đúng nguyên văn** chuỗi `pg_get_expr` in ra, ví dụ `(app.current_user_id() = user_id)`; không dùng thì truyền `NULL`. Mọi policy phải là `PERMISSIVE` (mặc định) và viết **`TO app_auth`**: policy `RESTRICTIVE` hay policy cho vai trò khác (kể cả bỏ `TO`, tức `PUBLIC`) bị cổng 1 từ chối. So khớp bằng `=`, không bao giờ bằng `LIKE`: `USING (owner() OR true)` vẫn *chứa* `owner()` mà mở toang cửa.
- `expect_function(chữ ký, chế độ, vai trò)`. Chữ ký viết như trong `GRANT EXECUTE ON FUNCTION`, kèm tên schema nếu hàm không ở `public` (`app.now()`); hàm phải tồn tại lúc đăng ký. `vai trò` là **đúng** tập được cấp `EXECUTE`, và chỉ được gồm `app_anon`, `app_auth`, `app_job` (đăng ký `PUBLIC`, `app_conn` hay vai trò khác bị từ chối). **Mọi hàm trong `public`, `app` và `meta` đều phải đăng ký.** Hàm nội bộ (tên bắt đầu bằng `_` ở bất kỳ schema nào, và mọi hàm trong `meta`) cùng hàm không ai được gọi (hàm trigger) đăng ký với tập rỗng `'{}'`; đăng ký một hàm nội bộ kèm vai trò bị từ chối. `chế độ` là `'definer'` hoặc `'invoker'`: hàm chạy bằng quyền của chủ sở hữu (`SECURITY DEFINER`) hay của người gọi (mặc định). Tham số này **bắt buộc, không có giá trị mặc định**, và dạng hai tham số cũ đã bị gỡ: một dòng đăng ký quên nêu chế độ hỏng ngay tại dòng đó (`function meta.expect_function(unknown, unknown) does not exist`) thay vì âm thầm mang nghĩa "invoker". Chế độ được **khai**, không được suy ra: tên hàm hay `SET` của nó không nói tác giả định chọn bên nào. Viết sai từ (`'DEFINER'`, `'owner'`) cũng hỏng ngay tại dòng đăng ký: `new row for relation "expected_functions" violates check constraint "expected_functions_security_check"`.
- View chỉ được phép khi tạo `WITH (security_invoker = true)` (và phải đăng ký như bảng lớp `content`): view thường đọc bảng bằng quyền của chủ view nên đi vòng qua RLS. Materialized view và foreign table bị cấm hẳn. Sequence không được cấp cho vai trò nào.
- `02-meta.sql` xóa sạch sổ đăng ký ở đầu mỗi lần migrate rồi các file sau đăng ký lại: sổ luôn là đúng những gì các file hiện tại khai báo, không sót dòng của thứ đã bị đổi tên hay gỡ bỏ. Vì vậy luôn migrate trọn bộ; chạy riêng lẻ `02-meta.sql` làm trống sổ.
- **Không dùng extension có hàm** (ví dụ `pgcrypto`). Cổng 1 xét mọi schema không thuộc PostgreSQL, nên đặt extension vào schema riêng cũng không thoát: từng hàm của nó sẽ phải đăng ký và bị gỡ khỏi `PUBLIC`. Dùng hàm có sẵn của PostgreSQL: `sha256()`, `gen_random_uuid()`. Thật sự cần một extension thì đó là một thay đổi có chủ ý của `90-verify.sql`, kèm ca đột biến.

## Ba cổng kiểm

Mỗi cổng mù ở chỗ cổng khác nhìn thấy.

| Cổng | Lệnh | Chạy bằng | Chứng minh |
|---|---|---|---|
| 1. Lược đồ tự kiểm | `npm run db:verify` | superuser | Catalog đúng thiết kế: vai trò, quyền, RLS, policy, hàm. |
| 2. API check | `npm run db:api-check` | đúng vai trò ứng dụng (`app_conn` rồi chuyển vai) | Một request thật làm được gì: đi đúng đường của kẻ tấn công, trên cơ sở dữ liệu có dòng của "người khác" để tìm. |
| 3. Mutation check | `npm run db:mutation-check` | superuser | Cổng 1 có *biết kêu* không: phá từng hàng rào một và đòi cổng 1 phải báo lỗi nêu đúng tên thứ bị phá. |

Cổng 1 không biết một request thật làm được gì; cổng 2 không biết thiết kế định nói gì; cả hai đều không biết phép kiểm của chính mình còn sống hay đã mục. Một file tự kiểm luôn xanh và một file tự kiểm đã mục trông giống hệt nhau, và cổng 3 là thứ phân biệt chúng.

### Cổng 1 kiểm những gì

`90-verify.sql` ném exception nêu tên đối tượng cho từng vi phạm. Nó mô tả trạng thái **còn nguyên** và so bằng dấu bằng; mọi thứ không nằm trong mô tả là vi phạm, bất kể ai nắm giữ. Quyền được đọc thẳng từ ACL trong catalog (`aclexplode`), không hỏi `has_*_privilege` cho một danh sách vai trò: quyền cấp cho một vai trò không ai nghĩ tới vẫn là quyền.

1. **Vai trò.** `app_conn` là `LOGIN NOINHERIT`; không vai trò `app_*` nào khác đăng nhập được; không vai trò `app_*` nào là superuser, `BYPASSRLS`, `CREATEROLE`, `CREATEDB`, `REPLICATION`. Quan hệ thành viên có dính tới một vai trò `app_*` (ở cả hai chiều) chỉ gồm đúng ba dòng: `app_conn` trong `app_anon`, `app_auth`, `app_job` với `INHERIT FALSE, SET TRUE`, không `ADMIN`. Không vai trò `app_*` nào là thành viên của vai trò khác (kể cả `pg_read_all_data`), và không vai trò ngoài nào là thành viên của một vai trò `app_*`.
2. **Thiết lập lưu sẵn và quyền trên tham số.** `pg_db_role_setting` không có dòng nào áp dụng cho một vai trò `app_*` trong cơ sở dữ liệu này (`ALTER ROLE … SET`, `ALTER DATABASE … SET`, `ALTER ROLE ALL SET`). `pg_parameter_acl` không cấp tham số cấu hình nào cho một vai trò `app_*` hay `PUBLIC` (`GRANT SET ON PARAMETER …`).
3. **Sở hữu.** Không cơ sở dữ liệu, schema, bảng, view, sequence hay hàm nào thuộc sở hữu của một vai trò `app_*`: chủ sở hữu không cần GRANT và không chịu policy. Hơn thế, mọi bảng, view, sequence và hàm của dự án thuộc về **đúng một** vai trò: vai trò sở hữu schema `meta`, tức vai trò chạy các file SQL, so bằng dấu bằng. Chủ của một bảng không chịu policy của bảng đó và cấp lại được nó; hàm `SECURITY DEFINER` chạy bằng quyền của chủ nó và chủ nó thay được thân hàm. Một đối tượng bị trao cho vai trò khác, kể cả vai trò ngoài bộ `app_*`, bị báo `table … is owned by <vai trò>: every table, view, sequence and function of ours belongs to <chủ của meta> …` (hoặc `view …`, `sequence …`, `function …`). Khi chủ mới là một vai trò `app_*` thì câu "is owned by app role" trả lời trước: đó là trường hợp nặng nhất và câu đó nói đúng lý do.
4. **Sổ đăng ký tự nó hợp lệ, và khớp catalog.** Mỗi dòng đăng ký bảng có lớp thuộc bốn lớp và đúng những gì lớp cho phép (`own_read`, `content`: chỉ `{SELECT}`; `internal`: không gì; `own_rw`: chỉ trong `SELECT`, `INSERT`, `UPDATE`, `DELETE`; `owner_column` có với `own_*`, rỗng với hai lớp kia); mỗi dòng đăng ký hàm chỉ nêu `app_anon`, `app_auth`, `app_job`. Mọi bảng và view trong `public` đều đã đăng ký; mọi bảng đã đăng ký đều tồn tại; cột `owner_column` và các cột `UPDATE` đã đăng ký đều tồn tại. Mọi hàm trong `public`, `app`, `meta` đều đã đăng ký; mọi hàm đã đăng ký đều tồn tại; hàm nội bộ (tên bắt đầu bằng `_` ở bất kỳ schema nào, và `meta.*`) đăng ký với tập vai trò rỗng.
5. **View, rule, trigger và các đối tượng của cả cơ sở dữ liệu.** View phải là `security_invoker`; không có materialized view, không có foreign table. **Rule (`CREATE RULE`) bị cấm trên mọi bảng**: phần một rule thêm vào câu lệnh chạy bằng quyền của chủ bảng, vượt qua mọi GRANT và policy, mà không phải là một hàm đã đăng ký. (View chỉ có đúng rule `_RETURN` làm nên nó.) **Trigger chưa được phép** trên bất kỳ bảng nào của dự án: trigger chạy hàm của nó ở mọi lần ghi vào bảng, bất kể ai ghi, và `ENABLE ALWAYS` hay hàm `SECURITY DEFINER` quyết định nó chạy lúc nào, bằng quyền ai; chưa có sổ nào đăng ký trigger nên trạng thái còn nguyên là không có trigger nào (`trigger "…" on … is not allowed yet`; trigger nội bộ của khóa ngoại không tính). Cũng không có **event trigger** (hàm của nó chạy bên trong lệnh của mọi vai trò, kể cả chủ sở hữu), **publication** (đưa dòng ra khỏi cơ sở dữ liệu, không qua GRANT hay policy nào), **foreign-data wrapper** hay **foreign server** nào.
6. **RLS** bật với các lớp `own_read`, `own_rw`, `internal`. **Lớp là một lời khai**, nên bảng `content` còn bị xét theo khóa ngoại: nó chỉ được tham chiếu bảng `content` khác. Bảng `content` có khóa ngoại tới bảng thuộc lớp khác (hay tới bảng chưa đăng ký) là dữ liệu người dùng bị khai nhầm lớp, và mọi người đã đăng nhập sẽ đọc được toàn bộ.
7. **Quyền, đọc từ ACL, bằng đúng tập mong đợi** (`WITH GRANT OPTION` cũng là sai lệch):
   - cơ sở dữ liệu: chỉ mặc định `CONNECT` và `TEMPORARY` cho `PUBLIC` (không ai có `CREATE`);
   - schema: chỉ `USAGE` trên `public` và `app` cho `app_anon`, `app_auth`, `app_job`; `meta` không cấp cho ai; không ai có `CREATE`;
   - bảng và view: chỉ `app_auth`, đúng tập quyền đã đăng ký; bảng ngoài `public` không cấp cho ai;
   - cột: chỉ `UPDATE` cho `app_auth` trên đúng các cột đã đăng ký; không có quyền theo cột nào khác;
   - sequence: không cấp cho ai;
   - hàm: `EXECUTE` cho đúng tập vai trò đã đăng ký;
   - **quyền mặc định** (`pg_default_acl`: thứ mà bảng, sequence hay hàm *tạo sau này* sinh ra đã có): không dòng nào cấp gì cho ai ngoài chính vai trò của dòng đó, kể cả dòng theo schema (`ALTER DEFAULT PRIVILEGES IN SCHEMA …`); và mặc định `EXECUTE` cho `PUBLIC` trên hàm phải đang bị gỡ với vai trò sở hữu các hàm của dự án. `ALTER DEFAULT PRIVILEGES GRANT INSERT ON TABLES TO app_auth` vì thế đỏ ngay, không chờ tới khi có bảng mới.

   Chủ sở hữu được xét trước những gì suy ra từ nó: một bảng thuộc về vai trò `app_*` được báo là "owned by app role", không phải là sai lệch quyền trên cột của nó (chủ sở hữu không cần GRANT nên các quyền đó biến khỏi ACL). Cũng vậy với sequence của cột `IDENTITY`, vốn đổi chủ theo bảng: bảng được xét trước sequence, nên câu trả lời nêu tên bảng. Hàm được xét trước quyền mặc định của chủ nó.
8. **Policy** trên mỗi bảng là đúng các policy đã đăng ký: `PERMISSIVE`, `TO app_auth`, cùng lệnh, biểu thức `USING` và `WITH CHECK` bằng nguyên văn; bảng `internal` không có policy nào.
9. **Thiết lập của hàm `SECURITY DEFINER`** phải là đúng một `SET search_path` với một trong hai giá trị `public, pg_temp` hoặc `pg_catalog, pg_temp`, **và không có `SET` nào khác** (một `SET session_replication_role = replica` đi kèm sẽ tắt trigger trong thân hàm). Không đặt, đặt `public` (thiếu `pg_temp` ở cuối), hay `pg_temp, public` đều bị từ chối: mọi vai trò đều tạo được bảng tạm, và bảng tạm trùng tên sẽ che bảng thật trong thân hàm đặc quyền.
   **Hàm `SECURITY INVOKER` cũng vậy khi nó có `SET`**: hoặc không `SET` gì (khi đó nó dùng `search_path` của hàm gọi nó), hoặc đúng một trong hai giá trị trên và không gì khác. Hàm nội bộ được một hàm `SECURITY DEFINER` gọi thì chạy bằng quyền chủ sở hữu với thiết lập của chính nó. Đã chạy thử: `app._throttle_hit` với `search_path = pg_temp, public` ghi bộ đếm đăng nhập sai vào bảng tạm của người gọi, bảng thật không nhận dòng nào.
10. **Chế độ của hàm** (chạy bằng quyền ai) bằng đúng chế độ đã đăng ký: `prosecdef` của catalog so với `'definer'` / `'invoker'` trong `meta.expected_functions`, bằng dấu bằng. Đổi chế độ một mình (`ALTER FUNCTION … SECURITY INVOKER`), hay đổi cùng lúc với thiết lập cho hàm trông vẫn chỉnh tề ở chế độ mới (`… SECURITY DEFINER SET search_path = public, pg_temp`, `… SECURITY INVOKER RESET search_path`), đều bị báo `function security: … found: <chữ ký> is SECURITY …, registered …`. Sổ đăng ký chỉ nhận hai giá trị đó: một từ khác hỏng ngay ở dòng đăng ký (ràng buộc `expected_functions_security_check`), và nếu một dòng sai vẫn lọt vào sổ bằng đường khác thì cổng 1 báo `registry: function …: the security mode is definer or invoker`. Cổng 1 **không** suy chế độ từ tên hay từ `SET`: hàm nội bộ `_…` được phép là `definer` (hàm trigger phải ghi bảng nội bộ), hàm gọi được được phép là `invoker` có `SET search_path` (đọc dưới RLS của người gọi), miễn là file khai đúng như vậy. Không hàm nào của dự án là `LEAKPROOF`: đó là lời hứa rằng hàm không để lộ gì về tham số, và planner được phép chạy hàm như vậy trên những dòng RLS **chưa** lọc.
11. `meta.test_clock` rỗng.

Giới hạn cần biết: phép so ACL coi mọi quyền ngoài mô tả là vi phạm, nên một vai trò vận hành (sao lưu, đọc báo cáo) được cấp quyền trực tiếp trên bảng sẽ làm cổng 1 đỏ; quyền `CONNECT` cấp riêng cho `app_conn` trên cơ sở dữ liệu cũng vậy, và một vai trò quản trị không phải superuser tạo ra các vai trò `app_*` sẽ tự có quan hệ thành viên `ADMIN` với chúng. Muốn có những thứ đó thì sửa mô tả trong `90-verify.sql` cùng một ca đột biến tương ứng, không nới phép so. Tương tự, cổng 1 từ chối **mọi** event trigger và publication trong cơ sở dữ liệu: dự án tự vận hành PostgreSQL nên không có cái nào; trên một dịch vụ PostgreSQL thuê ngoài, event trigger hay publication do nhà cung cấp cài sẵn sẽ làm cổng 1 đỏ dù lược đồ đúng, và khi đó phải nêu đích danh chúng trong `90-verify.sql`.

`server/checks/verify.test.ts` chạy ba việc trên lược đồ thật (áp dụng lại toàn bộ file SQL trên một cơ sở dữ liệu đã có lược đồ và xác nhận catalog không đổi một dòng nào; chạy `90-verify.sql`; xác nhận nó báo lỗi khi `meta.test_clock` có dòng), rồi dựng một lược đồ mẫu có đủ bốn lớp và phá lần lượt từng hàng rào, mỗi lần đòi đúng SQLSTATE `P0001` và đúng phần đầu thông báo nêu tên thứ bị phá. **Thêm hay siết một phép kiểm trong `90-verify.sql` thì thêm ca đột biến của nó vào file test này trong cùng thay đổi.** Cổng 3 lặp lại phép chứng minh đó trên toàn bộ bảng, policy và hàm thật (xem "Cổng 3: mutation check").

## Cổng 2: API check và dòng mồi nhử

`npm run db:api-check` chạy `server/checks/api-check.test.ts`. Mọi thứ được thử đều đi qua `app_conn`, đúng vai trò ứng dụng kết nối, với đúng phép chuyển vai của một request (`asUser`, `asAnon`, `asJob`); kết nối superuser chỉ đọc sổ đăng ký, dựng dữ liệu và đọc lại kết quả. Cổng 1 hỏi catalog "thiết kế có đúng không"; cổng này hỏi "một request thật, của một người có tài khoản hợp lệ, làm được gì với dữ liệu của người khác".

Nó gồm ba phần, trong cùng một file:

1. **Mười hai phép kiểm chung**, sinh từ sổ đăng ký `meta.expected_*` và catalog. Bảng hay hàm do một file SQL sau này thêm vào được phủ ngay, không ai phải sửa file cổng.
2. **Các ca tấn công** trong `server/checks/attacks/*.ts`: những việc riêng của từng mảng mà phép kiểm chung không biết (hàm nghiệp vụ, luồng xác thực).
3. **Các ca đối chứng**, trên một cơ sở dữ liệu riêng: phá lần lượt từng hàng rào và đòi phép kiểm tương ứng phải đỏ, nêu đúng thứ bị phá; sửa lại rồi nó phải xanh trở lại.

### Dòng mồi nhử: vĩnh viễn, không bao giờ được dọn

"A không đọc được dữ liệu của B" luôn đạt trên một cơ sở dữ liệu mà B không có dòng nào: truy vấn trả 0 dòng dù RLS còn hay mất. Vì vậy **B tồn tại vĩnh viễn, trong mọi cơ sở dữ liệu mà lược đồ này được áp dụng**, kể cả production. `server/sql/80-decoy-base.sql` tạo hai tài khoản:

| | id | email |
|---|---|---|
| `DECOY_1` | `00000000-0000-4000-8000-0000000000d1` | `decoy-1@decoy.invalid` |
| `DECOY_2` | `00000000-0000-4000-8000-0000000000d2` | `decoy-2@decoy.invalid` |

`DECOY_1` có ít nhất một dòng trong mọi bảng chứa dữ liệu người dùng đang có: `users`, `credentials`, `sessions` (một phiên đã thu hồi nhưng chưa hết hạn), `reset_codes` (đã dùng, đã hết hạn), `idempotency_keys` (một câu trả lời `200` đã lưu), `progression_state`, `xp_ledger`, `coin_ledger`, `inventory` và `perk_unlocks` (trỏ tới vật phẩm đã seed `THEME_FOREST` theo `code`), `biometric_snapshots`, `prescriptions`, `user_settings`; và, từ `81-decoy-day.sql`, `daily_logs`, `quest_completions`, `quest_ticks` (một ngày có một lượt tick của nhiệm vụ đã seed `WATER_8`); và, từ `82-decoy-story.sql`, `nutrition_logs`, `workout_sessions` (một lần ghi calo và một buổi tập của bài tập đã seed `DESK_STRETCH`, trên ngày đó); và, từ `83-decoy-dayclose.sql`, `freeze_tickets`, `ticket_grant_weeks`, `notifications` (một vé đã dùng cho ngày đó, tuần của vé, một thông báo chưa đọc). `DECOY_2` chỉ có dòng `users`; các mảng cần hai người (bang hội, nudge) dùng nó.

- **Không bao giờ xóa hay "dọn" dòng mồi nhử**, bằng tay hay bằng job. Job xóa dữ liệu cũ (phiên hết hạn, mã đã dùng, khóa idempotency quá 7 ngày, tài khoản quá hạn xóa) phải bỏ qua người dùng có email kết thúc bằng `@decoy.invalid`. Mất một dòng mồi nhử là cổng 2 đỏ với `no decoy row in <bảng>` (phép kiểm 12, cho mọi bảng có khóa ngoại dẫn về `users`). Lưu ý: cổng chạy trên bản sao mới của cơ sở dữ liệu mẫu, nơi chưa job nào chạy, nên nó **không** bắt được một job xóa nhầm; job nào xóa dữ liệu thì tự mang ca tấn công của mình (chạy job với đồng hồ đẩy xa về sau, rồi đòi dòng mồi nhử còn nguyên).
- File chạy lặp lại được: id cố định và `ON CONFLICT DO NOTHING`. Chạy lại migrate đưa về những dòng đã mất, không sửa dòng đang có.
- Dòng do chủ sở hữu lược đồ ghi nên **đi vòng qua mọi hàm**; chúng vẫn phải thỏa mọi `CHECK` và khóa ngoại.
- **Với ứng dụng, mồi nhử là một tài khoản thật, không phải dòng chết.** Mọi hàm và mọi route coi nó như bất kỳ tài khoản nào: email của nó đã bị chiếm, `auth_salt` trả salt thật của nó, và `POST /auth/password/forgot` với email của nó lưu một mã đặt lại còn hiệu lực (tối đa 3 mã mỗi giờ, như mọi tài khoản). Thứ giữ nó đóng là: **không ai đăng nhập được** (khóa mật khẩu ngẫu nhiên, sinh trong SQL và không ai biết; phiên có sẵn đã thu hồi; mã đặt lại có sẵn đã dùng và đã hết hạn; các bản băm cố định không phải là bản băm của bất cứ thứ gì) và **không thư nào được gửi cho nó** (xem dòng dưới). `onboarded_at` để `NULL` để không job nào xử lý nó.
- **Không gửi thư tới địa chỉ `.invalid`.** `.invalid` là tên miền cấp cao dành riêng (RFC 2606), không hộp thư nào tồn tại ở đó. Route `POST /auth/password/forgot` bỏ qua đúng một bước cho địa chỉ kết thúc bằng `.invalid`: giao thư cho mailer. Câu trả lời (`202 {}`), dòng mã được lưu và thời gian trả lời giữ nguyên như với mọi tài khoản, nên route vẫn đồng nhất (có test). Route nào sau này gửi thư cho người dùng cũng phải giữ luật đó.
- **Không bao giờ làm với mồi nhử:** đặt cho nó một mật khẩu biết trước, mở lại phiên của nó, cho nó `onboarded_at`, dùng nó làm tài khoản thử trong môi trường thật, hay tạo dữ liệu "cho đẹp" khiến một job hoặc một bảng xếp hạng nhìn thấy nó. Trạng thái của nó cố ý là trạng thái không hàm nào tạo ra (chưa onboarding mà đã có đơn kê, cài đặt, sổ cái): job hay read model nào lọc theo `progression_state` hoặc sổ cái thay vì `users.onboarded_at` sẽ xử lý nhầm nó.
- Dòng mồi nhử được tìm **theo khóa ngoại, không theo lớp đã đăng ký**: mọi bảng trong `public` có khóa ngoại tới `users`, trực tiếp hay qua một bảng như vậy, đều phải có ít nhất một dòng dẫn về `DECOY_1` (bảng con của một bảng con: dòng của nó phải trỏ tới dòng của mồi nhử ở bảng cha). Xem phép kiểm 12.
- Dòng mồi nhử cần nội dung thì tham chiếu nội dung đã seed theo `code`, không bao giờ tạo một dòng nội dung mồi nhử mà người dùng thật có thể được phục vụ.
- Các giá trị cố định (id, email, bản băm) được lặp lại trong `server/checks/attacks/base.ts`: sửa một bên thì sửa cả hai.

### Mỗi hàng rào trả lời bằng thông báo của chính nó

Mọi phép kiểm chung đòi **đúng** SQLSTATE `42501` **và đúng nguyên văn thông báo**, trong đó có tên hàng rào và tên đối tượng. Bảng dưới là kết quả đo trên lược đồ còn nguyên (lệnh luôn ghi tên schema), và là thứ duy nhất được coi là đạt:

| Vai trò | Đối tượng | Thông báo (`42501`) |
|---|---|---|
| `app_conn` trần (chưa chuyển vai) | bất kỳ bảng hay hàm nào trong `public`, `app`, `meta` | `permission denied for schema <schema>` |
| `app_anon`, `app_auth`, `app_job` | bất kỳ thứ gì trong `meta` | `permission denied for schema meta` |
| `app_anon`, `app_job` | mọi bảng trong `public`, mọi lệnh | `permission denied for table <bảng>` |
| `app_auth` | bảng `internal`: mọi lệnh; bảng `own_read`, `content`: mọi lệnh ghi; bảng `own_rw`: lệnh và cột ngoài phần đã đăng ký; `TRUNCATE` trên mọi bảng | `permission denied for table <bảng>` |
| `app_auth` | `INSERT` đã được cấp, dòng mang id của người khác | `new row violates row-level security policy for table "<bảng>"` |
| `app_auth` | `UPDATE` / `DELETE` đã được cấp, **không có `WHERE`** | không lỗi, số dòng **bằng đúng số dòng của chính A** (đọc bằng superuser) |
| `app_anon`, `app_auth`, `app_job` | hàm trong `public` hoặc `app` mà vai trò đó không được đăng ký | `permission denied for function <tên hàm>` |

Hàng rào của `app_conn` trần đứng **sớm hơn một lớp** so với các vai trò kia: nó không có `USAGE` trên schema nào, nên bị chặn trước khi PostgreSQL nhìn tới bảng hay hàm. Vì vậy phép kiểm 1 đòi `permission denied for schema public`, không phải `permission denied for table`.

Mọi kết quả khác là **hỏng phép kiểm**, không bao giờ là đạt: một lỗi khác (`P0001`, `23502`, `42883`, `42P01`: câu lệnh đã lọt qua hàng rào rồi hỏng ở chỗ khác), một từ chối khác (hàng rào khác trả lời thay), hay một kết quả trả về. Không phép kiểm nào chấp nhận "42501 bất kỳ", và không phép kiểm nào chấp nhận hai thông báo.

### Mười hai phép kiểm chung

| # | Phép kiểm | Đếm |
|---|---|---|
| 1 | `app_conn` trần `SELECT` từng bảng: bị chặn ở schema. | bảng |
| 2 | `app_anon` và `app_job`: `SELECT`, `INSERT`, `DELETE`, `TRUNCATE` và `UPDATE` **từng cột** trên từng bảng bị chặn ở GRANT. (`TRUNCATE` không chịu RLS và bảng `content` không có RLS: chỉ dò `SELECT` là để lọt một quyền ghi cấp nhầm.) | vai trò × bảng, số câu lệnh |
| 3 | Bảng `own_read`, `own_rw`: mồi nhử có dòng (đọc bằng superuser; không có thì `no decoy row in <bảng>`); người dùng A lọc theo id của mồi nhử, rồi theo id của **B, một người dùng thường thứ hai**, (qua `owner_column` đã đăng ký) đều thấy 0 dòng; `SELECT` không lọc chỉ trả dòng của A; A thấy ít nhất một dòng của chính mình và B có dòng ở ít nhất một bảng. B cần có vì mồi nhử chỉ là một *kiểu* dòng (ẩn chuỗi ngày, chưa onboarding): một policy phụ thuộc dữ liệu có thể che mồi nhử mà để lộ người thường. | bảng |
| 4 | Bảng `own_read`: `INSERT`, `DELETE`, `TRUNCATE` và `UPDATE` **từng cột** bằng A bị chặn ở GRANT (không phải ở policy). | bảng, số câu lệnh |
| 5 | Bảng `own_rw`: `INSERT` đã cấp mang id mồi nhử nhận thông báo của policy; `UPDATE` **từng cột được cấp** và `DELETE` đã cấp chạy bằng A **không có `WHERE`**, trong transaction được hoàn lại, và số dòng phải **bằng đúng số dòng của A**; lệnh và cột chưa cấp thì dừng ở GRANT. | bảng, số cột mỗi loại |
| 6 | Bảng `internal`: `SELECT` và mọi lệnh ghi bằng A bị chặn ở GRANT. Bảng `content`: mọi lệnh ghi. | bảng, số câu lệnh |
| 7 | Mọi hàm đã đăng ký: từng vai trò trong `app_conn`, `app_anon`, `app_auth`, `app_job` **không** nằm trong tập đã đăng ký gọi hàm với `NULL` ép đúng kiểu từng tham số; hàm `STRICT` được gọi với **giá trị** của từng kiểu (xem dưới). | vai trò × hàm |
| 8 | Mọi hàm nội bộ (tên bắt đầu bằng `_`, lấy từ catalog, đã đăng ký hay chưa): A không gọi được. | hàm |
| 9 | `INSERT INTO meta.test_clock` bằng cả bốn vai trò: bị chặn ở schema. | vai trò |
| 10 | `app_auth` không mang user id thấy 0 dòng trong mọi bảng `own_*`, ở cả hai dạng: thiết lập đã bị xóa về `''` (kết nối trong pool sau request đầu tiên) và thiết lập chưa từng được đặt (kết nối mới). | bảng |
| 11 | Mọi quan hệ (bảng, view) ngoài schema `meta` và mọi hàm trong các schema của dự án đều **đã đăng ký**; thứ chưa đăng ký là thứ không phép kiểm nào ở trên nhìn tới, nên cổng đỏ và nêu tên nó (`not registered: relation …, function …`). Sổ đăng ký chỉ gọi tên được bảng trong `public`: một bảng ở schema `app` luôn bị báo. | đối tượng (quan hệ, hàm), số chưa đăng ký |
| 12 | **Lớp đã đăng ký chỉ là lời khai; thứ gì chứa dữ liệu người dùng được đọc từ khóa ngoại.** Mọi bảng trong `public` có chuỗi khóa ngoại dẫn về `users`: không được đăng ký là `content` (đỏ: `<bảng> is registered as content, but it has a foreign key chain to users`), và phải có dòng dẫn về `DECOY_1`, bất kể lớp (đỏ: `no decoy row in <bảng>`). | bảng có chuỗi khóa về `users` |

Đầu ra của cổng liệt kê từng phép kiểm cùng số đối tượng nó đã phủ. **Phép kiểm phủ 0 đối tượng là đỏ**, không phải đạt.

Bốn cách một phép kiểm tự lừa mình, và chỗ cổng này tránh từng cách:

- **Liệt kê trạng thái còn nguyên, không liệt kê trạng thái đã hỏng.** Đạt khi và chỉ khi đúng `42501` và đúng thông báo. Hàm bị cấp nhầm `EXECUTE` rồi hỏng ở `auth_login: key and token hash must be 32 bytes each` là một lỗi có thật nhưng không nói gì về quyền: ca đối chứng của phép kiểm 7 chính là trường hợp đó, và nó đỏ.
- **Cùng mã `42501` nói hai chuyện.** Thông báo được so nguyên văn, nên "thiếu GRANT" và "policy chặn" không bao giờ thay được cho nhau. Cấp nhầm `INSERT` trên một bảng `own_read` thì câu lệnh vẫn bị từ chối bằng `42501`, nhưng bởi policy: phép kiểm 4 đỏ.
- **Không áp một khuôn cho mọi hàng rào.** Thông báo mong đợi được tính từ lớp của bảng và từ quyền đã đăng ký: bảng không ai được ghi đòi thông báo của GRANT, lệnh đã được cấp đòi thông báo của policy hoặc 0 dòng.
- **Phép kiểm không có gì để tìm thì luôn đạt.** Dòng mồi nhử là thứ để tìm; phép kiểm 3, 5, 10 và 12 xác nhận bằng superuser rằng dòng đó có mặt trước khi tin vào "0 dòng", phép kiểm 3 còn cần một người dùng thường thứ hai, và mỗi ca tấn công kiểm tra tiền đề của nó.

Mỗi câu lệnh dò chỉ cần **đúng một thứ**, là thứ đang được dò:

- **Dò GRANT**: `INSERT … DEFAULT VALUES`, `UPDATE … SET cột = DEFAULT WHERE false`, `DELETE … WHERE false`, `TRUNCATE`. Một câu lệnh đọc thêm cột (`SET c = c`, `WHERE user_id = …`) sẽ bị từ chối vì thiếu `SELECT` và che mất một quyền ghi bị cấp nhầm trên bảng `internal`. `UPDATE` được dò **từng cột** vì quyền có thể được cấp trên một cột.
- **Dò policy `UPDATE` / `DELETE`**: câu lệnh **không có `WHERE`** và không đọc cột nào (`UPDATE … SET cột = <giá trị truyền vào>`, `DELETE FROM …`), chạy bằng A rồi hoàn lại. PostgreSQL áp policy `SELECT` lên mọi `UPDATE` / `DELETE` có đọc cột, nên `UPDATE … WHERE user_id = <mồi nhử>` trả 0 dòng **chỉ nhờ policy `SELECT`**: policy `UPDATE` có mở toang (`USING (true)`, hay một policy thứ hai đứng cạnh policy đúng) thì "0 dòng" vẫn là 0 dòng, trong khi `UPDATE` không `WHERE` của A ghi đè dòng của mọi người. "0 dòng khi nhắm vào người khác" là một câu trả lời mang hai nghĩa; "đúng số dòng của mình khi không nhắm vào ai" thì không. Giá trị được ghi là giá trị A đang có ở cột đó (của mồi nhử nếu A chưa có dòng), truyền vào dưới dạng chuỗi.
- **Hàm `STRICT`**: PostgreSQL trả `NULL` cho một hàm `STRICT` được gọi với `NULL` **mà không chạy hàm và không kiểm `EXECUTE`**: lời gọi "thành công" với mọi vai trò. Phép kiểm 7 và 8 vì thế gọi hàm `STRICT` với một giá trị cho từng kiểu tham số (số `0`, chuỗi rỗng, `false`, mảng rỗng, uuid toàn số 0, `2000-01-01`, khoảng `0`, `null` của JSON). Kiểu chưa có giá trị trong bảng `LITERAL` của file cổng thì phép kiểm đỏ và nêu tên hàm cùng kiểu đó; thêm kiểu vào `LITERAL`. Hiện chưa hàm nào là `STRICT`.

### Ca tấn công (`server/checks/attacks/<mảng>.ts`)

Mỗi file trong thư mục đó export `attacks`; cổng tự nạp mọi file `.ts` ở đó (file không export một mảng `attacks` khác rỗng làm cổng đỏ). Hợp đồng nằm trong `attacks/base.ts`:

```ts
import type { Attack } from './base.ts';

export const attacks: Attack[] = [
  {
    name: 'A không đọc được nhật ký của mồi nhử qua journal_list',
    async run({ app, admin, userA, decoy, asUser, asAnon, expectPgError }) {
      // admin: xác nhận dòng bị nhắm tới có mặt. app + asUser(app, userA, …): tấn công.
    },
  },
];
```

- `app` là pool `app_conn`; `admin` là superuser, chỉ để dựng và đọc lại; `userA` là một người dùng đã onboarding (kẻ tấn công); `decoy` là `DECOY_1`.
- Ca tấn công đi đúng đường của ứng dụng: `asUser(app, userA, …)` / `asAnon(app, …)`, mỗi lần gọi một transaction. Ca gọi `profile_*` làm như route: `lockProfile` trước, đọc, tính ở Node, rồi ghi.
- Trước khi tấn công, **xác nhận bằng `admin` rằng dòng bị nhắm tới có mặt**.
- `base.ts` export ba thứ dùng chung: `decoyUntouched(ctx, attack)` chạy ca tấn công rồi đòi **mọi dòng của mồi nhử trong mọi bảng có chuỗi khóa về `users`** còn nguyên từng giá trị (thông báo nêu bảng bị đổi: `the attack changed rows of the decoy in: users`); `decoyRows(admin)` trả các dòng đó theo tên bảng; `userDataTables(admin)` trả danh sách bảng cùng mệnh đề `WHERE` chọn dòng của một người dùng. Bảng mới có khóa ngoại về `users` được cả ba tự nhận. Đừng bọc bằng `decoyUntouched` một ca mà kết quả đúng của nó là ghi một dòng cho mồi nhử (mồi nhử nhận một nudge).
- **Policy được dò bằng câu lệnh chỉ cần policy đó**: `UPDATE` / `DELETE` không `WHERE`, hoàn lại, số dòng bằng số dòng của A. Không viết "`UPDATE … WHERE id = <mồi nhử>` trả 0 dòng".
- Từ chối có lỗi thì ghim bằng `expectPgError` (SQLSTATE và phần đầu thông báo); từ chối im lặng thì ghim bằng giá trị trả về hoặc số dòng.

`base.ts` hiện có mười ca cho xác thực, idempotency và hồ sơ: đăng ký bằng email của mồi nhử ở mọi cách viết (`REGISTRATION_UNAVAILABLE`); email trông giống nhưng không ở dạng chuẩn (`VALIDATION_FAILED`); `auth_login` với khóa sai (`NULL`, không phiên nào được mở); `auth_salt` cho email lạ (16 byte, lặp lại được); `auth_session` với bản băm token đã thu hồi của mồi nhử (`NULL`); `auth_reset_confirm` với mã đã dùng và đã hết hạn của mồi nhử (`false`, khóa mật khẩu của mồi nhử không đổi); `idempotency_begin` với khóa và bản băm request của mồi nhử (một khóa mới của A, không phải câu trả lời đã lưu); `profile_add_biometrics` và một lần **đổi hệ phái thật** của A (thời gian chờ được đẩy lùi 15 ngày bằng `admin`, để nhánh `UPDATE users` thật sự chạy: ghi dòng của A, không đổi dòng nào của mồi nhử); `UPDATE users` và `UPDATE user_settings` của A không `WHERE` (mỗi lệnh đúng 1 dòng); múi giờ ngoài bảng `timezones` (`23503`).

### Thêm bảng mới: cổng 2 đòi gì

- **Mọi bảng có khóa ngoại dẫn về `users`** (trực tiếp hay qua bảng khác), dù đăng ký lớp nào, mà `DECOY_1` chưa có dòng: phép kiểm 12 đỏ với `no decoy row in <bảng>` (bảng `own_*` còn làm đỏ phép kiểm 3, 5, 10). Thêm `server/sql/8N-decoy-<mảng>.sql` (số từ 81 tới 89, chạy sau seeder và trước `90-verify.sql`), viết theo các luật ở trên. Dòng của bảng con phải trỏ tới dòng của **mồi nhử** ở bảng cha.
- Bảng có khóa ngoại dẫn về `users` mà đăng ký là `content`: phép kiểm 12 đỏ. Bảng `content` không có policy và mọi người đã đăng nhập đều đọc được; chép nhầm khối đăng ký của một bảng nội dung cho một bảng dữ liệu người dùng là lỗi mà catalog vẫn "khớp với lời khai". Cổng 1 cũng từ chối nó ngay cuối lần migrate (`content table … has a foreign key to …`): bảng `content` chỉ được tham chiếu bảng `content`.
- Hàm mới được phép kiểm 7 và 8 phủ ngay khi đăng ký. Hai trường hợp phải sửa file cổng: tham số kiểu đa hình (`anyelement`…) không gọi được bằng `NULL` ép kiểu, phép kiểm 7 đỏ với lỗi khác `42501`; hàm `STRICT` có tham số thuộc kiểu chưa có trong `LITERAL`, phép kiểm 7 đỏ và nêu tên hàm cùng kiểu.
- Bảng, view hay hàm chưa đăng ký: phép kiểm 11 đỏ và nêu tên. Bảng không được đặt ngoài `public`.
- Schema mới: thêm vào `SCHEMA_USERS` trong file cổng ai được `USAGE` trên nó.
- Thêm một phép kiểm chung thì thêm ca đối chứng của nó trong cùng thay đổi.

### Ca đối chứng

Chạy trên một cơ sở dữ liệu thứ hai, mỗi ca: phép kiểm đang xanh → phá một hàng rào → phép kiểm phải đỏ với thông báo nêu đúng hàng rào và đối tượng → sửa → xanh lại. Cuối cùng cả cổng chạy lại trên cơ sở dữ liệu đó và phải xanh. Hiện có 25 ca trong danh sách: 22 cho mười hai phép kiểm (mỗi phép kiểm ít nhất một; trong đó một ca làm sổ đăng ký rỗng để phép kiểm phủ 0 đối tượng, và các ca chỉ mở **riêng** policy `UPDATE` trong khi policy `SELECT` còn nguyên) và 3 cho ca tấn công (mở riêng policy `UPDATE` của `users`; sửa thân `profile_set_archetype` cho mất `WHERE`; sửa thân `auth_reset_confirm` cho nhận mã đã dùng). Thêm ba ca dùng đối tượng mẫu: bảng `fx_notes` được cấp đủ `INSERT`, `UPDATE`, `DELETE` với mỗi lệnh một policy (các nhánh của phép kiểm 5 mà chưa bảng thật nào đi qua, kể cả mở riêng policy `DELETE`; và điều một nhiệm vụ gặp khi đăng ký bảng mà quên dòng mồi nhử); các bảng `fx_diary`, `fx_vault`, `fx_vault_items` cho phép kiểm 12 (bảng dữ liệu người dùng đăng ký nhầm là `content`; bảng `internal` thiếu dòng mồi nhử; dòng của người khác không được tính, kể cả ở bảng chỉ nối với `users` qua một bảng khác); hai hàm `STRICT` mẫu cho phép kiểm 7 và 8.

### Phần cổng 2 không nhìn thấy

- Sau hàng rào đầu tiên là gì: `app_conn` bị chặn ở schema nên cổng này không biết nó có quyền gì trên bảng; cổng 1 đọc ACL và biết.
- Thân hàm: hàm được gọi với `NULL` chỉ để hỏi quyền. Luật bên trong hàm do test của từng mảng và các ca tấn công giữ.
- `WITH CHECK` của policy `UPDATE` cho phép A trao dòng của mình cho người khác: không được thử ở đây (cột chủ sở hữu hiếm khi được cấp `UPDATE`); cổng 1 so `WITH CHECK` nguyên văn.
- Phép kiểm 5 ghi **một** giá trị cho mọi dòng của A: bảng `own_rw` mà A có nhiều dòng và cột được cấp lại là cột duy nhất sẽ cần một câu lệnh cho mỗi dòng. `DELETE` không `WHERE` của A cũng sẽ vấp một khóa ngoại `RESTRICT` trỏ vào dòng của A. Chưa bảng nào như vậy; khi có thì sửa phép kiểm, đừng nới nó.
- View đăng ký là `content` mà hiện dữ liệu người dùng: view không có khóa ngoại nên phép kiểm 12 không thấy.
- Job: cổng chạy trên bản sao mới, chưa job nào chạy. Job xóa nhầm dòng mồi nhử không làm cổng đỏ nếu job đó không có ca tấn công riêng.
- `ALTER DEFAULT PRIVILEGES … TO app_auth` chỉ có hiệu lực với bảng tạo sau đó: cổng này không thấy cho tới khi một bảng mới xuất hiện. Cổng 1 đọc `pg_default_acl` và thấy ngay.
- HTTP: route quên kiểm tra phiên, thân response lộ dữ liệu. Đó là test của từng route.

## Cổng 3: mutation check

`npm run db:mutation-check` chạy `server/checks/mutation-check.test.ts`. Cổng 1 xanh trên một lược đồ đúng, và một cổng 1 đã mục cũng xanh y như vậy. Cổng 3 phân biệt hai thứ đó: nó **phá từng hàng rào một lần, có chủ ý**, chạy lại nguyên văn `90-verify.sql`, và đòi cổng 1 phải báo lỗi **nêu đúng thứ vừa bị phá**. `verify.test.ts` làm việc đó trên một lược đồ mẫu viết tay, từng câu một; cổng 3 làm trên lược đồ thật, với đột biến được **liệt kê từ catalog và sổ đăng ký**, nên bảng, policy hay hàm của một file SQL sau này được phủ mà không ai phải sửa file cổng.

### Cách chạy

- Một bản sao của cơ sở dữ liệu mẫu, một kết nối superuser. Mỗi đột biến: `BEGIN` → câu lệnh phá hàng rào → toàn bộ `90-verify.sql` → đòi exception → `ROLLBACK`. Không tạo lại bản sao cho từng đột biến; cả cổng chạy trong khoảng một phút (lược đồ thật khoảng 25 giây, lược đồ "tương lai" ở dưới khoảng 30 giây).
- Trước đột biến đầu tiên `90-verify.sql` phải đạt trên bản sao còn nguyên; sau đột biến cuối cùng nó phải đạt lần nữa, qua một **kết nối mới**.
- In một dòng `PASS <đột biến> -> "<thông báo của cổng 1>"` cho từng đột biến, rồi số đột biến của từng lớp và dòng tổng `mutation-check: N of N detected, … classes`.

### Một đột biến, một câu trả lời

Đạt ⟺ SQLSTATE `P0001` (exception do chính `90-verify.sql` ném) **và** thông báo chứa mọi mảnh đã ghi cho đột biến đó, trong đó **mảnh thứ nhất phải đứng ở đầu thông báo** (hoặc ở đầu mục thứ nhất sau `found: `). Mọi kết cục khác là hỏng, mỗi kết cục một tên:

| Cổng 3 in ra | Nghĩa |
|---|---|
| `verify did not raise` | Cổng 1 mù với hàng rào đó, hoặc đột biến không đổi gì cả. |
| `raised for the wrong reason: "…" does not name "…"` | Cổng 1 có kêu, nhưng vì một thứ khác: phép khẳng định đang thử có thể đã chết. |
| `the mutation did not apply: <SQLSTATE> "…"` | Câu lệnh phá không chạy được. Không bao giờ được tính là đạt hay bỏ qua. |
| `verify crashed instead of refusing: …` | Cổng 1 vỡ với một lỗi không phải của nó. |
| `class "…": covered 0` | Một lớp không liệt kê được đối tượng nào. |

- **Mảnh được viết theo đúng câu của phép khẳng định đang thử**, không chỉ là tên đối tượng: `table users: grants are` cùng `app_job:TRUNCATE`, chứ không phải `users`. Lý do có thật: sau `ALTER TABLE users OWNER TO app_auth`, phép so quyền cũng lệch, và câu của nó cũng chứa cả `users` lẫn `app_auth`. Chính ca này đã lộ ra khi cổng 3 chạy lần đầu: cổng 1 trả lời bằng sai lệch quyền trên cột thay vì "owned by app role".
- Tên được so **nguyên từ**: `users` không nằm trong `user_settings` hay `app.users`. Mảnh thứ nhất là chủ ngữ của câu và chỉ được tính ở chỗ câu bắt đầu: `schema public: grants are` cũng nằm giữa thông báo về quyền mặc định `… in schema public: grants are …`, và không được tính ở đó.
- Chỉ liệt kê thứ lược đồ còn nguyên **chưa có** (quyền chưa được cấp, quan hệ thành viên chưa tồn tại). Một đột biến cấp lại thứ đã có sẽ không đổi gì và bị báo `verify did not raise`.
- Cổng tự thử mình bằng bảy cái bẫy, mỗi cái phải bị báo đúng tên: `SELECT 1` (không phá gì), một đột biến thật khai tên bảng khác, một đột biến thật khai một tên chỉ là một phần của tên trong thông báo, một đột biến thật khai một mảnh có trong thông báo nhưng không ở đầu câu, một câu lệnh không chạy được, một đột biến không khai mảnh nào, một lớp rỗng.

### Các lớp đột biến

Số trong ngoặc là của lược đồ lúc viết mục này (19 bảng trong `public`, 4 bảng trong `meta`, 11 policy, 29 hàm): 1565 đột biến trong 54 lớp.

| Liệt kê theo | Đột biến | Cổng 1 phải nói |
|---|---|---|
| mỗi bảng có RLS (15) | `DISABLE ROW LEVEL SECURITY` | `table … (lớp): row level security is off` |
| mỗi bảng và view của dự án, kể cả `meta` (23 mỗi loại) | `OWNER TO app_auth`; `OWNER TO` một vai trò mới ngoài bộ `app_*` (tạo ngay trong transaction) | `table … is owned by app role app_auth`; `table … is owned by <vai trò>` |
| mỗi bảng (23) | `CREATE RULE … DO ALSO NOTHING`; một trigger `ENABLE ALWAYS` gọi một hàm đã đăng ký | `rule "…" on … is not allowed`; `trigger "…" on … is not allowed yet` |
| mỗi bảng, view và **sequence** × `PUBLIC` và từng vai trò `app_*` × **mọi loại quyền mà PostgreSQL có cho loại đối tượng đó** (đọc từ `acldefault`: với bảng là `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`) mà bên đó chưa có (907) | `GRANT … ON … TO …` | `table …: grants are` (hoặc `view …`, `sequence …`) kèm `<vai trò>:<quyền>` |
| mỗi quyền mức bảng mà một vai trò `app_*` đang có (13) | cấp lại `WITH GRANT OPTION` | `table …: grants are` kèm `<vai trò>:<quyền>*` |
| mỗi bảng: cột đầu tiên chưa đăng ký `UPDATE` (23) | `GRANT UPDATE (cột) … TO app_auth` | `column bảng.cột: grants are` kèm `app_auth:UPDATE` |
| mỗi bảng không phải `content` có khóa chính (15) | tạo bảng có khóa ngoại tới nó, cấp `SELECT`, đăng ký là `content` | `content table … has a foreign key to … (lớp)` |
| mỗi bảng (không tính view) × mỗi lệnh bảng cấp cho `app_auth`; `FOR ALL` với bảng không cấp gì (21) | thêm policy thứ hai `… TO app_auth USING (true)` | `policy "…" on table … is not registered`, hoặc `internal table … has policy "…"` |
| mỗi policy, mỗi biểu thức `USING` / `WITH CHECK` (13) | tạo lại với `(<nguyên bản>) OR true` | `policy "…" on table …: USING is` / `WITH CHECK is` |
| như trên (13) | tạo lại với cột đầu tiên nó đọc bị thay bằng cột khác | như trên |
| mỗi policy (11 mỗi loại) | xóa; tạo lại `AS RESTRICTIVE`; tạo lại `FOR ALL`; `ALTER POLICY … TO PUBLIC` | `registered policy … does not exist`; `is RESTRICTIVE`; `command is ALL, registered …`; `applies to {PUBLIC}` |
| mỗi hàm × `PUBLIC` và từng vai trò `app_*` chưa có `EXECUTE` (119) | `GRANT EXECUTE` | `function …: grants are` kèm `<vai trò>:EXECUTE` |
| mỗi hàm (29 mỗi loại) | `OWNER TO app_auth`; `OWNER TO` một vai trò mới ngoài bộ `app_*`; `LEAKPROOF` | `function … is owned by app role app_auth`; `function … is owned by <vai trò>`; `function … is LEAKPROOF` |
| mỗi hàm `SECURITY DEFINER` (14) | `RESET search_path` | `<chữ ký> {}` trong câu về thiết lập của hàm |
| mỗi hàm, kể cả `SECURITY INVOKER` (29) | `SET search_path = pg_temp, public` | `<chữ ký> {"search_path=pg_temp, public"}` |
| mỗi hàm `SECURITY DEFINER` (14 mỗi loại) | `SECURITY INVOKER`; `SECURITY INVOKER RESET search_path` (đổi chế độ cùng thiết lập, cho hàm trông vẫn chỉnh tề) | `<chữ ký> is SECURITY INVOKER, registered definer` |
| mỗi hàm `SECURITY INVOKER` (15 mỗi loại) | `SECURITY DEFINER`; `SECURITY DEFINER SET search_path = public, pg_temp` | `<chữ ký> is SECURITY DEFINER, registered invoker`; riêng `SECURITY DEFINER` một mình trên hàm không có `SET` thì câu về thiết lập trả lời trước: `<chữ ký> {}` |
| mỗi schema của dự án × `PUBLIC` và từng vai trò × `USAGE`, `CREATE` chưa có (24) | `GRANT … ON SCHEMA` | `schema …: grants are` kèm `<vai trò>:<quyền>` |
| `PUBLIC` và từng vai trò × bảng, hàm, sequence × toàn cục và `IN SCHEMA public` (30) | `ALTER DEFAULT PRIVILEGES … GRANT …` | `default privileges for … created by …: grants are` |
| mỗi vai trò `app_*` × năm thuộc tính (20) | `ALTER ROLE … SUPERUSER` / `BYPASSRLS` / `CREATEROLE` / `CREATEDB` / `REPLICATION` | `role … is SUPERUSER, BYPASSRLS, …` |
| mỗi vai trò request (3); vai trò đăng nhập (1) | `ALTER ROLE … LOGIN`; `ALTER ROLE app_conn INHERIT` | `role … can log in`; `role app_conn must be LOGIN NOINHERIT` |
| mỗi cặp vai trò `app_*` chưa có quan hệ thành viên ở cả hai chiều (6); mỗi quan hệ đang có (3) | `GRANT a TO b`; `GRANT … WITH INHERIT TRUE` | `b in a`; `… (inherit t, set t, admin f)` |
| mỗi vai trò `app_*` × `role`, `app.user_id` (8) | `ALTER ROLE … IN DATABASE <bản sao> SET …` | `a stored setting applies to an app role: role …, database …: {…}` |
| đối tượng của cả cơ sở dữ liệu, mỗi thứ một lần (4) | event trigger; publication `FOR ALL TABLES`; foreign-data wrapper; foreign server cấp `USAGE` cho `app_auth` | `event trigger … is not allowed`; `publication … is not allowed`; `foreign-data wrapper … is not allowed`; `foreign server … is not allowed` |
| mỗi thứ một lần (3) | bảng chưa đăng ký trong `public`; hàm chưa đăng ký trong `public`; một dòng trong `meta.test_clock` | `table … is not registered`; `function is not registered`; `meta.test_clock is not empty` |

`GRANT USAGE ON SCHEMA app TO app_auth` **không** có trong danh sách: `app_auth` vốn có quyền đó theo thiết kế (policy gọi `app.current_user_id()`), nên câu lệnh không đổi gì. Thay cho nó là `GRANT CREATE ON SCHEMA app TO app_auth` và `GRANT USAGE ON SCHEMA app` cho `PUBLIC`, `app_conn`.

### Vai trò là của cả cụm

`ALTER ROLE`, quan hệ thành viên và thiết lập lưu cho vai trò là các dòng trong catalog **dùng chung cho mọi cơ sở dữ liệu của cụm**, kể cả cơ sở dữ liệu mẫu. Chúng an toàn ở đây vì hai lý do: cổng 3 chạy một mình trên cụm test (xem "Một cụm test, mỗi lúc một lượt chạy"), và nó không bao giờ `COMMIT`: mọi đột biến được hoàn lại cùng transaction của nó. Test cuối cùng chứng minh điều đó qua một kết nối mới: chỉ `app_conn` đăng nhập được và nó là `NOINHERIT`; không vai trò `app_*` nào là superuser hay `BYPASSRLS`; và toàn bộ thuộc tính vai trò, quan hệ thành viên, thiết lập lưu sẵn và quyền mặc định giống từng dòng với ảnh chụp trước đột biến đầu tiên. Cổng không bao giờ chạm vào cơ sở dữ liệu mẫu.

### Không cần `FORCE ROW LEVEL SECURITY`

RLS không áp dụng cho chủ sở hữu bảng trừ khi bảng có `FORCE ROW LEVEL SECURITY`. Dự án **không** dùng `FORCE`, vì tiền đề của nó luôn đúng: mọi bảng thuộc về superuser chạy migration, và không vai trò ứng dụng nào sở hữu bảng nào. Tiền đề đó không phải là lời hứa mà là hàng rào được canh: lớp đột biến `ALTER TABLE … OWNER TO app_auth` ở trên phá nó trên **từng** bảng và đòi cổng 1 báo `table … is owned by app role app_auth`. (Bật `FORCE` trên một bảng không làm cổng 1 đỏ; nó chỉ thừa.) Lớp thứ hai, `OWNER TO` một vai trò ngoài bộ `app_*`, canh nửa còn lại của tiền đề: chủ của mọi bảng là đúng vai trò chạy các file SQL, không phải "bất kỳ ai miễn không phải `app_*`".

### Bảng, policy, hàm mới: cổng 3 cho gì và đòi gì

Cho không, không cần sửa gì ở file cổng:

- **Bảng mới** (đã đăng ký bằng `meta.expect_table`): tắt RLS (nếu bảng có RLS), đổi chủ sở hữu (sang `app_auth` và sang một vai trò ngoài), rule, trigger, mọi loại quyền (kể cả trên sequence của cột `IDENTITY`), cấp lại `WITH GRANT OPTION` quyền đang có, cho `PUBLIC` và từng vai trò `app_*`, `UPDATE` trên một cột chưa đăng ký, policy thứ hai cho mỗi lệnh bảng cấp, và bảng "content" bám vào nó (nếu nó không phải `content`).
- **Policy mới** (đã đăng ký bằng `meta.expect_policy`): `OR true` và đổi cột trên từng biểu thức, xóa, `RESTRICTIVE`, `FOR ALL`, `TO PUBLIC`.
- **Hàm mới** (đã đăng ký bằng `meta.expect_function`, kèm chế độ): `EXECUTE` cho `PUBLIC` và cho từng vai trò `app_*` chưa đăng ký, đổi chủ sở hữu (sang `app_auth` và sang một vai trò ngoài), `LEAKPROOF`, `search_path` hỏng, đổi chế độ một mình và đổi chế độ cùng `SET` / `RESET` tương ứng, và gỡ `search_path` nếu là `DEFINER`.

Đòi lại: lược đồ phải **đạt cổng 1 trước đã** (test đầu tiên của cổng 3). Mọi thứ còn lại là hệ quả của các luật đăng ký ở mục dưới. Những trường hợp một nhiệm vụ sau có thể thấy cổng 3 đỏ, và việc cần làm:

- `verify did not raise` trên một đối tượng mới: cổng 1 mù với hàng rào đó. Sửa `90-verify.sql` bằng điều kiện nhỏ nhất, thêm ca viết tay vào `verify.test.ts`; **không** gỡ đột biến.
- `the mutation did not apply` ở lớp "đổi cột": cột có tên phải đặt trong dấu nháy kép (cổng thay tên cột trần trong biểu thức). Đặt tên cột bằng chữ thường và gạch dưới, hoặc sửa hàm `onAnotherColumn` trong file cổng.
- Policy không đọc cột nào (ví dụ chỉ gọi hàm) không có đột biến "đổi cột"; văn bản của nó vẫn được canh bằng `OR true`.
- **Khóa `IDENTITY`, view `security_invoker`, hàm `invoker` gọi được có ghim `search_path`, hàm nội bộ `definer`**: lược đồ thật chưa có thứ nào trong số đó, nên cổng tự thử trên một bản sao thứ hai có đủ cả bốn (test "a schema with an identity key, a view …"): mọi lớp phải áp dụng được, mọi đột biến phải bị bắt (lúc viết: 1700 trên 1700), và tám dòng `PASS` nêu đích danh các đối tượng mới phải có mặt. Một lớp chỉ phá riêng view (gỡ `security_invoker`) thì chưa có, vì trên lược đồ thật nó sẽ rỗng mà lớp rỗng là lớp hỏng: ca viết tay trong `verify.test.ts` giữ hàng rào đó cho tới khi lược đồ có view đầu tiên.
- **Trigger, event trigger, publication, foreign-data wrapper, foreign server, hàm `LEAKPROOF`**: cổng 1 từ chối tất cả. Nhiệm vụ đầu tiên thật sự cần một trigger thì thêm sổ đăng ký trigger vào `02-meta.sql` (bảng `meta.expected_triggers` và hàm `meta.expect_trigger`), đổi phép khẳng định "không có trigger" trong `90-verify.sql` thành phép so với sổ đó, và thêm ca viết tay cùng lớp đột biến của nó, trong cùng một thay đổi.

### Phần cổng 3 không phá

Những hàng rào không gắn với từng bảng hay từng hàm chỉ có ca viết tay trong `verify.test.ts`, trên lược đồ mẫu: quyền và chủ sở hữu của cơ sở dữ liệu, chủ sở hữu schema, quyền trên tham số cấu hình (`GRANT SET ON PARAMETER`), `ALTER DATABASE … SET` và `ALTER ROLE ALL SET`, vai trò ngoài bộ `app_*` (thành viên của `pg_read_all_data`, vai trò lạ được cấp quyền), view không `security_invoker`, materialized view, foreign table, sequence, sổ đăng ký tự mâu thuẫn. Cổng 3 cũng chỉ phá theo chiều **mở rộng** quyền; chiều thu hẹp (`REVOKE` một quyền đã đăng ký) có ca viết tay và làm test của từng mảng đỏ. Cụ thể, trong 39 lệnh `RAISE` của `90-verify.sql` có 12 lệnh không đột biến nào của cổng 3 chạm tới (đếm bằng cách đối chiếu từng thông báo `PASS` với từng lệnh `RAISE`); mỗi lệnh có ca viết tay của nó trong `verify.test.ts`: `app_conn cannot SET ROLE` (`REVOKE app_job FROM app_conn`); `a configuration parameter is granted` (ba ca `GRANT … ON PARAMETER`); ba lệnh `registry:` (các ca "the registry itself is not trusted", `PUBLIC` / `app_conn` trong danh sách vai trò, chế độ `owner`); `registered table does not exist` (`DROP TABLE fx_internal`); `materialized view … is not allowed` (`fx_copy`); `foreign table … is not allowed` (`fx_remote`); `view … must be WITH (security_invoker = true)` (bốn ca view); `registered column does not exist` (hai ca `RENAME COLUMN`); `registered function does not exist` (`DROP FUNCTION fx_fn(text)`); `internal function must be registered with no role` (ba ca).

### Những gì cổng 1 không nhìn thấy, và cái gì giữ thay

Cổng 1 đọc catalog về **ai được làm gì trên đối tượng nào**. Nó không đọc thân hàm, ràng buộc hay dữ liệu, theo thiết kế. Từng dòng dưới đây đã được chạy thử trên một bản sao (đổi, rồi chạy `90-verify.sql`): cổng 1 im lặng.

| Thay đổi | Cổng 1 | Cái gì giữ thay |
|---|---|---|
| Thân hàm bị thay (ví dụ `auth_session` trả `NULL` ngay) | im lặng | Test SQL của từng mảng (`server/test/*.sql.test.ts`) và test route; ca tấn công của cổng 2 cho các hàm chạm tới dòng của người khác. Xem các mục "Phần cổng 1 không nhìn thấy" của từng mảng. |
| Ràng buộc bị gỡ: khóa duy nhất của sổ cái, một `CHECK`, một khóa ngoại, `NOT NULL`, một chỉ mục | im lặng | Test SQL của từng mảng, cho những ràng buộc mà mảng đó nêu ở mục "Phần cổng 1 không nhìn thấy" của nó. Ràng buộc không được nêu ở đó thì không gì canh. |
| Giá trị mặc định của cột bị đổi (`now()` thay cho `app.now()`) | im lặng | Chưa có phép kiểm chung nào: chỉ test nào đọc đúng cột đó dưới đồng hồ test mới thấy. |
| Dữ liệu: một dòng nội dung bị sửa, dòng pepper bị xóa | im lặng | Seeder chạy lại ở mỗi lần migrate; test của từng mảng. Giữa hai lần migrate không gì báo. |
| Dòng mồi nhử bị xóa | im lặng | Cổng 2: `no decoy row in <bảng>`. |
| Catalog **và** sổ đăng ký bị sửa cùng lúc (mở policy rồi sửa `meta.expected_policies` cho khớp) | im lặng | Sổ được dựng lại từ các file SQL ở mỗi lần migrate, nên thay đổi như vậy chỉ tồn tại lâu dài nếu nằm trong file SQL: diff của file đó, và cổng 2 (phép kiểm 3, 5, 10 thấy policy mở bất kể sổ nói gì). |
| Cột chứa id người dùng, **không** có khóa ngoại, trong một bảng `content` | im lặng | Không gì cả. Cổng 1 và phép kiểm 12 của cổng 2 đều nhận ra dữ liệu người dùng qua khóa ngoại: mọi cột trỏ tới người dùng phải có khóa ngoại. |
| View `security_invoker` trên bảng dữ liệu người dùng, đăng ký là `content` | im lặng | Không cần: view đó đọc bằng quyền của người gọi, RLS của bảng gốc vẫn lọc. |
| `FORCE ROW LEVEL SECURITY`; bật RLS trên bảng `content`; policy trên bảng của `meta`; domain, schema rỗng, bảng trong schema khác không cấp cho ai | im lặng | Không phải hàng rào bị phá: chặt hơn thiết kế, hoặc không vai trò nào chạm tới. |
| `ALTER ROLE app_anon INHERIT` | im lặng | Không cần: vai trò request không là thành viên của vai trò nào (cổng 1 kiểm quan hệ thành viên). |
| Mật khẩu, giới hạn kết nối của `app_conn` | im lặng | Không gì cả: việc của vận hành (xem "`app_conn` trần vẫn làm được gì"). |
| Hàm bị đổi thành `STRICT` | im lặng | Không phải hàng rào (hàm trả `NULL` sớm hơn); test của từng mảng. |
| Hàm `SECURITY INVOKER` **không ghim `search_path`** mà thân hàm đọc một bảng, được gọi từ một policy | im lặng (ghim `search_path` là tùy chọn với hàm `invoker`, và cổng 1 không đọc thân hàm) | Không gì tự động. Hàm chạy bằng `search_path` của người gọi, nên bảng tạm trùng tên của người gọi che bảng thật ngay trong policy. `app.current_user_id()` là hàm như vậy và an toàn chỉ vì thân nó không đọc bảng nào. Hàm mà policy gọi và có đọc bảng thì phải ghim `SET search_path = public, pg_temp`, hoặc ghi rõ schema cho mọi tên trong thân; ca tấn công của cổng 2 cho bảng đó là phép thử. |

Những thứ từng im lặng và nay cổng 1 đã thấy: hàm bị đổi chế độ `DEFINER` / `INVOKER` (kể cả đổi cùng `SET`), `ALTER DEFAULT PRIVILEGES`, rule, trigger, event trigger, publication, foreign-data wrapper và foreign server, hàm `LEAKPROOF`, bảng, view, sequence hay hàm bị trao cho một vai trò ngoài bộ `app_*`.

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

-- Hàm nội bộ nhận user id tường minh: không ai được gọi, và nó chạy bằng quyền của hàm gọi nó.
CREATE OR REPLACE FUNCTION app._mark_level_seen(p_user uuid, p_level int) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp
AS $$ UPDATE profiles SET level_seen = p_level WHERE user_id = p_user $$;
REVOKE ALL ON FUNCTION app._mark_level_seen(uuid, int) FROM PUBLIC, app_anon, app_auth, app_job;
SELECT meta.expect_function('app._mark_level_seen(uuid, int)', 'invoker', '{}');

-- Hàm client gọi: nhận ý định, lấy id từ app.current_user_id().
CREATE OR REPLACE FUNCTION profile_mark_level_seen(p_level int) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT app._mark_level_seen(app.current_user_id(), p_level) $$;
REVOKE ALL ON FUNCTION profile_mark_level_seen(int) FROM PUBLIC, app_anon, app_auth, app_job;
GRANT EXECUTE ON FUNCTION profile_mark_level_seen(int) TO app_auth;
SELECT meta.expect_function('profile_mark_level_seen(int)', 'definer', '{app_auth}');
```

Quy tắc dùng, mỗi dòng là một điều cổng 1 sẽ bắt:

- **`own_rw` cho sửa một phần**: `GRANT SELECT` ở mức bảng, `GRANT UPDATE (cột…)` theo cột, và **không** `GRANT UPDATE` ở mức bảng. Đăng ký quyền mức bảng (`'{SELECT}'`) và danh sách cột (`'{display_name,timezone}'`) riêng nhau.
- **Policy** viết `… TO app_auth` (bỏ `TO` là `PUBLIC`, bị từ chối), để mặc định `PERMISSIVE`, và đăng ký biểu thức bằng **đúng nguyên văn** `pg_get_expr` in ra: có ngoặc ngoài, tên hàm kèm schema, ví dụ `(app.current_user_id() = user_id)`. Lấy nguyên văn bằng `SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polname = '…'`. Làm cho chạy lại được bằng `DROP POLICY IF EXISTS` rồi `CREATE POLICY`.
- **Hàm `SECURITY DEFINER`**: đúng `SET search_path = public, pg_temp` và không `SET` nào khác; `REVOKE ALL … FROM PUBLIC` (cùng các vai trò `app_*`, để file tự đủ khi chạy lại); rồi `GRANT EXECUTE` cho **đúng** các vai trò sẽ đăng ký.
- **Hàm nội bộ và hàm trigger**: tên bắt đầu bằng `_` (hàm nhận user id tường minh luôn thuộc loại này), không `GRANT EXECUTE` cho ai, đăng ký với `'{}'`. Hàm nội bộ **không cần** `SECURITY DEFINER`: nó được hàm `SECURITY DEFINER` gọi nên đã chạy bằng quyền chủ sở hữu, và để nó là `invoker` thì một `GRANT EXECUTE` lạc vào nó vẫn dừng ở quyền trên bảng. Ngoại lệ có thật là hàm trigger phải ghi một bảng mà người gây ra trigger không có quyền: viết `SECURITY DEFINER` và đăng ký `'definer'`. `SET search_path = public, pg_temp` trên hàm `invoker` là tùy chọn (không có thì nó dùng của hàm gọi), nhưng đã viết thì phải đúng giá trị đó.
- **Chế độ của hàm** đăng ký ở tham số thứ hai của `meta.expect_function`: `'definer'` cho hàm viết `SECURITY DEFINER`, `'invoker'` cho mọi hàm còn lại. Khai khác với cái file tạo ra là đỏ ở cuối lần migrate (`function security: … is SECURITY INVOKER, registered definer`). Hàm client gọi để làm việc đặc quyền là `definer`; hàm nội bộ mặc định là `invoker`; hàm gọi được mà chỉ đọc dữ liệu của chính người gọi có thể là `invoker` (RLS lọc hộ) và được phép ghim `SET search_path = public, pg_temp`.
- **Không `CREATE RULE`, và chưa có trigger.** Việc đặc quyền là hàm đã đăng ký. Trigger bị cổng 1 từ chối cho tới khi có sổ đăng ký trigger (xem "Bảng, policy, hàm mới: cổng 3 cho gì và đòi gì"); event trigger, publication, foreign-data wrapper, foreign server và hàm `LEAKPROOF` bị từ chối hẳn.
- **Bảng `content`** chỉ có khóa ngoại tới bảng `content`. Bảng có khóa ngoại tới `users` hay tới bất kỳ bảng `own_*`, `internal` nào là dữ liệu người dùng: đăng ký nó theo đúng lớp.
- **View**: `CREATE VIEW … WITH (security_invoker = true)`, đăng ký như bảng lớp `content`. Không materialized view, không foreign table.
- **Khóa chính**: `uuid` (`gen_random_uuid()`) hoặc cột `GENERATED … AS IDENTITY`. Không dùng `serial`: nó đòi `GRANT USAGE` trên sequence, mà sequence không được cấp cho ai.
- **`app_anon` và `app_job` không bao giờ được cấp quyền trên bảng.** Việc của request chưa đăng nhập và của job đi qua hàm `SECURITY DEFINER` cấp `EXECUTE` cho đúng vai trò đó.
- Đăng ký sai (lớp lạ, `own_rw` kèm `TRUNCATE`, hàm kèm `PUBLIC`) không báo lỗi ở dòng đăng ký mà ở `90-verify.sql` cuối lần migrate, với thông báo bắt đầu bằng `registry:` và nêu tên bảng hoặc hàm.

## Thêm một file SQL

1. Tạo `server/sql/NN-<mảng>.sql` với số nhỏ hơn 80, viết sao cho chạy lặp lại được. Mỗi file thuộc về một nhiệm vụ.
2. Bảng do superuser sở hữu. Bật RLS theo lớp, tạo policy `… TO app_auth`, rồi `GRANT` cho `app_auth` đúng những gì lớp cho phép, và không cấp gì cho vai trò khác. Dùng GRANT theo cột khi client chỉ được sửa một phần (`GRANT UPDATE (cột) …`).
3. Việc đặc quyền là hàm `SECURITY DEFINER` có đúng `SET search_path = public, pg_temp` (`pg_temp` luôn đứng cuối; gọi hàm trong `app` thì ghi rõ `app.`), nhận *ý định* của người dùng chứ không nhận số tiền hay user id; id lấy từ `app.current_user_id()`. Hàm nhận user id tường minh đặt trong `app` với tên bắt đầu bằng `_`, không cấp `EXECUTE` cho ai và không cần `SECURITY DEFINER` (quy tắc "tên bắt đầu bằng `_` = không ai được gọi" áp dụng ở mọi schema). `SECURITY DEFINER` không chịu RLS: điều kiện policy đang lọc hộ phải viết lại trong thân hàm. Đọc thời gian bằng `app.now()`.
4. **Đăng ký** mọi bảng, policy và hàm bằng `meta.expect_*` ngay trong file đó, kể cả hàm trong `app`. Hàm không vai trò nào được gọi (hàm `app._*`, hàm trigger) vẫn phải đăng ký, với tập vai trò rỗng `'{}'`.
5. **Mồi nhử**: thêm `8N-decoy-<mảng>.sql` cho người dùng mồi nhử `DECOY_1` ít nhất một dòng trong mỗi bảng dữ liệu người dùng mới. Phép kiểm "A không đọc được dữ liệu của B" luôn đạt nếu B không có dòng nào để tìm. Dòng mồi nhử là vĩnh viễn và **không bao giờ được dọn**. File mồi nhử chạy sau seeder nên tham chiếu được nội dung đã seed. Luật viết và các id cố định: xem "Cổng 2: API check và dòng mồi nhử". Thiếu dòng cho một bảng `own_*` là cổng 2 đỏ với `no decoy row in <bảng>`.
6. **Ca tấn công**: thêm `server/checks/attacks/<mảng>.ts` cho cổng 2, export `attacks: Attack[]` (hợp đồng ở `attacks/base.ts`).
7. Test đi qua `app_conn` với chuyển vai thật (`asUser`, `asAnon`, `asJob`), không bao giờ qua kết nối của chủ sở hữu; kết nối đó chỉ để dựng dữ liệu và đọc lại kết quả.
8. Bổ sung một mục vào tài liệu này, và để cả ba cổng xanh: `npm run db:verify`, `npm run db:api-check`, `npm run db:mutation-check`. Cổng 3 tự phủ bảng, policy và hàm mới (xem "Bảng, policy, hàm mới: cổng 3 cho gì và đòi gì").

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
| `routes/me.ts`, `routes/settings.ts`, `routes/progression.ts` | Onboarding, hồ sơ, số đo, hệ phái, đơn kê, cài đặt, tiến trình, thú (xem "Hồ sơ và tiến trình"). |
| `routes/day.ts` | Ngày hiện tại, tick, hoàn tác, giờ ngủ, lịch sử (xem "Ngày và nhiệm vụ"). |
| `routes/nutrition.ts`, `routes/workout.ts` | Ghi calo, danh mục bài tập, một bài tập, ghi buổi tập (xem "Hai nhiệm vụ cốt truyện"). |
| `routes/inbox.ts`, `jobs/*.ts` | Hộp thư; bộ lập lịch, job đóng ngày, lệnh chạy một job (xem "Đóng ngày, bộ lập lịch và hộp thư"). |
| `readModels/me.ts` | `buildMe`, `buildProgression`, `buildPet`, `buildPrescription`: những gì người dùng đọc lại về chính mình. |
| `readModels/day.ts`, `readModels/delta.ts` | `buildDay`, `buildDaySummaries`, `buildDayDetail`; `buildDelta`, `logGrants`: ngày của người dùng, và phần "vừa thay đổi gì" của một request ghi. |
| `seed/*.ts` | Seeder nội dung, chạy trong `migrate`. |
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
- **`MAIL_MODE=outbox` là chế độ thư duy nhất** và bắt buộc phải đặt: thiếu hay giá trị khác thì `main.ts` dừng ngay lúc khởi động, trước khi nối cơ sở dữ liệu, với thông báo trỏ về mục "Thư" ở cuối file này. `outbox` còn đòi `NODE_ENV` đúng bằng `development` hoặc `test`. `server:dev` mặc định `outbox` và tự đặt `NODE_ENV=development`. Chi tiết ở mục "Route xác thực và thư".

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

- `healthz` luôn trả `200`, trong 2 giây: `{ ok, db, jobs }`, `ok` sai đúng khi `db` sai. `db` là kết quả của một transaction thật bằng `app_anon`, nên nó cũng sai khi chuyển vai hỏng, khi pool hết kết nối rảnh và khi cơ sở dữ liệu không trả lời kịp. `jobs` là lần chạy cuối của mỗi job trong tiến trình này, lấy từ bộ nhớ của bộ lập lịch (không đọc `job_runs`: bảng đó `internal`, route thì ẩn danh); job chưa chạy lần nào thì không được liệt kê.
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
- `newOnboardedUser(db, overrides?)` trả thêm `input`: `newUser` rồi `profile_onboard` (xem "Hồ sơ và tiến trình").
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
- `displayName`: cắt dấu cách, 1–40 ký tự (đếm theo code point), `isDisplayName` (không ký tự điều khiển hay vô hình: gồm cả dấu gạch nối mềm U+00AD và dấu phân tách dòng/đoạn U+2028, U+2029, mà cơ sở dữ liệu không từ chối), rồi mới tới từ cấm: `422 NAME_NOT_ALLOWED` chỉ khi mọi trường khác hợp lệ.
- mật khẩu mới (`password` khi đăng ký, `newPassword` khi đặt lại): **chuẩn hóa NFC trước (`normalizePassword` của `domain/validation.ts`, app gọi cùng hàm), rồi mới kiểm tra độ dài và băm**: "ế" gõ liền hay gõ rời là một mật khẩu. 8–128 ký tự theo code point, **không bao giờ cắt khoảng trắng**, không đổi chữ hoa/thường, không NFKC. Đổi hàm này sau khi đã có tài khoản thật là làm mồ côi mọi khóa đã lưu. Đăng nhập chỉ đòi không rỗng và không quá 128 (mật khẩu ngắn hơn 8 chỉ là sai, nhận `401`).
- `code`: đúng 8 chữ số (`^[0-9]{8}$`), độ dài lấy từ `LIMITS.resetCode.length`, không có số 8 nào trong code server.
- `acceptedTerms` phải đúng là `true`.
- Mọi chuỗi có U+0000 là `VALIDATION_FAILED` của chính trường đó (nếu để lọt, PostgreSQL trả `22021`); thân request không phải object coi như thiếu mọi trường.

### Đường đi của từng route

- **scrypt chỉ chạy trong `prepare`**, trước khi request mở transaction (không giữ kết nối nào). Đăng ký: kiểm tra, salt mới, scrypt. Đăng nhập: kiểm tra, `auth_salt` (một transaction ngắn riêng, `withRole(pre.pool, 'app_anon', …)`), **đúng một** scrypt, cả với email không có tài khoản (salt giả), rồi handler gọi `auth_login`. Đặt lại: kiểm tra, salt mới, scrypt; mã sai hay đúng đều tốn như nhau.
- **Cổng scrypt** (`password.ts`): tối đa 4 lần chạy đồng thời và 32 lần chờ; lần thứ 37 trở đi nhận `429 RATE_LIMITED` (`deriveKey` ném `AppError`). Phản hồi `429` này mang `Retry-After: 1` như mọi `429` khác (`app.ts` thêm header cho mọi `RATE_LIMITED` bị ném).
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
- **Chỉ chủ sở hữu đọc được:** thư mục `.outbox` được tạo với mode `0o700` và file với `0o600`. Trên Windows mode phần lớn bị bỏ qua (quyền do ACL của thư mục cha quyết định), nên đó không phải hàng rào ở đó; hàng rào là file chỉ dùng khi phát triển. Với thư mục và file **đã tồn tại**, mode lúc tạo không áp dụng nên trên hệ không phải Windows mailer `chmod` lại (`0o700`, `0o600`) trước khi ghi dòng mới. Các khẳng định về mode trong `mailer.test.ts` chưa từng được quan sát trên hệ POSIX (máy phát triển là Windows): mục này nằm trong danh sách kiểm tra trước khi phát hành.
- **Chỉ chạy khi `NODE_ENV` đúng bằng `development` hoặc `test`** (đóng theo mặc định): `production`, `Production`, `prod`, `staging`, `"production "`, giá trị rỗng hay không đặt đều dừng khởi động với cùng thông báo như giá trị `MAIL_MODE` không hỗ trợ; mã đặt lại không bao giờ được ghi xuống đĩa ngoài môi trường phát triển (có test cho bảng các cách viết đó). `server/.env.example` đặt `NODE_ENV=development`; `server:dev` tự đặt. `server/.outbox/` đã nằm trong `.gitignore`.
- Lấy mã khi chạy `npm run server:dev`: dòng cuối của file đó.
- **Không thư nào được giao cho mailer khi địa chỉ kết thúc bằng `.invalid`** (tên miền cấp cao dành riêng, nơi các tài khoản mồi nhử ở). `POST /auth/password/forgot` vẫn trả `202 {}` và vẫn lưu mã như với mọi tài khoản; chỉ bước giao thư bị bỏ qua, và bước đó vốn chạy sau khi đã trả lời. Có test trong `routes/auth.test.ts`. Xem "Cổng 2: API check và dòng mồi nhử".
- **Cắm SMTP: chưa kiểm chứng, chưa có dòng code nào được chạy.** Việc cần làm: viết một hàm `Mailer` (ví dụ `smtpMailer(options)` dùng một thư viện như `nodemailer`, thêm vào `server/package.json`); thêm nhánh `MAIL_MODE=smtp` vào `mailerFromEnv` của `main.ts`, đọc máy chủ, cổng, tài khoản và người gửi từ môi trường (mật khẩu SMTP không vào log hay repo); `server:dev` có thể giữ `outbox`. Hàm phải reject khi gửi hỏng (`ctx.afterCommit` ghi log không có thông báo lỗi; thông báo của máy chủ thư thường chứa địa chỉ người nhận). Chưa kiểm chứng: nhịp gửi, thử lại, hàng đợi khi tiến trình dừng.

## Hồ sơ và tiến trình (`20-progression.sql`, `21-profile.sql`, `routes/me.ts`, `routes/settings.ts`, `routes/progression.ts`)

Lược đồ đầu tiên chứa dữ liệu của người dùng sau phần xác thực: hai sổ cái XP và xu cùng hàm ghi duy nhất của chúng, trạng thái chuỗi ngày, số đo cơ thể, đơn kê (prescription), cài đặt, và mười route mà màn hình onboarding, hồ sơ và cài đặt gọi. Hợp đồng (hình dạng request, response, mã lỗi) nằm ở `docs/api/openapi.yaml`; mục này ghi cách server giữ nó.

### Không lưu thứ gì suy ra được

Không bảng nào có cột `xp`, `coin`, `level`, điểm perk hay bốn chỉ số nhân vật (có test đọc `information_schema` và đỏ khi một cột như vậy xuất hiện).

| Giá trị | Suy ra từ |
|---|---|
| XP, xu | tổng `amount` của `xp_ledger`, `coin_ledger` |
| Cấp độ, danh hiệu | tổng XP hiện tại (`levelForXp` ở Node, `app._level` ở SQL) |
| Điểm perk còn lại | `perkPointsEarned(xp_high_water)` trừ tổng `perk_unlocks.cost` |
| Giai đoạn và độ lớn của thú | `petProgress(xp_high_water)` |
| Tâm trạng của thú | `petMood` trên `streak_current`, `last_outcome`, `missed_run` |
| Chủ đề, skin, huy hiệu | dòng `inventory` đang `equipped`, không có thì vật phẩm `is_default` |
| HP, EN, STR, SPD | `mapStats` lúc đọc (không route nào ghi chúng) |

`xp_high_water` là tổng XP cao nhất người dùng từng có. Hoàn tác một lượt tick làm tổng XP giảm nhưng không làm mốc này giảm: điểm perk đã nhận và giai đoạn của thú không bao giờ lùi. Cấp độ thì đi theo **tổng hiện tại**, nên có thể lùi một cấp sau khi hoàn tác.

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `progression_state` | `own_read` | Một dòng mỗi người dùng, tạo lúc onboarding. `xp_high_water ≥ 0`, `streak_best ≥ streak_current`, `last_outcome` thuộc `COMPLETED` / `FROZEN` / `MISSED`, `onboard_date` là ngày logic của lúc onboarding theo múi giờ đã chọn. |
| `xp_ledger`, `coin_ledger` | `own_read` | Chỉ thêm, không sửa, không xóa: điều chỉnh là một dòng mới trái dấu. `amount ≠ 0`. **Duy nhất theo `(user_id, reason, ref_id)`**. |
| `level_thresholds` | `content` | `level` → `cumulative_xp` (tổng XP tại đó cấp bắt đầu; cấp 1 là 0). Seed từ `cumulativeXpForLevel`, cấp 1 tới `MAX_SEEDED_LEVEL` (200). |
| `pet_stages` | `content` | `stage`, `ord`, `size_xp` (`NULL` ở giai đoạn cuối). Seed từ `PET_STAGES`. |
| `shop_items` | `content` | Seed từ `server/content/shopItems.ts` theo `code`. Mỗi loại (`kind`) nhiều nhất một vật phẩm `is_default` (chỉ mục duy nhất). |
| `inventory` | `own_read` | Duy nhất theo `(user_id, shop_item_id)`. Cột `kind` là bản sao loại của vật phẩm, được khóa ngoại kép `(shop_item_id, kind)` giữ đúng; nhờ nó "mỗi người mỗi loại chỉ một vật phẩm đang dùng" là một chỉ mục duy nhất. Vật phẩm mặc định **không bao giờ** là một dòng ở đây: ai cũng có sẵn. |
| `perk_unlocks` | `own_read` | `perk_code`, `shop_item_id` (chủ đề được mở bằng `THEME_UNLOCK`, `NULL` với perk dùng một lần), `cost > 0`. Duy nhất theo `(user_id, perk_code, shop_item_id)`, coi `NULL` là một giá trị. |
| `biometric_snapshots` | `own_read` | Mỗi lần cập nhật số đo là một dòng mới; dòng cũ không bao giờ bị sửa. Chiều cao 120–230, cân nặng 30–250, `sex` và `activity_level` có `CHECK`. **Duy nhất theo `(user_id, recorded_at)`**: "snapshot mới nhất" luôn là đúng một dòng. |
| `prescriptions` | `own_read` | Một dòng mỗi người dùng: đơn kê đang có hiệu lực. Mỗi con số có khoảng của nó (`CHECK`): `bmr` trên 0 tới 5000, `tdee` trên 0 tới 10000, `calorie_target` là số nguyên từ 1200 tới 10000, `protein_g` 0–1000, `carbs_g` 0–2000, `fat_g` 0–500, `water_ml` 1500–4000. Xem "Trần của đơn kê". |
| `user_settings` | `own_rw`: đọc dòng của mình, sửa sáu cột | Các cột sửa được: `nudges_enabled`, `reminder_enabled`, `reminder_window`, `hide_streak`, `motion`, `excluded_meal_tags`. `sound_enabled` **không** nằm trong sáu cột đó và có `CHECK (NOT sound_enabled)`: bản này không có âm thanh. Vì chủ dòng tự ghi, luật của từng cột là `CHECK`: hai enum, và `excluded_meal_tags` là một **tập hợp** các thẻ của `INGREDIENT_TAGS`: chỉ các thẻ đó, mảng một chiều, không thẻ nào lặp lại, nên không bao giờ quá tám phần tử. (`CHECK` không chứa được truy vấn con, nên "không lặp" được viết là: số phần tử bằng số thẻ của danh sách có mặt trong mảng; danh sách thẻ vì thế xuất hiện hai lần trong ràng buộc và phải được sửa cùng nhau.) |

Mọi dòng của các bảng `own_read` đều do hàm ghi. Một client thử `INSERT`, `UPDATE` hay `DELETE` trực tiếp nhận `42501 permission denied for table …` (có test cho từng bảng, kể cả bảng nội dung).

### Sổ cái và `app._grant`

```sql
app._grant(p_user uuid, p_xp int, p_coin int, p_reason text, p_ref text) RETURNS jsonb
-- {"xpBefore", "xpAfter", "coinBefore", "coinAfter", "highWaterBefore", "highWaterAfter", "applied"}
```

`app._grant` là **nơi duy nhất ghi sổ cái**, và không vai trò nào được gọi nó: chỉ một hàm `SECURITY DEFINER` đã tự quyết định số lượng mới gọi. Nó không phải `SECURITY DEFINER` (chạy bằng quyền của hàm gọi nó), nên một `GRANT EXECUTE` cấp nhầm vẫn bị chặn ở tầng bảng.

- Trước hết nó khóa dòng `progression_state` của người dùng (`SELECT … FOR UPDATE`). Các lượt cộng của cùng một người vì thế chạy lần lượt, và mỗi lượt đọc được tổng mà lượt trước để lại. Người dùng chưa có dòng đó (chưa onboarding) thì hàm ném lỗi.
- Mỗi số lượng khác 0 thành một dòng sổ cái, `ON CONFLICT (user_id, reason, ref_id) DO NOTHING`. Đã có dòng với khóa đó thì không thêm gì và tổng trả về giữ nguyên.
- `applied` là `true` khi lượt gọi này thêm ít nhất một dòng. Các dòng nó thêm là `xpAfter − xpBefore` XP và `coinAfter − coinBefore` xu với đúng `p_reason` / `p_ref`: route gọi `ctx.log.ledger(...)` cho từng dòng đó.
- `xp_high_water` chỉ tăng: nó được nâng lên tổng XP mới khi tổng đó vượt mốc cũ.

**Người gọi chọn `p_ref`**, và lựa chọn đó quyết định "một lần" nghĩa là gì:

| `reason` | `ref_id` | Ý nghĩa |
|---|---|---|
| `QUEST_TICK`, `QUEST_TICK_UNDO` | id của lượt tick | mỗi hành động một lần |
| `WORKOUT_PARTIAL` | id buổi tập | mỗi hành động một lần |
| `QUEST_COMPLETE` | `<MÃ_QUEST>:<ngày logic>` | mỗi quest mỗi ngày một lần |
| `JOURNAL` | ngày logic | mỗi ngày một lần |
| `STREAK_MILESTONE` | `7`, `30`, `100` | cả đời một lần |
| `GUILD_WEEKLY` | ngày đầu tuần | mỗi tuần một lần |
| `PURCHASE` | mã vật phẩm | mỗi vật phẩm một lần |

Đã có test: cùng khóa gọi hai lần là một dòng; mười lượt cộng cùng lúc với khóa khác nhau cho tổng đúng và mười kết quả nối thành một chuỗi không đứt; mười lượt giống hệt nhau cùng lúc chỉ được tính một.

`app._level(p_user uuid) RETURNS int`: cấp cao nhất có `cumulative_xp` không vượt tổng XP hiện tại; 1 khi chưa có dòng nào. Bảng ngưỡng chỉ seed tới cấp 200 (khoảng 22,5 triệu XP), nên trên mức đó SQL trả 200 trong khi `levelForXp` của `domain/` vẫn đếm tiếp.

### Seeder

`server/src/seed/levels.ts` (ngưỡng cấp và giai đoạn của thú) và `server/src/seed/shopItems.ts` (vật phẩm, theo `code`). Cả hai là upsert: chạy lại không ghi lại dòng nào đang đúng (test so cả `xmin`), và sửa lại dòng bị lệch. Vật phẩm giữ nguyên `id` qua mọi lần seed, nên dòng `inventory` không mất chỗ trỏ. Seeder không xóa dòng đã bị gỡ khỏi nội dung.

### Ba hàm `profile_*`

Cả ba là `SECURITY DEFINER`, chỉ `app_auth` gọi được, lấy người dùng từ `app.current_user_id()` và khóa dòng `users` của người đó **`FOR NO KEY UPDATE`** trước khi làm gì khác (xem "Khóa dòng: không bao giờ `FOR UPDATE` trên dòng được tham chiếu"). Đơn kê được tính ở Node (`calculatePrescription`) rồi truyền vào dưới dạng JSON: đó là giá trị, không phải tiền. SQL kiểm tra lại, như hàng rào cuối, những gì làm nó an toàn.

| Hàm | Việc |
|---|---|
| `profile_onboard(timezone, archetype, height_cm, weight_kg, birth_year, sex, activity_level, prescription) → boolean` | Hoàn tất onboarding, đúng một lần: ghi `users` (múi giờ, hệ phái, `archetype_set_at`, `onboarded_at`), snapshot đầu tiên, đơn kê, cài đặt mặc định và dòng `progression_state`. `true` khi đã làm; `false`, không xét gì và không đổi gì, khi người gọi đã onboarding rồi. |
| `profile_add_biometrics(height_cm, weight_kg, birth_year, sex, activity_level, prescription, archetype DEFAULT NULL) → void` | Thêm một snapshot và thay đơn kê. |
| `profile_set_archetype(archetype, prescription) → void` | Đổi hệ phái theo ý người dùng, chịu thời gian chờ 14 ngày; thay đơn kê. Không chạm sổ cái, không chạm trường nào của chuỗi ngày. |

Lỗi được ném với `SQLSTATE HM000` (`MESSAGE` là mã lỗi của API, `DETAIL` là JSON của `details`), **theo đúng thứ tự này**, vì app đưa mỗi loại về một màn hình riêng:

1. `VALIDATION_FAILED` kèm `details.fields`: mọi trường sai một lượt, tên trường như trong thân request (`timezone`, `archetype`, `heightCm`, `weightKg`, `birthYear`, `sex`, `activityLevel`). Tuổi trên 90 là `birthYear` / `min`.
2. `AGE_NOT_ALLOWED`: dưới 16 tuổi. Tuổi là năm dương lịch của `app.now()` **theo múi giờ của người dùng** trừ năm sinh.
3. `ARCHETYPE_NOT_ALLOWED` kèm `details.allowed`: `ASSASSIN` khi BMI dưới 18,5. `app._archetypes_allowed` tính bằng `float8` với đúng các phép tính và thứ tự của `allowedArchetypes` ở `domain/`, nên hai bên trả lời giống nhau cả ở đúng mốc 18,5 (có test so trên một lưới giá trị quanh mốc).
4. `VALIDATION_FAILED` cho đơn kê: `calorieTarget` không phải số nguyên (`calorieTarget` / `format`), dưới 1200 với nữ hoặc 1500 với nam (`calorieTarget` / `min`), trên 10000 (`calorieTarget` / `max`), hoặc JSON không phải một đơn kê, kể cả khi một con số nằm ngoài khoảng của cột chứa nó (`prescription` / `format`).

Ngoài ra: `SESSION_INVALID` (`profile_onboard`) hoặc `ONBOARDING_REQUIRED` (hai hàm kia) khi `app.user_id` không chỉ tới một người dùng còn hoạt động và, với hai hàm kia, đã onboarding.

### Khóa dòng: không bao giờ `FOR UPDATE` trên dòng được tham chiếu

**Một hàm được gọi từ route không bao giờ lấy `FOR UPDATE` trên một dòng mà bảng khác tham chiếu bằng khóa ngoại, trước hết là dòng `users`. Dùng `FOR NO KEY UPDATE`.**

- Mọi request có `Idempotency-Key` đã chèn một dòng vào `idempotency_keys` trước khi handler chạy. Khóa ngoại của dòng đó giữ khóa `FOR KEY SHARE` trên dòng `users` của người gọi cho tới hết transaction.
- `FOR UPDATE` xung đột với `FOR KEY SHARE`. Hai request cùng lúc của một người dùng vì thế chờ lẫn nhau: mỗi bên giữ khóa chia sẻ và đòi khóa độc quyền. Sau một giây PostgreSQL kết thúc một bên bằng `40P01 deadlock detected`, và request đó nhận `500 INTERNAL`. Đã đo trước khi sửa: mười `POST /onboarding` cùng lúc cho một `200` và chín `500`.
- `FOR NO KEY UPDATE` vẫn xếp hàng các lượt ghi của cùng một người (hai khóa `FOR NO KEY UPDATE` xung đột với nhau) mà không đụng tới `FOR KEY SHARE`. Đó cũng là khóa mà một lệnh `UPDATE` không đổi cột khóa tự lấy.
- `app._grant` lấy `FOR UPDATE` trên dòng `progression_state`: không bảng nào tham chiếu bảng đó, nên luật này không áp dụng ở đó. Thêm một khóa ngoại trỏ tới `progression_state` thì phải đổi khóa đó.
- Có test: mười `POST /onboarding`, mười `POST /me/biometrics`, và bốn mươi cặp `POST /me/biometrics` + `PATCH /me/archetype` gửi cùng lúc trên pool đã mở sẵn mười kết nối; tất cả `200`. Đổi một trong các khóa về `FOR UPDATE` là các test đó đỏ.

Một test về tranh chấp phải **mở sẵn các kết nối của pool** trước khi gửi (ví dụ mười lệnh `db.app.query('SELECT 1')` song song, ngay trước lượt gửi vì kết nối rảnh bị đóng sau mười giây). Pool chỉ có một kết nối đang mở thì request thứ hai chỉ chờ kết nối, hai request chạy lần lượt và test không chứng minh gì.

### Trần của đơn kê

Hàng rào cuối không lưu con số vô lý: `app._prescription_put` và `CHECK` của bảng `prescriptions` cùng giữ một khoảng cho mỗi con số. Mỗi trần là một số tròn nằm trên giá trị lớn nhất mà `calculatePrescription` cho ra trong toàn bộ khoảng đầu vào hợp lệ (`LIMITS`, hai giới tính, mọi mức vận động, mọi hệ phái):

| Con số | Lớn nhất từ `domain/` | Trần |
|---|---|---|
| `bmr` | 3862,5 | 5000 |
| `tdee` | 7338,8 | 10000 |
| `calorieTarget` | 8073 | 10000 |
| `proteinG` | 500 | 1000 |
| `carbsG` | 1014 | 2000 |
| `fatG` | 224 | 500 |
| `waterMl` | 4000 | 4000 |

Có test tính lại các giá trị lớn nhất trên 240 góc của khoảng đầu vào, gửi cả 240 đơn kê đó qua hàng rào (đều được nhận), rồi với từng con số: đúng bằng trần thì được lưu, trần cộng một, `1e9` và `1e400` thì bị từ chối, qua hàm lẫn qua `UPDATE` trực tiếp. **Đổi công thức ở `domain/energy.ts` hay nới `LIMITS` thì chạy lại test đó**: nó đỏ khi một giá trị hợp lệ vượt trần, và khi đó sửa trần ở cả hai chỗ trong `21-profile.sql`.

### Luật riêng của từng hàm


- **`recorded_at` của snapshot tăng nghiêm ngặt theo từng người dùng**: giá trị là `app.now()`, hoặc snapshot mới nhất cộng một micro giây nếu đồng hồ chưa vượt qua nó. Hai request đọc cùng một thời điểm (hoặc đồng hồ test đang đứng yên) vẫn cho hai dòng có thứ tự.
- **Hệ phái gửi kèm số đo mới chỉ được dùng khi số đo mới loại bỏ hệ phái hiện tại.** Khi đó thay đổi là bắt buộc vì an toàn, nên nó bỏ qua thời gian chờ và bắt đầu một thời gian chờ mới. Hệ phái hiện tại vẫn được phép thì hệ phái gửi kèm **không được áp dụng**: nếu áp dụng, `POST /me/biometrics` sẽ là đường vòng qua luật 14 ngày. Số đo mới loại bỏ hệ phái hiện tại mà không gửi hệ phái thay thế: `ARCHETYPE_NOT_ALLOWED`. Hệ phái gửi kèm luôn phải hợp lệ với số đo mới.
- **Thời gian chờ là 336 giờ** tính từ `archetype_set_at`, viết bằng giờ để không phụ thuộc múi giờ của phiên. Trong thời gian đó: `ARCHETYPE_COOLDOWN` kèm `details.availableAt` (ISO, UTC, tới mili giây; bằng đúng `Me.user.archetypeChangeAvailableAt`).
- **"Không được phép" được nói trước "hãy chờ"**: chờ xong thì nó vẫn đúng.
- **Gửi lại hệ phái đang có hiệu lực không phải là đổi**: được nhận bất cứ lúc nào và không bắt đầu thời gian chờ mới. Nhờ vậy lần gửi lại (với khóa mới) của một thay đổi đã thành công nhận `200` chứ không phải `409`.
- `profile_set_archetype` kiểm tra lại số đo của snapshot mới nhất. Người dùng đã quá 90 tuổi theo năm hiện tại nhận `VALIDATION_FAILED` (`birthYear` / `min`) dù thân request không có trường đó.

### Mười route

Mọi từ chối ở đây đều được **ném** (`AppError`, hoặc `HM000` từ hàm SQL), không trả về: không có gì một request bị từ chối đã ghi cần được giữ lại, nên transaction được hoàn lại. Thuộc tính lạ trong thân request bị bỏ qua.

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `POST /onboarding` | `session`, có khóa | `200 Me` | `422 VALIDATION_FAILED`, `422 AGE_NOT_ALLOWED`, `422 ARCHETYPE_NOT_ALLOWED` |
| `GET /me` | `session` | `200 Me` | – |
| `PATCH /me` | `user`, có khóa | `200 Me` | `422 VALIDATION_FAILED` (`displayName`, `timezone`), `422 NAME_NOT_ALLOWED` |
| `POST /me/biometrics` | `user`, có khóa | `200 PrescriptionResponse` | như `POST /onboarding` |
| `PATCH /me/archetype` | `user`, có khóa | `200 Me` | `422 VALIDATION_FAILED` (`archetype`; `birthYear` khi đã quá 90 tuổi), `422 AGE_NOT_ALLOWED`, `422 ARCHETYPE_NOT_ALLOWED`, `409 ARCHETYPE_COOLDOWN` |
| `GET /me/prescription` | `user` | `200 PrescriptionResponse` | – |
| `GET /settings` | `user` | `200 Settings` | – |
| `PATCH /settings` | `user`, có khóa | `200 Settings` | `422 VALIDATION_FAILED` |
| `GET /progression` | `user` | `200 Progression` | – |
| `GET /pet` | `user` | `200 Pet` | – |

- **`POST /onboarding` với người đã onboarding** trả `200` kèm `Me` hiện tại, không xét thân request và không đổi gì. Nhiều request cùng lúc với các khóa khác nhau: request đầu giữ khóa dòng `users` (`FOR NO KEY UPDATE`, lấy ngay đầu handler); các request sau chờ khóa đó, rồi thấy người dùng đã onboarding và trả cùng một `Me`. Có test với mười request: mười `200`, đúng một snapshot, một đơn kê, một dòng cài đặt, một dòng `progression_state`.
- **Handler khóa trước khi đọc.** Ba handler đọc hồ sơ, tính đơn kê từ thứ vừa đọc rồi mới gọi hàm ghi (`POST /onboarding`, `POST /me/biometrics`, `PATCH /me/archetype`) gọi `lockProfile(db)` (export của `routes/me.ts`: `SELECT 1 FROM users WHERE id = app.current_user_id() FOR NO KEY UPDATE`) **trước lần đọc đầu tiên**. Thiếu nó, hai request của cùng một người cùng tính từ trạng thái trước khi bên nào ghi, và bên ghi sau lưu một đơn kê thuộc về số đo đã không còn hiệu lực (đã đo: 39 trên 40 lượt, đơn kê 1616 kcal được lưu cho người có mục tiêu 3508 kcal). Khóa trong hàm SQL là quá muộn cho việc này: lúc đó route đã đọc xong. Bằng `app_auth`, câu lệnh chỉ chạm được dòng của chính người gọi (policy), nên nó không khóa ai khác. **Route nào sau này đọc trạng thái rồi tính ở Node rồi ghi cũng phải làm vậy.**
- **Thứ tự kiểm tra của route** giống của SQL: trường sai, rồi tuổi, rồi hệ phái. Route kiểm tra bằng `validateBiometrics` và `allowedArchetypes` của `domain/`, tính đơn kê, rồi gọi hàm; hàm kiểm tra lại tất cả. Tuổi dùng `ctx.now`, tức đúng thời điểm `app.now()` mà hàm SQL sẽ đọc.
- **Múi giờ** hợp lệ khi `Intl` nhận nó, nó có dấu `/` hoặc bằng `UTC`, **và** nó là một dòng của bảng `timezones`. Tên thiếu trong bảng là `422 VALIDATION_FAILED` (`timezone` / `format`), không bao giờ là `500` từ khóa ngoại. Thiếu hoặc không phải chuỗi: `required`.
- **`PATCH /me`** là một lệnh `UPDATE` thường trên hai cột mà chủ dòng được ghi; policy chọn dòng. Tên hiển thị được cắt khoảng trắng hai đầu, 1–40 ký tự đếm theo code point, qua `isDisplayName`; từ cấm (`422 NAME_NOT_ALLOWED`) chỉ được xét khi mọi trường khác hợp lệ. Nếu `CHECK` của cột từ chối một tên đã qua được route, lỗi `23514` được đổi thành `422 VALIDATION_FAILED` (`displayName` / `format`) bằng cách **ném** `AppError`, nên transaction vẫn được hoàn lại. Thành viên vắng mặt thì giữ nguyên; thân rỗng là `200` không đổi gì.
- **`PATCH /settings`**: thành viên có mặt phải hợp lệ, và mọi thành viên sai được liệt kê một lượt. Sai kiểu boolean là `format`; giá trị ngoài enum là `enum`; `excludedMealTags` không phải mảng là `format`, có thẻ ngoài `INGREDIENT_TAGS` là `enum`. Thẻ được lưu mỗi thẻ một lần, theo thứ tự của `INGREDIENT_TAGS`. **`soundEnabled` là thành viên đã biết nhưng chỉ đọc: gửi nó, với bất kỳ giá trị nào, là `422`** (`soundEnabled` / `format`), khác với thuộc tính lạ bị bỏ qua.
- **`PrescriptionResponse.biometrics`** là snapshot mới nhất. Đây là câu trả lời duy nhất mang số đo cơ thể: không đưa nó vào log và không đưa nó vào response nào khác.

### Read model (`server/src/readModels/me.ts`)

`buildMe(ctx)`, `buildProgression(ctx)`, `buildPet(ctx)`, `buildPrescription(ctx)` nhận bất cứ thứ gì có `db` là kết nối của request (`ctx` của một handler). Ba hàm đầu đọc bằng **một** câu lệnh, nên mọi thứ `Me` hiển thị thuộc cùng một thời điểm của cơ sở dữ liệu. Chúng chạy bằng `app_auth` trong transaction của request: điều kiện `user_id = app.current_user_id()` viết tường minh, và RLS là lớp lọc thứ hai bên dưới.

- `buildMe` trả bốn phần `progression`, `stats`, `pet`, `appearance` là `null` trước onboarding. Ba hàm còn lại dành cho route `auth: 'user'` và ném lỗi nếu người gọi chưa onboarding.
- `milestones` lấy từ các huy hiệu `BADGE_STREAK_*` đang sở hữu; `breakNotice` có khi `streak_before_break` khác `NULL`.
- `stats` đọc nước, dấu giờ ngủ và calo từ dòng `daily_logs` của **hôm nay** (ngày logic của `app.now()` theo múi giờ người dùng); ngày chưa có dòng nào thì cả ba bằng 0, và việc đọc không tạo dòng. Phút tập (`resistanceMinutes7d`, `cardioMinutes7d`) là tổng `elapsed_sec` / 60 của các buổi tập thuộc ngày logic hôm nay và sáu ngày trước, theo loại (CARDIO và HIIT gộp làm một); xem "Hai nhiệm vụ cốt truyện".

### Test

- `server/test/progression.sql.test.ts`, `server/test/profile.sql.test.ts`: tầng SQL, gọi hàm bằng `app_auth` qua `app_conn`; `app._grant` và `app._level` được gọi qua kết nối của chủ sở hữu vì không vai trò request nào gọi được chúng.
- `server/src/routes/me.test.ts`, `settings.test.ts`, `progression.test.ts`: qua HTTP. Mọi con số mong đợi được tính trong test bằng chính hàm của `domain/`.
- `newOnboardedUser(db, overrides?)` trong `server/test/http.ts`: `newUser` rồi `profile_onboard` bằng `app_auth` trên pool của app, với đơn kê tính như route tính (tuổi theo `app.now()`, nên đồng hồ test có hiệu lực). Trả `{ userId, token, email, input }`; mặc định là `ONBOARDING_INPUT` (170 cm, 65 kg, sinh 1996, nữ, `LIGHT`, `SUPPORTER`, `Asia/Ho_Chi_Minh`). Như `newUser`, tài khoản không có mật khẩu dùng được.
- Mồi nhử của các bảng này nằm ở `server/sql/80-decoy-base.sql`, ca tấn công ở `server/checks/attacks/base.ts` (xem "Cổng 2: API check và dòng mồi nhử").

### Phần cổng 1 không nhìn thấy

Cổng 1 đối chiếu vai trò, GRANT, RLS, policy và `search_path`. Những thay đổi sau **không** làm nó đỏ; chỉ test mới bắt được (đã chạy thử từng ca, kết quả ở báo cáo Task 14):

- thân hàm: bỏ `FOR UPDATE` trong `app._grant`; đổi `FOR NO KEY UPDATE` của ba hàm `profile_*` về `FOR UPDATE` (deadlock giữa hai request của một người); bỏ các trần trong `app._prescription_put`; để `app._level` đọc `xp_high_water` thay vì tổng sổ cái; bỏ thời gian chờ trong `profile_set_archetype`; để `profile_add_biometrics` áp dụng mọi hệ phái được gửi kèm; bỏ luật BMI hoặc sàn calo trong SQL;
- ràng buộc: đổi khóa duy nhất `(user_id, reason, ref_id)` của sổ cái; gỡ một trần của bảng `prescriptions`; gỡ điều kiện "một chiều" hay "không lặp" của `excluded_meal_tags`; gỡ `CHECK` của `excluded_meal_tags`, của `sound_enabled`, của khoảng chiều cao và cân nặng; gỡ chỉ mục "một vật phẩm đang dùng mỗi loại", khóa ngoại kép của `inventory`, chỉ mục duy nhất `(user_id, recorded_at)`;
- dữ liệu: một dòng `level_thresholds` hay `pet_stages` bị sửa tay (lần migrate sau seeder sẽ sửa lại, nhưng giữa hai lần thì không gì báo), hai vật phẩm mặc định cùng loại bị chặn bởi chỉ mục chứ không bởi cổng 1.

Sửa `20-progression.sql` hay `21-profile.sql` thì chạy `npm run server:test`, không chỉ `npm run db:verify`.

## Ngày và nhiệm vụ (`30-day.sql`, `routes/day.ts`, `readModels/day.ts`, `readModels/delta.ts`)

Vòng lặp hằng ngày: đọc ngày, tick nhiệm vụ `DAILY`, hoàn tác, đánh dấu giờ ngủ, đọc lịch sử. Hợp đồng nằm ở `docs/api/openapi.yaml` (`DayState`, `QuestState`, `ActionResult`, `Delta`, `DaySummary`, `DayDetail`); mục này ghi cách server giữ nó.

### Ngày logic, ngày đang mở

- Một ngày logic chạy từ 03:00 tới 02:59:59 theo đồng hồ của `users.timezone`; nhãn của nó là `app.logical_date(thời điểm, múi giờ)`. Thứ đưa vào `AT TIME ZONE` luôn là `users.timezone`, **không bao giờ** là múi giờ của phiên hay một độ lệch (`'+07:00'` là UTC−7 với PostgreSQL).
- Một ngày **đang mở cho tới khi job đóng ngày xử lý nó** (`progression_state.last_closed_date`), bất kể đồng hồ. Ngày có nhãn `≤ last_closed_date` không nhận lượt ghi nào nữa (`DAY_CLOSED`). Ngày có nhãn nhỏ hơn `onboard_date` cũng vậy: nó không tồn tại với người dùng đó, và job đóng ngày sẽ không bao giờ đi tới nó (trường hợp có thật: vừa onboarding xong thì đổi sang múi giờ chậm hơn một ngày).
- **Ngày chưa có hành động nào thì không có dòng `daily_logs`.** Đọc không bao giờ tạo dòng; chỉ một lượt ghi được chấp nhận mới tạo (`app._open_log`). Một lượt ghi bị từ chối không để lại dòng nào, kể cả dòng `daily_logs`.
- Đổi múi giờ không tính lại nhãn của dòng cũ. Sau khi đổi, "hôm nay" có thể là một ngày đã đóng: mọi lượt ghi nhận `DAY_CLOSED` cho tới khi ngày mới của múi giờ mới bắt đầu; `GET /day` vẫn trả lời bình thường.
- **Nhãn của server là thẩm quyền; `logicalDateOf` của `domain/` chỉ để app vẽ.** PostgreSQL và Node mỗi bên mang một bản sao của cơ sở dữ liệu múi giờ, và hai bản **đang** khác nhau: với Node của máy này (tz `2025b`) có bốn múi giờ chọn được mà hai bên đọc khác, `America/Vancouver` và `Canada/Pacific` (từ 01/11/2026 Node đưa British Columbia về UTC−8, PostgreSQL giữ UTC−7: mỗi ngày một giờ quanh 03:00), `Europe/Chisinau` và `Europe/Tiraspol` (Node đổi giờ lúc 00:00 UTC, PostgreSQL lúc 01:00 UTC: một giờ ở mỗi ngày đổi giờ). Vì vậy **một câu trả lời chỉ dùng một cơ sở dữ liệu múi giờ, của PostgreSQL**: mọi nhãn ngày, `closesAt`, `locked` và ngày mà một lượt ghi rơi vào đều do SQL tính (`app.logical_date`, `app.logical_day_end`) từ `users.timezone`; server không làm phép tính ngày nào bằng JavaScript cho một response. (Route chỉ dùng `addDays` / `daysBetween` của `domain/` để xét hai nhãn ngày trong query: phép tính lịch thuần, không đụng múi giờ.) Test trong `server/test/day.sql.test.ts` so hai bên trên **mọi** dòng của `timezones` và ghim đúng danh sách bốn múi giờ đó, mỗi múi giờ một dòng lý do: nó đỏ khi một múi giờ ngoài danh sách lệch, và đỏ khi một múi giờ trong danh sách khớp trở lại (nâng Node hay PostgreSQL thì sửa danh sách theo đúng điều test báo, không nới test).

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `quests` | `content` | Seed từ `server/content/quests.ts` theo `code`. `category` thuộc `STORY` / `DAILY` / `HIDDEN`, `target_count ≥ 1`, `archetypes`, `is_active`, và `position` (thứ tự trong file nội dung: thứ tự `DayState.quests`). |
| `daily_logs` | `own_read` | Một dòng cho mỗi người dùng và ngày logic có hành động: **duy nhất theo `(user_id, logical_date)`**. `calories_in ≥ 0`, `water_ml ≥ 0`, `bedtime_marked_at`, `closed_at`, `story_completed`. Khóa duy nhất `(id, user_id)` là đích của khóa ngoại kép từ hai bảng con. |
| `quest_completions` | `own_read` | Tiến độ của một nhiệm vụ trong một ngày: **duy nhất theo `(daily_log_id, quest_id)`**, `progress ≥ 0`, `completed_at`. Khóa ngoại kép `(daily_log_id, user_id)` → `daily_logs (id, user_id)`: dòng con không thể mang `user_id` khác với dòng ngày của nó (policy lọc theo chính cột đó). |
| `quest_ticks` | `own_read` | Mỗi lượt tick một dòng, **`id` là action id** (chính là `Idempotency-Key` của request). `occurred_at`: lúc người dùng làm (lượt gửi trễ mang thời điểm cũ hơn); `created_at`: lúc server ghi; `undone_at`. Cùng khóa ngoại kép. |

- `created_at` của tick **tăng nghiêm ngặt trong từng cặp (ngày, nhiệm vụ)** (`app.now()`, hoặc tick mới nhất cộng một micro giây), có chỉ mục duy nhất giữ: "tick mới nhất" luôn là đúng một dòng, kể cả khi đồng hồ đứng yên. Cửa sổ hoàn tác 10 giây đếm từ `created_at`, và `QuestState.lastTick.at` là chính giá trị đó.
- `progress` không vượt `target_count`: **không** phải ràng buộc (`CHECK` không đọc được bảng khác) mà do hàm giữ, dưới khóa dòng. Test 20 lượt tick cùng lúc canh nó.
- Tick không bao giờ bị xóa: hoàn tác là `undone_at` cộng hai dòng sổ cái trái dấu.

### Seeder

`server/src/seed/quests.ts`: upsert theo `code` như các seeder khác (chạy lại không ghi lại dòng nào đang đúng, sửa lại dòng bị lệch, không xóa dòng đã gỡ khỏi nội dung). Nhiệm vụ giữ nguyên `id` qua mọi lần seed.

### Ba hàm client gọi

Cả ba là `SECURITY DEFINER`, chỉ `app_auth` gọi được, lấy người dùng từ `app.current_user_id()`, không nhận số lượng nào. Mỗi hàm trả về **kết quả của `app._grant`** (`xpBefore`, `xpAfter`, `coinBefore`, `coinAfter`, `highWaterBefore`, `highWaterAfter`, `applied`) cộng `reason`, `ref` (khóa của các dòng sổ cái nó có thể đã ghi), `logicalDate` (ngày mà lượt ghi rơi vào) và phần riêng. Không được thưởng gì thì đó là một lượt cộng 0: `applied = false`, các tổng giữ nguyên.

| Hàm | Phần riêng | Việc |
|---|---|---|
| `quest_tick(p_quest_code text, p_action_id uuid, p_occurred_at timestamptz) → jsonb` | `progress`, `completed` | Một lượt tick của nhiệm vụ `DAILY`. `p_action_id` thành `id` của tick. Thưởng `xp_reward` / `coin_reward` với `QUEST_TICK` / id tick. `WATER_8` tính lại `water_ml = round(mục tiêu nước × progress / target_count)` (AR-12). |
| `quest_undo(p_quest_code text, p_tick_id uuid) → jsonb` | `progress`, `completed` (luôn `false`) | Lấy lại một tick: `undone_at`, `progress − 1`, bỏ `completed_at`, tính lại `water_ml`, và ghi sổ cái **đúng số đã cộng cho chính tick đó** với dấu ngược (`QUEST_TICK_UNDO` / id tick), đọc từ sổ cái chứ không từ phần thưởng hiện tại của nhiệm vụ. `xp_high_water` không giảm. |
| `day_bedtime(p_action_id uuid, p_occurred_at timestamptz) → jsonb` | `bedtimeMarkedAt`, `completed` (lượt gọi này hoàn thành nhiệm vụ ẩn) | "Khép lại hôm nay". `p_action_id` không đặt tên cho dòng nào: dấu giờ ngủ là một cột của ngày. |

Lỗi được ném với `SQLSTATE HM000`, theo thứ tự:

- `quest_tick`: (tick mang id đó đã có: xem dưới) → `QUEST_NOT_FOUND` (không có, không `is_active`, hoặc không thuộc hệ phái của người gọi) → `QUEST_NOT_TICKABLE` (không phải `DAILY`) → `OCCURRED_AT_INVALID` → `DAY_CLOSED` → `QUEST_ALREADY_COMPLETE`.
- `quest_undo`: `TICK_NOT_FOUND` (không có tick đó, không phải của người gọi, đã hoàn tác, hoặc thuộc nhiệm vụ khác với mã trong đường dẫn; mã nhiệm vụ lạ cũng rơi vào đây) → `UNDO_NOT_LATEST` (còn một tick sống ghi sau nó, cùng nhiệm vụ, cùng ngày) → `UNDO_WINDOW_EXPIRED` (ghi quá 10 giây trước) → `DAY_CLOSED` → `UNDO_COINS_SPENT` (xu của tick đã bị tiêu: hoàn tác sẽ đưa tổng xu xuống dưới 0).
- `day_bedtime`: `OCCURRED_AT_INVALID` → `DAY_CLOSED` → `BEDTIME_TOO_EARLY`.
- Cả ba: `ONBOARDING_REQUIRED` khi `app.user_id` không chỉ tới một người dùng còn hoạt động và đã onboarding.

Luật riêng:

- **Tick mang id đã có.** Của chính người gọi: lượt gọi là **no-op** trả về trạng thái hiện tại của nhiệm vụ mà tick đó thuộc về (`applied = false`), không xét gì khác: không `QUEST_ALREADY_COMPLETE` cho lần gửi lại của tick thứ tám, không `DAY_CLOSED` cho ngày đã đóng từ đó. Của người khác: `IDEMPOTENCY_KEY_REUSED`. Qua HTTP, lần gửi lại thường được tầng idempotency trả lời trước khi tới đây; nhánh này dành cho khi câu trả lời đã lưu không còn (quá 7 ngày, đổi `JOURNAL_KEY`).
- **`occurredAt`** (`app._occurred_at`): vắng thì là `app.now()`; đi trước `app.now()` quá 120 giây là `OCCURRED_AT_INVALID`; đi trước ít hơn thì coi là bây giờ (đồng hồ máy chạy nhanh); cũ hơn 48 giờ là `DAY_CLOSED`. Tick được ghi vào ngày của thời điểm đó, không phải ngày của lúc gửi.
- **Giờ ngủ (AR-13)** xét giờ đồng hồ của thời điểm (đã xử lý như trên) theo múi giờ người dùng: 03:00–17:59 là `BEDTIME_TOO_EARLY`; còn lại thì `bedtime_marked_at` là **thời điểm sớm nhất trong các dấu đã được nhận** (`least(dấu đang có, dấu mới)`: dấu bấm lúc 22:55 mà tới sau dấu bấm lúc 23:10 vẫn là giờ người đó đánh dấu); 18:00–22:59 thì hoàn thành nhiệm vụ ẩn `BEDTIME_BEFORE_23` của ngày đó, một lần, thưởng theo dòng `quests` (30 XP, 15 xu) với `QUEST_COMPLETE` / `BEDTIME_BEFORE_23:<ngày logic>`. Gọi lại không phải lỗi và không được gì. "Một lần" có hai lớp giữ: `completed_at` của dòng tiến độ, và khóa duy nhất của sổ cái. Dấu lúc 02:30 thuộc về ngày logic hôm trước.
- **Hoàn tác không bao giờ đưa một tổng sổ cái xuống dưới 0.** Nếu số xu của tick đã bị tiêu trước khi lượt hoàn tác tới (mua vật phẩm trong 10 giây đó, xem "Cửa hàng, kho đồ và đặc quyền"), hàm từ chối bằng `409 UNDO_COINS_SPENT` (từ Task 37; trước đó là mã tạm `UNDO_WINDOW_EXPIRED`) và không ghi gì: tick vẫn còn, vật phẩm đã mua vẫn là của người dùng. Hợp đồng ghi `xp` và `coin` có `minimum: 0`, và không gì kẹp một tổng sổ cái.
- `LEVEL_UP` và `PET_STAGE_UP` đi theo `xp_high_water`: tick, hoàn tác rồi tick lại không báo lên cấp lần thứ hai.

### `app.logical_day_end` và các hàm nội bộ

`app.logical_day_end(ts timestamptz, tz text) → timestamptz` đứng cạnh `app.logical_date` (ba vai trò request gọi được, đăng ký `'invoker'`, không đọc bảng nào): **thời điểm sớm nhất sau `ts` mà `app.logical_date(·, tz)` cho một nhãn khác**. Chỉ là định nghĩa đó, không phải "03:00 giờ địa phương kế tiếp", nên nó đúng cả ở nơi 03:00 tới hai lần (Athens 25/10/2026: ngày kết thúc ở lần đầu, trong khi `timestamp AT TIME ZONE` chọn lần sau), không tới lần nào (Athens 29/03/2026), và ở nơi **nhãn đi lùi** một lúc: `Pacific/Chatham` ngày 04/04/2026, 03:45 thành 02:45, nên ngày 05 bắt đầu lúc 03:00, dừng lúc 03:45 rồi bắt đầu lại sau 15 phút, và `closesAt` lần lượt là 13:15, 14:00, 14:15 UTC. Hàm đi từng phút tròn rồi từng giây của phút có thay đổi (độ lệch múi giờ là số giây nguyên); cả ngày phía trước tốn khoảng nửa mili giây (đã đo). `closesAt` của `GET /day` là `app.logical_day_end(app.now(), users.timezone)`: **đừng bao giờ tính nó ngoài SQL**.

| Hàm nội bộ | Việc |
|---|---|
| `app._occurred_at(timestamptz) → timestamptz` | Luật `occurredAt` ở trên; trả về thời điểm lượt ghi được tính cho. |
| `app._open_log(p_user uuid, p_occurred_at timestamptz) → daily_logs` | Khóa dòng `users` của người dùng, xét ngày (`DAY_CLOSED`), rồi trả về dòng `daily_logs` của ngày đó, **tạo nếu chưa có**, đã khóa tới hết transaction. Mọi hàm đưa một lượt ghi vào một ngày (calo, buổi tập, nhật ký ở các nhiệm vụ sau) gọi nó trước tiên. |
| `app._story_check(p_daily_log uuid) → boolean` | Đặt `story_completed` khi mọi nhiệm vụ `STORY` đang hoạt động của hệ phái người dùng đều có `completed_at` trong ngày đó; `true` **chỉ ở lần gọi tạo ra thay đổi**. Ngày không có nhiệm vụ `STORY` nào thì không bao giờ "xong hết". Tick và giờ ngủ không gọi nó (chúng không hoàn thành nhiệm vụ `STORY`); `app._add_calories` và `workout_complete` (`31-story.sql`) gọi nó ngay khi hoàn thành một nhiệm vụ `STORY`, và route báo `STORY_ALL_DONE` đúng ở lượt đó. |

Ba hàm nội bộ đăng ký `'invoker'`, không vai trò nào được gọi.

### Khóa: một thứ tự, một chế độ

**Mọi hàm đưa một lượt ghi vào một ngày lấy khóa theo đúng thứ tự này, và không bao giờ lấy khóa đứng trước trong khi đang giữ khóa đứng sau:**

1. dòng `users` của người gọi, `FOR NO KEY UPDATE`;
2. dòng `daily_logs`, `FOR NO KEY UPDATE`;
3. dòng `quest_completions`, `FOR NO KEY UPDATE`;
4. dòng `progression_state`, `FOR UPDATE` (bên trong `app._grant`; không bảng nào tham chiếu bảng này).

- Dòng `users` là **mutex của một người dùng**: mọi lượt ghi vào ngày của người đó chạy lần lượt, và mỗi lượt thấy những gì lượt trước đã commit (`READ COMMITTED`). `app._open_log` lấy nó trước khi đọc múi giờ và `last_closed_date`. **Job đóng ngày phải lấy cùng khóa đó (`FOR NO KEY UPDATE` trên dòng `users`) trước khi dời `last_closed_date`**: thiếu nó, một tick đã đọc "ngày còn mở" có thể ghi vào ngày vừa bị đóng. Job lấy khóa **từng người một, mỗi người một transaction, và giữ thật ngắn**: trong lúc nó giữ dòng `users` của ai thì mọi lượt ghi của người đó đứng chờ, và lượt ghi chờ quá `lock_timeout` (5 giây) hiện nhận `500`.
- Ba khóa đầu là `FOR NO KEY UPDATE` vì dòng của chúng được bảng khác tham chiếu (xem "Khóa dòng: không bao giờ `FOR UPDATE` trên dòng được tham chiếu"). Với dòng `users` hậu quả là tức thì: đổi sang `FOR UPDATE` thì 20 tick cùng lúc kết thúc bằng deadlock và `500`.
- Hai test không cần may mắn giữ luật này (`server/test/day.sql.test.ts`): một test gọi từng hàm trong một transaction còn mở rồi, từ kết nối khác, đòi `FOR KEY SHARE NOWAIT` **lấy được** trên dòng `users`, `daily_logs`, `quest_completions` của người đó và `FOR NO KEY UPDATE NOWAIT` **không lấy được** (`55P03`); test kia giữ lần lượt từng khóa, chờ tới khi hàm thật sự đứng chờ (`pg_stat_activity`), rồi đòi mọi dòng đứng **sau** trong thứ tự vẫn còn tự do. Đảo thứ tự hay đổi chế độ khóa ở bất kỳ hàm nào là một trong hai test đó đỏ, không cần tới một cuộc đua.
- Deadlock và lỗi tuần tự hóa hiện được trả lời bằng `500`; thiết kế là để chúng không xảy ra.

### Sáu route

Mọi từ chối đều được **ném** (`AppError`, hoặc `HM000` từ hàm), không trả về: một lượt ghi bị từ chối không để lại tick, tiến độ, dòng sổ cái hay dòng `daily_logs` nào. Vì chỉ phản hồi 2xx được ghi nhớ, một khóa đã bị từ chối dùng lại được.

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `GET /day` | `user` | `200 DayState` | – |
| `POST /day/quests/{questCode}/progress` | `user`, có khóa | `200 ActionResult` | `404 QUEST_NOT_FOUND`, `409 QUEST_NOT_TICKABLE`, `409 QUEST_ALREADY_COMPLETE`, `409 DAY_CLOSED`, `422 OCCURRED_AT_INVALID`, `422 VALIDATION_FAILED` (`body`; `occurredAt` / `format`), `409 IDEMPOTENCY_KEY_REUSED` |
| `POST /day/quests/{questCode}/undo` | `user`, có khóa | `200 ActionResult` | `404 TICK_NOT_FOUND`, `409 UNDO_NOT_LATEST`, `409 UNDO_WINDOW_EXPIRED`, `409 DAY_CLOSED`, `409 UNDO_COINS_SPENT`, `422 VALIDATION_FAILED` (`body`; `tickId` / `required`, `format`) |
| `POST /day/bedtime` | `user`, có khóa | `200 ActionResult` | `409 BEDTIME_TOO_EARLY`, `409 DAY_CLOSED`, `422 OCCURRED_AT_INVALID`, `422 VALIDATION_FAILED` (`body`; `occurredAt` / `format`) |
| `GET /day/history?from=&to=` | `user` | `200 DayHistory` | `422 VALIDATION_FAILED` (`from`, `to`) |
| `GET /day/history/{date}` | `user` | `200 DayDetail` | `422 VALIDATION_FAILED` (`date` / `format`) |

- **`ActionResult.actionId` luôn là `Idempotency-Key` của request**, kể cả với hoàn tác và giờ ngủ. Với tick nó cũng là id của tick: app gửi lại nó trong `{ tickId }` để hoàn tác.
- **`ActionResult.day` luôn là hôm nay** (`buildDay`), kể cả khi lượt ghi rơi vào ngày trước (tick gửi trễ kèm `occurredAt`): app coi `day` trong câu trả lời là ngày hiện tại và lưu đè lên bộ nhớ đệm của nó. Tick gửi trễ vì thế có `delta` nhưng không hiện trong `day`.
- **`delta`**: tổng có dấu của các dòng sổ cái request này ghi (hoàn tác là số âm), rồi `events`: `QUEST_COMPLETED` khi lượt tick đưa nhiệm vụ tới đích (cả lần hoàn thành lại sau một lượt hoàn tác) hoặc khi dấu giờ ngủ hoàn thành nhiệm vụ ẩn; `LEVEL_UP` (`perkPointsGained` = số cấp vượt qua) và `PET_STAGE_UP` khi `xp_high_water` vượt ngưỡng. Route gọi `log.ledger` cho từng dòng sổ cái (`logGrants`).
- **Cùng khóa, thân khác là `409 IDEMPOTENCY_KEY_REUSED`** (tầng HTTP), và chỉ khi request đầu tiên của khóa đó **đã commit**: lúc ấy tick đã có trên server, không gì bị mất. App chỉ thêm `occurredAt` khi gửi sau hơn 60 giây, nên một bản ghi đã gửi không kèm `occurredAt` rồi gửi lại **có** kèm nhận `409` đúng trong trường hợp đó (có test). Khóa mà server chưa từng thấy, hoặc khóa của một request đã bị từ chối hay kết thúc bằng `500`, thì tự do: lần gửi sau, kèm `occurredAt` hay không, chạy bình thường.
- **Thân của ba route ghi là một object JSON.** Không có thân là `422 VALIDATION_FAILED` (`body` / `required`: hợp đồng ghi thân là bắt buộc; app luôn gửi ít nhất `{}`); `null`, mảng, số, chuỗi hay boolean là `422` (`body` / `format`). Thuộc tính lạ trong object bị bỏ qua. (Các route hồ sơ coi thân không phải object là "không có thành viên nào" và trả lời bằng các trường `required` của chúng; ba route này không có trường bắt buộc nào ngoài `tickId`, nên tự nêu tên `body`.)
- **`occurredAt` phải là một thời điểm có thật**, viết theo RFC 3339 kèm múi giờ (`…Z` hoặc `…+07:00`): ngày có trên lịch (`2027-02-30` không có; JavaScript tự nó sẽ đọc thành 2 tháng 3), giờ 00–23 (`T24:00:00` bị từ chối), phút và giây 00–59, độ lệch tới `23:59`. Sai là `422 VALIDATION_FAILED` (`occurredAt` / `format`), như nhau ở tick và giờ ngủ. Route chuyển nó về một cách viết duy nhất trước khi đưa vào SQL (`instantText` của `routes/day.ts`: UTC, giữ phần lẻ của giây như đã viết tới micro giây). Không bao giờ đưa nguyên văn: RFC 3339 cho độ lệch tới ±23:59, PostgreSQL chỉ đọc tới ±15:59. `tickId` phải là UUID. Mã nhiệm vụ trong đường dẫn là bất cứ chuỗi nào: chuỗi lạ là `404`, không bao giờ `500`.
- **`GET /day`** không tạo dòng nào. `locked` chỉ đúng với nhiệm vụ `HIDDEN` khi giờ địa phương là 03:00–17:59 (đúng những giờ `day_bedtime` từ chối). `lastTick` là tick sống mới nhất của một nhiệm vụ `DAILY` (để hoàn tác sau khi mở lại app); sau một lượt hoàn tác nó trỏ về tick sống đứng trước, không về `null`. `unreadCount` đếm thông báo chưa đọc của chính người gọi; `celebrations` là các thông báo `STREAK_MILESTONE` chưa đọc, cũ nhất trước (xem "Đóng ngày, bộ lập lịch và hộp thư").
- **`closesAt` là thời điểm sớm nhất sau "bây giờ" mà nhãn ngày logic đổi**, do SQL tính bằng `app.logical_day_end` trong cùng câu lệnh đọc ngày: cùng hàm, cùng cơ sở dữ liệu múi giờ với nhãn của `GET /day` và với ngày một lượt ghi rơi vào. Có test qua HTTP: tick gửi một mili giây trước `closesAt` rơi vào ngày `GET /day` đang hiện, tick gửi đúng `closesAt` rơi vào ngày sau, ở tám ranh giới (hai ngày đổi giờ 2026 của New York, Kolkata, Kathmandu, Lord Howe, Athens, Kiritimati, Pago Pago) và ở bốn múi giờ mà Node đọc khác PostgreSQL; cùng một test cho `Pacific/Chatham`, nơi nhãn đi lùi.
- **`GET /day/history`**: `from`, `to` là nhãn ngày có thật (`2027-02-30` và năm `0000` là `format`), `to ≥ from` (`to` / `min`), nhiều nhất 92 ngày (`to` / `max`). `outcome`: trước `onboard_date` là `NONE`; sau `last_closed_date` là `OPEN` (kể cả ngày chưa tới); đã đóng và `story_completed` là `COMPLETED`; đã đóng, chưa xong mà có vé dùng cho ngày đó là `FROZEN`; đã đóng còn lại là `MISSED` (ngày bỏ lỡ không cần dòng `daily_logs`). Thứ tự đó là thứ tự `closeDays` xét (AR-10: vé cộng nhiệm vụ đã xong là `COMPLETED`). `workoutMinutes` là tổng giây của các buổi tập của ngày đó / 60.
- **`GET /day/history/{date}`**: tóm tắt của ngày đó và các hành động, mới nhất trước (theo `occurred_at`), đọc bằng **một** câu lệnh: một tick commit trong lúc đó có mặt ở cả hai phần hoặc không ở phần nào. `TICK`: `label` là mã nhiệm vụ, `undone` đúng với tick đã hoàn tác (tick đó vẫn được liệt kê). `BEDTIME`: `id` là id của dòng `daily_logs`. `mealSlot` và `value` là `null` với cả hai loại. `NUTRITION` và `WORKOUT`: xem "Hai nhiệm vụ cốt truyện".

### Read model

- `buildDay(ctx, logicalDate?)`: một câu lệnh, một thời điểm của cơ sở dữ liệu cho cả ngày, kể cả `closesAt`. Không truyền ngày thì là hôm nay; truyền ngày thì là ngày đó (`closesAt` khi ấy tính từ 12:00 trưa của ngày đó theo đồng hồ múi giờ; nhiệm vụ ẩn chỉ `locked` khi ngày đó là hôm nay). File này không import gì về múi giờ từ `domain/`.
- `buildDaySummaries(ctx, from, to)`, `buildDayDetail(ctx, date)`: cùng một câu lệnh (`SUMMARIES`), `buildDayDetail` bật thêm cột hành động. Phút tập và hành động `NUTRITION` / `WORKOUT` đã nằm trong chính câu lệnh đó (`UNION` bên trong); `FROZEN` cũng vậy (một `EXISTS` trên `freeze_tickets`), không thêm câu lệnh thứ hai.
- `buildDelta(grants, events)` và `logGrants(ctx, grants)` (`readModels/delta.ts`): `grants` là các kết quả `app._grant` kèm `reason`, `ref` mà hàm SQL trả về; `events` là những gì route tự biết (`QUEST_COMPLETED`, `STORY_ALL_DONE`). Mọi route ghi có thưởng dùng lại cặp này.
- Tất cả chạy bằng `app_auth` trong transaction của request, điều kiện người dùng viết tường minh, RLS lọc bên dưới. Không hàm nào ghi.

### Mồi nhử, ca tấn công, test

- `server/sql/81-decoy-day.sql`: `DECOY_1` có một dòng `daily_logs` (`2026-01-01`), một dòng tiến độ và một tick của `WATER_8`, ghi từ lâu: thứ duy nhất đứng giữa tick đó và một lượt hoàn tác của người khác là phép kiểm chủ sở hữu.
- `server/checks/attacks/day.ts` (bốn ca): `quest_undo` với id tick của mồi nhử (`TICK_NOT_FOUND`); `quest_tick` dùng id đó làm action id (`IDEMPOTENCY_KEY_REUSED`); `quest_tick` và `day_bedtime` với thời điểm một năm sau (`OCCURRED_AT_INVALID`); một tick và lượt hoàn tác của A ghi dòng của A và không dòng nào của mồi nhử.
- `server/test/day.sql.test.ts`: seeder; nhãn ngày của `app._open_log` so với `logicalDateOf` trên một lưới múi giờ và thời điểm (Hồ Chí Minh, New York quanh hai ngày đổi giờ 2026, Kiritimati, Pago Pago, Athens, UTC), cả với `occurredAt`; **mọi** múi giờ của `timezones` so với `logicalDateOf` quanh 03:00 địa phương, với danh sách ghim các múi giờ lệch; `app.logical_day_end` theo đúng định nghĩa của nó ở mọi múi giờ và ở Chatham; lần gửi lại của một tick; `app._story_check`; các ràng buộc; chế độ và thứ tự khóa.
- `server/src/routes/day.test.ts`: qua HTTP, thời gian là đồng hồ test. Các cuộc đua (20 tick cùng lúc; tick, hoàn tác, tick nhiệm vụ khác và giờ ngủ cùng lúc, 25 vòng) mở sẵn mười kết nối của pool trước khi gửi.
- `server/src/readModels/delta.test.ts`: không cần cơ sở dữ liệu.

### Phần ba cổng không nhìn thấy

Cổng 1 và cổng 3 đọc catalog; cổng 2 gọi hàm để hỏi quyền và chạy bốn ca tấn công ở trên. Những thay đổi sau **không** làm cổng nào đỏ (trừ chỗ ghi rõ); chỉ test mới bắt được, và từng ca đã được chạy thử (kết quả ở báo cáo Task 20):

- thân hàm: bỏ phép kiểm chủ sở hữu trong `quest_undo` (ca tấn công của cổng 2 và test route đỏ); bỏ `last_closed_date` trong `app._open_log`; tính ngày logic bằng múi giờ của server; đảo thứ tự khóa; đổi `FOR NO KEY UPDATE` thành `FOR UPDATE`; bỏ trần `target_count`; bỏ cửa sổ 10 giây; thưởng nhiệm vụ ẩn lần thứ hai; cho hoàn tác đưa tổng xuống dưới 0;
- ràng buộc: khóa duy nhất `(user_id, logical_date)` và `(daily_log_id, quest_id)`, hai khóa ngoại kép, chỉ mục duy nhất `(daily_log_id, quest_id, created_at)`; `progress ≤ target_count` thì không có ràng buộc nào để gỡ;
- đồng hồ: một `now()` thay cho `app.now()` ở chỗ không test nào đọc lại (ví dụ `completed_at`);
- dữ liệu: một dòng `quests` bị sửa tay (seeder sửa lại ở lần migrate sau);
- thân response: route trả ngày của người khác hay một ngày khác với hôm nay. Đó là test của route;
- múi giờ: hai bản sao của cơ sở dữ liệu múi giờ (PostgreSQL, Node) lệch nhau thì không cổng nào báo. Test đối chiếu mọi múi giờ báo, nhưng chỉ trên lưới của nó (quanh 03:00 địa phương, các ngày đổi giờ và sáu ngày khác của năm 2026) và chỉ với Node của máy chạy test; app trên điện thoại mang bản sao thứ ba mà không test nào ở đây thấy. Hệ quả đã biết: ở bốn múi giờ trong danh sách ghim, app tự tính ngày bằng `logicalDateOf` sẽ lệch với server một giờ quanh 03:00; `logicalDate` và `closesAt` trong câu trả lời của server mới là thứ đúng;
- **`occurredAt` lùi về trước được tin, trong 48 giờ**: đó là thiết kế (bản ghi làm lúc không có mạng), và không cổng hay test nào coi nó là lỗi. Một client vì thế tự đặt được thời điểm tới 48 giờ trước: dấu giờ ngủ bấm lúc 23:30 có thể khai là 22:55 và nhận phần thưởng của nhiệm vụ ẩn. Giới hạn của nó là ngày còn mở: job đóng ngày đóng ngày lại thì thời điểm thuộc ngày đó không còn được nhận;
- job đóng ngày lấy khóa dòng `users` trước khi dời `last_closed_date`: điều đó do test thứ tự khóa và các cuộc đua của `server/src/jobs/dayClose.race.test.ts` giữ, không cổng nào thấy (xem "Đóng ngày, bộ lập lịch và hộp thư").

Sửa `30-day.sql` thì chạy `npm run server:test`, không chỉ `npm run db:verify`.

## Hai nhiệm vụ cốt truyện (`31-story.sql`, `routes/nutrition.ts`, `routes/workout.ts`, `seed/exercises.ts`)

Hai nhiệm vụ `STORY` được hoàn thành thật: `NUTRITION_TARGET` bằng calo ghi tay, `WORKOUT_MAIN` bằng một buổi tập chọn từ thư viện bài tập. Hợp đồng nằm ở `docs/api/openapi.yaml` (`NutritionLogRequest`, `WorkoutCatalog`, `WorkoutDetail`, `WorkoutCompleteRequest`, `WorkoutResult`, `ActionResult`); mục này ghi cách server giữ nó.

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `exercise_moves` | `content` | Khóa chính `code`. `name`, `demo_code` (`NULL` với động tác chỉ có chữ), `steps` (đúng 3 dòng, mảng một chiều), `caution`. |
| `exercise_items` | `content` | Khóa chính `id`, duy nhất `code`. `modality` (5 loại), `duration_sec` ∈ {300, 900, 1800, 2700}, `space_needed` (4 loại), `equipment` (tập con của `tham`, `ta-tay`, `day-khang-luc`; rỗng = không cần gì), `met_value > 0`, `sets ≥ 1` (số lần lặp các bước `MAIN`), `archetypes`. |
| `exercise_item_steps` | `content` | Khóa chính `(item_id, position)`, `position` từ 1 theo thứ tự trong file nội dung. `move_code` (khóa ngoại), `phase` (`WARMUP`, `MAIN`, `COOLDOWN`), `seconds > 0`, `reps_text`. |
| `nutrition_logs` | `own_read` | **`id` là action id.** `kcal` 1–5000 (`numeric`, nhận số lẻ), `label` khác rỗng và tối đa 60 ký tự hoặc `NULL`, `occurred_at`. `meal_slot` và `meal_id` cùng `NULL` (ghi tay) hoặc cùng có (bữa trong thực đơn; nhiệm vụ thực đơn thêm khóa ngoại của `meal_id`). Khóa ngoại kép `(daily_log_id, user_id)` → `daily_logs (id, user_id)`. |
| `workout_sessions` | `own_read` | **`id` là action id.** `exercise_item_id` (khóa ngoại), `modality` và `duration_sec` chép từ bài tập lúc tập, `elapsed_sec` từ 1 tới 2 × `duration_sec`, `completed` **bằng đúng** `elapsed_sec × 2 ≥ duration_sec` (ràng buộc), `xp_awarded`, `coin_awarded ≥ 0`, `occurred_at`. Cùng khóa ngoại kép. |

Không bảng nào có hàng bị xóa, không có route hoàn tác: một lần ghi calo không lấy lại được (AR-12), và không có số calo âm.

### Seeder

`server/src/seed/exercises.ts`, từ `server/content/exercises.ts` (nội dung khép kín của nhiệm vụ thư viện bài tập; seeder không sửa nó): động tác và bài tập upsert theo `code` (bài tập giữ nguyên `id`, nên buổi tập không mất chỗ trỏ), bước upsert theo `(item_id, position)`. Bước mà một bài tập trong nội dung không còn có thì bị xóa (tổng giây các bước phải bằng thời lượng). Chạy lại không ghi lại dòng nào đang đúng. Có test: số dòng của ba bảng bằng độ dài trong file nội dung, nên thư viện lớn hơn sau này được kiểm ở lần `server:test` kế tiếp.

### Dải calo của nhiệm vụ dinh dưỡng

`app._calorie_band(p_target numeric) → numrange` là **dải duy nhất** mà chốt nhiệm vụ dùng: `[floor((9 × target + 5) / 10), floor((11 × target + 5) / 10)]`, hai đầu tính vào, số học `numeric` chính xác. Với mục tiêu nguyên đó là `Math.round(0,9 × target)` và `Math.round(1,1 × target)`, tức `calorieWindow` của `domain/energy.ts`, dải người dùng nhìn thấy. Test so cả 2801 mục tiêu nguyên từ 1200 tới 4000 (`generate_series` gọi chính hàm này) và in số mục tiêu đã so; thêm test qua HTTP ở `min − 1`, `min`, `max`, `max + 1` với mục tiêu 1235, 1245 (tích ×0,9 và ×1,1 tận cùng .5) và 2000.

### Hàm

| Hàm | Việc |
|---|---|
| `app._add_calories(p_log uuid, p_kcal numeric) → jsonb` (nội bộ) | Cộng `p_kcal` vào `calories_in` của dòng ngày (người gọi đã giữ khóa), rồi, nếu `NUTRITION_TARGET` của ngày đó chưa xong và tổng nằm trong dải, hoàn thành nó **một lần** và thưởng 50 XP / 20 xu (`QUEST_COMPLETE` / `NUTRITION_TARGET:<ngày logic>`). Tổng ra khỏi dải sau đó không đổi gì. Gọi `app._story_check`. Nhiệm vụ thực đơn (`nutrition_log_slot`) dùng lại chính hàm này. |
| `nutrition_log_manual(p_action_id uuid, p_kcal numeric, p_label text, p_occurred_at timestamptz) → jsonb` | Một lần ghi tay. |
| `workout_complete(p_action_id uuid, p_exercise_item_id uuid, p_elapsed_sec int, p_occurred_at timestamptz) → jsonb` | Một buổi tập, theo AR-11 (dưới). |

Hai hàm gọi được là `SECURITY DEFINER`, chỉ `app_auth`, lấy người dùng từ `app.current_user_id()`, không nhận số thưởng nào. Mỗi hàm trả **kết quả của `app._grant`** cộng `reason`, `ref`, `logicalDate` và phần riêng:

- `app._add_calories`, `nutrition_log_manual`: `completed` (lượt này hoàn thành nhiệm vụ), `storyAllDone` (lượt này làm đủ cốt truyện của ngày).
- `workout_complete`: `completed` (buổi tập đạt nửa thời lượng, bất kể được gì), `questCompleted`, `storyAllDone`, `xpAwarded`, `coinAwarded`, `elapsedSec`, `durationSec`. `reason` / `ref` là `QUEST_COMPLETE` / `WORKOUT_MAIN:<ngày>` cho buổi hoàn thành, `WORKOUT_PARTIAL` / id buổi tập cho buổi khác.

**XP của buổi tập (AR-11).** Gọi `given` là XP nhiệm vụ đã trả trong ngày đó, **đọc từ sổ cái** (các dòng `WORKOUT_PARTIAL` của các buổi tập của ngày, và dòng `QUEST_COMPLETE` của nhiệm vụ). Khi nhiệm vụ chưa xong: buổi ≥ nửa thời lượng được `xp_reward − given` và `coin_reward`, hoàn thành nhiệm vụ; buổi ngắn hơn được `least(floor(xp_reward × elapsed / duration), xp_reward − given)`, không xu. Khi đã xong: 0, buổi tập vẫn được ghi. Vì vậy một ngày không bao giờ trả quá 50 XP cho nhiệm vụ này, và xu chỉ một lần. `xp_awarded` và `coin_awarded` của buổi tập là số nó đã nhận.

Lỗi (`HM000`), theo thứ tự:

- `nutrition_log_manual`: (id đã có: dưới) → `VALIDATION_FAILED` (`kcal` / `required`, `min`, `max`; `label` / `max`; mọi trường sai một lượt) → `OCCURRED_AT_INVALID` → `DAY_CLOSED`.
- `workout_complete`: (id đã có) → `NOT_FOUND` (không có bài tập đó, kể cả id của thứ khác) → `VALIDATION_FAILED` (`elapsedSec` / `required`, `min`, `max`: ngoài 1 … 2 × thời lượng) → `OCCURRED_AT_INVALID` → `DAY_CLOSED`.
- Cả hai: `ONBOARDING_REQUIRED`. **Id đã có**: của chính người gọi là no-op (một lượt cộng 0; buổi tập trả lại đúng những gì nó đã nhận, không sự kiện nào); của người khác là `IDEMPOTENCY_KEY_REUSED`.

**Khóa**: đúng thứ tự của "Khóa: một thứ tự, một chế độ" — dòng `users`, dòng ngày (`app._open_log`), dòng tiến độ của nhiệm vụ, `progression_state` (trong `app._grant`), ba khóa đầu `FOR NO KEY UPDATE` — và dòng `nutrition_logs` / `workout_sessions` được chèn **sau** các khóa đó. Hai test không cần may mắn của mục đó được lặp lại cho hai hàm này (`server/test/story.sql.test.ts`).

### Bốn route

Mọi từ chối đều được **ném**: lượt ghi bị từ chối không để lại dòng, calo, dòng sổ cái hay dòng `daily_logs` nào, và khóa idempotency được trả lại.

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `POST /nutrition/log` | `user`, có khóa | `200 ActionResult` | `422 VALIDATION_FAILED`, `409 PLAN_NOT_FOUND`, `409 DAY_CLOSED`, `422 OCCURRED_AT_INVALID`, `409 IDEMPOTENCY_KEY_REUSED` |
| `GET /workout/catalog` | `user` | `200 WorkoutCatalog` | `422 VALIDATION_FAILED` (`duration`, `space`, `equipment` / `enum`) |
| `GET /workout/items/{id}` | `user` | `200 WorkoutDetail` | `422 VALIDATION_FAILED` (`id` / `format`), `404 NOT_FOUND` |
| `POST /workout/complete` | `user`, có khóa | `200 WorkoutResult` | `422 VALIDATION_FAILED`, `404 NOT_FOUND`, `409 DAY_CLOSED`, `422 OCCURRED_AT_INVALID`, `409 IDEMPOTENCY_KEY_REUSED` |

- **Thân là một object JSON** và **`occurredAt` là một thời điểm có thật**, như ba route ghi của ngày (dùng chung `objectBody`, `occurredAtOf` của `routes/day.ts`). Thời điểm sau năm 9999 (một độ lệch đẩy `9999-12-31T23:59:59-23:59` sang năm 10000) PostgreSQL không đọc được: `422 VALIDATION_FAILED` (`occurredAt` / `format`) ở cả năm route ghi, không bao giờ `500`.
- **`POST /nutrition/log`**: đúng một trong `kcal` / `mealSlot`. Không có cái nào: `kcal` / `required`; có cả hai: `mealSlot` / `format`. `mealSlot` hợp lệ đi tới `nutrition_log_slot` (mục "Thực đơn ngày" bên dưới; lạ thì `mealSlot` / `enum`). `kcal` là số hữu hạn bất kỳ từ 1 tới 5000 (chuỗi, `null`, `1e400` là `format`). `label` là chuỗi (khác thì `format`), được chuẩn hóa NFC và cắt khoảng trắng hai đầu, tối đa 60 code point (`max`), rỗng thì lưu `NULL`. Thuộc tính lạ bị bỏ qua. `delta.events`: `QUEST_COMPLETED` (`NUTRITION_TARGET`) ở lượt chốt, `STORY_ALL_DONE` ở lượt làm đủ cốt truyện.
- **`GET /workout/catalog`**: `duration` là đúng `5`, `15`, `30` hoặc `45` (phút); `space` là một trong bốn giá trị, so bằng nhau với `space_needed`; `equipment` là danh sách những gì người dùng **có**, cách nhau bằng dấu phẩy, mỗi mã phải là `tham`, `ta-tay` hoặc `day-khang-luc`: bài tập khớp khi nó không cần gì ngoài danh sách đó (`equipment <@ có`). **Vắng tham số là không lọc thiết bị; có mà rỗng (`equipment=`) là không có gì**, chỉ bài không cần thiết bị (app luôn gửi tham số này). `recommended` khi hệ phái của người dùng nằm trong `archetypes`; thứ tự: được đề xuất trước, rồi theo tên (đối chiếu tiếng Việt của cơ sở dữ liệu), rồi theo `code`. `kcalEstimate` = MET × cân nặng của **snapshot mới nhất của chính người gọi** × giờ, làm tròn tới 10; cân nặng được đọc trong cùng câu lệnh và không bao giờ tới Node. Không khớp gì là `items: []`.
- **`GET /workout/items/{id}`**: tóm tắt như trên cộng `sets` và các bước theo `position`, mỗi bước kèm động tác của nó (`demoCode`, ba dòng hướng dẫn, lưu ý).
- **`POST /workout/complete`**: `exerciseItemId` là UUID (`required` / `format`), `elapsedSec` là số nguyên ≥ 1 (`format`, `min`; cận trên là của hàm). `WorkoutResult`: `completed`, `xpAwarded`, `coinAwarded` của buổi tập; `day` là hôm nay (`buildDay`); `delta` là thay đổi của chính request (`QUEST_COMPLETED` `WORKOUT_MAIN`, `STORY_ALL_DONE`, `LEVEL_UP`, `PET_STAGE_UP`). **Một buổi tập là một hành động**, gửi lại bao nhiêu lần cũng vậy: cùng khóa, cùng thân thì cùng câu trả lời đã lưu.
- **`STORY_ALL_DONE`** được báo đúng ở lượt ghi làm `daily_logs.story_completed` chuyển thành `true` (kết quả của `app._story_check`). Lần gửi lại của chính lượt đó nhận câu trả lời đã lưu (một hành động, một sự kiện); khi câu trả lời đã lưu không còn, lượt gửi lại là no-op không báo gì; buổi tập thứ hai, bữa ăn sau đó không báo nữa.

### Read model

- `buildMe`: `resistanceMinutes7d` / `cardioMinutes7d` = tổng `elapsed_sec` / 60 của các buổi tập có ngày logic trong khoảng [hôm nay − 6, hôm nay], theo loại (CARDIO và HIIT gộp), trong cùng câu lệnh của `Me`.
- `buildDaySummaries` / `buildDayDetail` (cùng câu lệnh `SUMMARIES`): `workoutMinutes` = tổng giây các buổi tập của ngày / 60. Hành động `NUTRITION`: `label` là nhãn ghi tay (`null` nếu không có), `value` là kcal, `mealSlot` `null` với ghi tay. `WORKOUT`: `label` là tên bài tập, `value` là số giây đã tập. `at` là `occurred_at`.

### Mồi nhử, ca tấn công, test

- `server/sql/82-decoy-story.sql`: `DECOY_1` có một lần ghi calo và một buổi tập của `DESK_STRETCH` (theo `code`), trên ngày của `81-decoy-day.sql`.
- `server/checks/attacks/story.ts` (bốn ca): `nutrition_log_manual` và `workout_complete` dùng id dòng của mồi nhử làm action id (`IDEMPOTENCY_KEY_REUSED`, không gì đổi); `UPDATE daily_logs SET calories_in` trực tiếp (`permission denied for table daily_logs`); một lần ghi calo và một buổi tập của A ghi dòng của A, không dòng nào của mồi nhử.
- `server/test/story.sql.test.ts`: seeder và số dòng, dải calo so với `calorieWindow` ở mọi mục tiêu 1200–4000, id lặp lại, thứ tự lỗi, ràng buộc, chế độ và thứ tự khóa.
- `server/src/routes/nutrition.test.ts`, `workout.test.ts`: qua HTTP; AR-11 theo bảng nhiều chuỗi buổi tập (kể cả 1 giây, đúng nửa, thiếu một giây, gấp đôi, ba buổi dở cộng lại vượt phần thưởng); `STORY_ALL_DONE` theo hai thứ tự; cuộc đua trên pool đã mở sẵn (hai lần ghi calo, ba buổi tập, một tick, giờ ngủ cùng lúc, 12 vòng: không `5xx`, mỗi nhiệm vụ xong một lần, tổng đúng).

### Phần ba cổng không nhìn thấy

Từng ca dưới đây đã chạy thử (báo cáo Task 21): cổng 1 và cổng 3 im lặng, chỉ test bắt được.

- thân hàm: dải calo lệch một đơn vị; thưởng hoàn thành lần thứ hai; XP buổi dở không bị chặn bởi phần còn lại; bộ lọc thiết bị bị đảo; `STORY_ALL_DONE` báo theo trạng thái thay vì theo lượt chuyển. Chưa chạy thử, chỉ test giữ: `given` đọc từ cột thay vì sổ cái; thứ tự và chế độ khóa;
- `kcalEstimate`: bỏ điều kiện chủ sở hữu khi chọn snapshot không làm gì đỏ, vì RLS của `biometric_snapshots` là hàng rào thứ hai (câu lệnh chạy bằng `app_auth`); tắt cả RLS thì cổng 1 đỏ. Nếu sau này cân nặng được đọc trong một hàm `SECURITY DEFINER`, chỉ còn điều kiện tường minh và test giữ;
- ràng buộc: `completed = (elapsed × 2 ≥ duration)`, `elapsed ≤ 2 × duration`, khoảng của `kcal` và `label`, `meal_slot` đi cùng `meal_id`, hai khóa ngoại kép — có test, cổng không đọc;
- dữ liệu: một dòng nội dung bài tập bị sửa tay (seeder sửa lại ở lần migrate sau);
- thứ tự theo tên của danh mục đi theo đối chiếu ICU `vi` của cơ sở dữ liệu; test so với `Intl.Collator('vi')` của Node trên nội dung hiện có, không chứng minh hai bên giống nhau với mọi tên;
- chỉ số STR / SPD đếm **mọi** buổi tập, kể cả buổi sau khi nhiệm vụ đã xong: gửi nhiều buổi tập đẩy được chỉ số (tối đa ở 150 phút) mà không được thêm XP hay xu. Đó là chỉ số hiển thị, không phải tiền.

Sửa `31-story.sql` thì chạy `npm run server:test`, không chỉ `npm run db:verify`.

## Đóng ngày, bộ lập lịch và hộp thư (`32-dayclose.sql`, `33-inbox.sql`, `jobs/*.ts`, `routes/inbox.ts`)

Code đầu tiên đổi dữ liệu của người dùng mà không có request nào của người đó: đóng các ngày logic ở mọi múi giờ, dời chuỗi ngày và tâm trạng của thú, trả thưởng mốc chuỗi đúng một lần trong đời, và đưa kết quả vào hộp thư. Hợp đồng nằm ở `docs/api/openapi.yaml` (`Inbox`, `InboxItem`, `InboxReadRequest`, `InboxReadResult`, `DayState.unreadCount`, `DayState.celebrations`, `Health`); mục này ghi cách server giữ nó.

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `freeze_tickets` | `own_read` | Một dòng mỗi vé. `grant_week` là thứ Hai của tuần được cấp (**duy nhất theo `(user_id, grant_week)`**), `used_at` và `used_for_date` cùng có hoặc cùng không (`CHECK`), **duy nhất theo `(user_id, used_for_date)`** (một vé mỗi ngày; vé chưa dùng không có ngày nên không vướng). Hàm cấp và dùng vé đến ở nhiệm vụ nhật ký và vé; bảng có từ bây giờ vì job đóng ngày đọc nó. |
| `ticket_grant_weeks` | `own_read` | Khóa chính `(user_id, week_start)`, `week_start` là thứ Hai, `granted`: tuần đó đã được quyết (cấp, hay bỏ vì kho đã đầy). |
| `job_runs` | `internal` | Khóa chính `run_id`: một uuid bộ chạy rút cho **mỗi lượt chạy**, nên hai lượt chạy cho cùng một thời điểm (lệnh chạy tay cạnh bộ lập lịch, hai tiến trình) là hai dòng. `job`, `run_for` (thời điểm lượt chạy chạy cho), `ran_at`, `ok`, `detail` (chỉ có số đếm). Không có dữ liệu người dùng. |
| `notifications` | `own_rw`: đọc dòng của mình, sửa **đúng cột `read_at`** | `kind` là một trong năm loại của union `InboxItem` (`NUDGE`, `STREAK_MILESTONE`, `PET_TIRED`, `GUILD_WEEKLY_RESULT`, `QUEST_REMINDER`, giữ bằng `CHECK`), `payload` là một object JSON (`CHECK`), `dedupe_key`, `read_at`. **Duy nhất theo `(user_id, kind, dedupe_key)`** (khóa `NULL` không bao giờ trùng) và **duy nhất theo `(user_id, created_at)`** (chỉ mục `notifications_user_created_key`): hộp thư phân trang chỉ bằng `created_at`. |

### Job đóng ngày

Mỗi giờ từ phút 15, `server/src/jobs/dayClose.ts` (tên `day-close`):

1. Lấy từng lô 200 người bằng `job_day_close_candidates(p_now, p_limit, p_after)` (chạy bằng `app_job`): người dùng **đã onboarding, chưa xóa**, có ngày logic hôm qua (theo `app.logical_date(p_now, users.timezone)`) sau ngày đã đóng cuối cùng (`last_closed_date`, hay ngày trước `onboard_date` khi chưa đóng ngày nào), theo thứ tự id, sau `p_after`. Mỗi người kèm `last_closed`, sáu trường chuỗi ngày (đúng hình dạng `StreakState` của `domain/streak.ts`) và `days`: mỗi ngày từ hôm sau ngày đã đóng tới hôm qua một phần tử `{date, storyCompleted, ticketApplied}` (`app._close_days`: không có dòng `daily_logs` là chưa xong; vé là một dòng `freeze_tickets` có `used_for_date` bằng ngày đó).
2. Tính bằng `closeDays` của `domain/` (AR-03): trạng thái mới và sự kiện. `STREAK_MILESTONE` thành `{type, days, coins, badgeCode}` theo `STREAK_MILESTONES`; `PET_TIRED` giữ ngày của nó; **chuỗi bị đứt không thành gì cả**: không thông báo, không ai bị trách (S67 nằm ở màn hành trình).
3. Gọi `job_apply_day_close(p_user_id, p_expected_last_closed, p_through, p_days, p_state, p_events)`, **mỗi người một transaction**. `p_through` là ngày cuối cùng SQL đã đưa: không ngày nào được tính ở Node.
4. Một người hỏng (lỗi bất kỳ) được đếm và ghi một dòng log `{evt:'job_user_failed', job, userId, error, code, …}` không có thông báo lỗi, và không dừng những người khác. Gặp lô rỗng thì dừng; kết quả `{users, applied, retried, skipped, failed, dates}` được ghi vào `job_runs` (một dòng của riêng lượt chạy đó) và một dòng log.

**Ngày nào cần đóng chỉ đến từ SQL.** Node và PostgreSQL mang hai bản sao cơ sở dữ liệu múi giờ, và hôm nay chúng lệch nhau ở bốn múi giờ (xem "Ngày và nhiệm vụ"); job dùng đúng hàm đã gắn nhãn `daily_logs` và đã quyết lượt ghi rơi vào ngày nào. Test ranh giới chạy một phút trước và một phút sau 03:00 của từng múi giờ (Hồ Chí Minh; New York 08/03 và 01/11/2026; Berlin 29/03 và 25/10/2026; Lord Howe 05/04 và 04/10/2026; Apia), và ở `America/Vancouver` sau 01/11/2026, nơi ngày mong đợi lấy từ SQL vì Node đọc khác.

### `job_apply_day_close`: một người, một transaction

Theo đúng thứ tự:

1. **Khóa dòng `users` của người đó `FOR NO KEY UPDATE`**, trước mọi thứ: mutex của ngày người đó (xem "Khóa: một thứ tự, một chế độ"). Lượt ghi của người đó đang chạy thì job chờ; job đang giữ thì lượt ghi chờ, rồi đọc `last_closed_date` mới và nhận `DAY_CLOSED`. Người không còn là người dùng đã onboarding và chưa xóa: không làm gì.
2. **So rồi mới ghi** (compare-and-set): `last_closed_date` vẫn bằng `p_expected_last_closed`, và `app._close_days` đọc lại bây giờ vẫn bằng đúng `p_days`. Không bằng thì trả `{applied: false, grants: []}` và không làm gì. Vế đầu là tính lặp lại được: hai lượt chạy cùng đọc một người thì lượt sau không áp dụng gì. Vế sau giữ đúng kết quả: một lượt ghi trễ (có `occurredAt`) rơi vào hôm qua giữa lúc job đọc và lúc job ghi, hay một vé vừa được dùng, làm dữ liệu khác với thứ job đã tính; job đọc lại người đó **một lần** ngay trong lượt chạy (`retried`) rồi áp dụng với sự thật mới; nếu dữ liệu lại đổi nữa thì người đó được để cho lượt sau (`skipped`).
3. Đóng dấu `closed_at` cho các dòng `daily_logs` có ngày ≤ `p_through`.
4. Ghi sáu trường từ `p_state` và `last_closed_date = p_through` (`UPDATE … WHERE last_closed_date IS NOT DISTINCT FROM p_expected_last_closed`). **`streak_best` không bao giờ bị ghi thấp hơn giá trị đang có** (`greatest`).
5. Mỗi `STREAK_MILESTONE`: `days` phải là 7, 30 hoặc 100, `coins` dương, `badgeCode` là một vật phẩm `BADGE`; xu qua `app._grant(…, 'STREAK_MILESTONE', '<days>')` (AR-34: **một lần trong đời**, khóa duy nhất của sổ cái giữ), huy hiệu vào `inventory` (`ON CONFLICT DO NOTHING`), thông báo `STREAK_MILESTONE` với `{days, coins, badgeCode}`, khóa chống trùng là số ngày. Mỗi `PET_TIRED`: thông báo `PET_TIRED` với `{}`, khóa chống trùng là ngày. Sự kiện khác: lỗi, không gì được ghi.
6. Trả `{applied: true, grants}`: các kết quả `app._grant` đã ghi dòng sổ cái, kèm `reason` và `ref`; job gọi `log.ledger` cho từng dòng (`logGrants`).

Đứt chuỗi rồi đạt lại 7 ngày: sự kiện mốc lại tới, nhưng không có xu, huy hiệu hay thông báo mới (khóa sổ cái, khóa của `inventory`, khóa chống trùng). Khóa lấy theo đúng thứ tự `users` → `daily_logs` → `progression_state` (rồi `app._grant` lấy `FOR UPDATE` trên `progression_state`, bảng không ai tham chiếu); hai test không cần may mắn (`server/test/dayclose.sql.test.ts`) giữ chế độ và thứ tự đó như với các hàm ghi của ngày.

Một ngày đã đóng không mở lại: đổi múi giờ giữa hai lượt chạy không đóng lại ngày nào và không bỏ ngày nào (ngày cần đóng luôn bắt đầu từ hôm sau `last_closed_date`); dời sang múi giờ chậm hơn có thể làm "hôm nay" là ngày đã đóng, và mọi lượt ghi nhận `DAY_CLOSED` cho tới ngày mới của múi giờ mới.

### `app._notify` và hộp thư

`app._notify(p_user uuid, p_kind text, p_payload jsonb, p_dedupe_key text) → boolean` là cách duy nhất ghi một thông báo: nội bộ, không vai trò nào gọi được, `invoker`. `true` khi lượt gọi tạo ra dòng; trùng `(user, kind, dedupe_key)` thì không làm gì. Loại ngoài năm loại của hợp đồng bị `CHECK` từ chối (`23514`): loại mới là một thay đổi hợp đồng trước đã. `created_at` tăng nghiêm ngặt theo từng người (`app.now()`, hay thông báo mới nhất cộng một micro giây) và là **duy nhất theo từng người** (chỉ mục duy nhất), nên trang của hộp thư không bao giờ cắt ngang hai thông báo cùng thời điểm. **Mọi nơi gọi `app._notify` phải giữ khóa dòng `users` của người nhận (`FOR NO KEY UPDATE`, khóa đầu tiên của thứ tự khóa) trước khi gọi**: hai nơi ghi vào một hộp thư khi đó chạy lần lượt. Nơi nào quên khóa thì hai lượt gọi cùng lúc có thể chọn cùng một thời điểm, và lượt sau hỏng ngay ở chỉ mục duy nhất (`23505`), trong test của chính nó, thay vì âm thầm làm mất một mục ở ranh giới trang. Job đóng ngày giữ khóa đó từ bước đầu của `job_apply_day_close`. Các nhiệm vụ sau tạo `NUDGE`, `GUILD_WEEKLY_RESULT`, `QUEST_REMINDER` qua chính hàm này.

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `GET /inbox?limit=&before=` | `user` | `200 Inbox` | `422 VALIDATION_FAILED` (`limit` / `format`, `min`, `max`; `before` / `format`) |
| `POST /inbox/read` | `user`, có khóa | `200 InboxReadResult` | `422 VALIDATION_FAILED` (`body` / `required`, `format`; `ids` / `format`), `409 IDEMPOTENCY_KEY_REUSED` |

- **`GET /inbox`**: mới nhất trước theo `created_at` (duy nhất theo từng người), `limit` là số nguyên 1–50, mặc định 20. `before` là một thời điểm có thật, theo đúng luật `occurredAt` của `routes/day.ts` (RFC 3339 có múi giờ, ngày có trên lịch…; năm sau 9999 là `format`, trước 1970 thì không có gì), và được đưa vào SQL bằng cùng cách viết `instantText` (UTC, giữ micro giây): độ lệch `+16:00` hay `+23:59` là một trang đúng, không bao giờ `500`. `nextBefore` là `created_at` của mục cuối trang, viết theo UTC **tới micro giây**, để gửi lại nguyên văn; `null` ở trang cuối. Trang và `unreadCount` đọc trong một câu lệnh.
- **`POST /inbox/read`** là một `UPDATE` thường bằng `app_auth`, dưới RLS, trên cột duy nhất người dùng được ghi (`read_at = app.now()`, chỉ cho dòng chưa đọc: lần đọc đầu được giữ). Có `ids` (mảng UUID) thì chỉ các mục đó; không có thì mọi mục chưa đọc. Id của người khác hay id không tồn tại **không được cập nhật và không được nói ra**: câu trả lời chỉ là `unreadCount` của chính người gọi. Thân phải là object JSON, như các route ghi của ngày.
- **`GET /day`**: `unreadCount` đếm thông báo chưa đọc của người gọi; `celebrations` là các mục `STREAK_MILESTONE` chưa đọc, cũ nhất trước, cho tới khi chúng được đánh dấu đã đọc.

### Bộ lập lịch (`jobs/scheduler.ts`)

- Mỗi file `server/src/jobs/<tên>.ts` (trừ `scheduler.ts`, `run.ts` và test) export mặc định một `Job`: `{ name, due(now, lastRunAt, lastOk), run(pool, now, log) }` (`lastOk`: lần chạy trước có thành công không; `weekly-rollover` dùng nó để chạy lại lần lỗi). Thêm job là thêm file, không sửa danh sách nào. `run` trả về số đếm (được ghi vào `job_runs` và log, nên không bao giờ có dữ liệu cá nhân) và gọi `log.ledger` cho mọi dòng sổ cái nó ghi.
- `serve` của `main.ts` khởi động bộ lập lịch: **một** `setInterval` 60 giây. Mỗi nhịp đọc `SELECT app.now()` (đồng hồ test của kịch bản áp dụng cho job như cho SQL); nếu lần chạy `day-close` thành công cuối cùng đã cũ hơn 90 phút (tính từ nhịp đầu khi chưa có lần nào) thì ghi một dòng `{level:'alert', evt:'job_late', job:'day-close'}`; rồi khởi chạy mọi job tới hạn mà **không đang chạy**: không bao giờ có hai lượt của cùng một job cùng lúc. Lỗi của một lượt được ghi log (không có thông báo lỗi) và ghi vào `job_runs` với `ok = false`; bộ lập lịch chạy tiếp.
- `day-close` tới hạn mỗi giờ một lần từ phút 15: khi lần chạy cuối trong tiến trình này trước mốc hh:15 gần nhất. Tiến trình vừa khởi động thì chạy ngay ở nhịp đầu (bù lần đã lỡ; job lặp lại được).
- `stop()` (gọi từ cơ chế dừng sẵn có của `main.ts`) gỡ bộ hẹn giờ, rồi chờ các lượt đang chạy kết thúc trước khi pool đóng. Bộ hẹn giờ không `unref`: bộ lập lịch quên dừng sẽ giữ tiến trình sống, và lộ ra ngay.
- `runJob(name, pool, now, log?)` chạy một job một lần (test, kịch bản, lệnh dưới). `npm --prefix server run jobs -- <tên> [--now <ISO>]` chạy một job vào cơ sở dữ liệu phát triển đang chạy (`npm run server:dev`), in kết quả là một dòng JSON ra stdout, log ra stderr; không có `--now` thì dùng `SELECT app.now()`.

### Mồi nhử, ca tấn công, test

- `server/sql/83-decoy-dayclose.sql`: `DECOY_1` có một vé đã dùng cho ngày `2026-01-01`, tuần `2025-12-29` của vé, và một thông báo `PET_TIRED` chưa đọc.
- `server/checks/attacks/dayclose.ts` (năm ca): `app_auth` gọi từng hàm `job_*` (`permission denied for function`); `app_job` đọc thẳng `daily_logs`, `notifications`, `freeze_tickets` (`permission denied for table`); `app_auth` chèn dòng `notifications`, `freeze_tickets` (`permission denied for table`); A đánh dấu đã đọc thông báo của mồi nhử, theo id và không `WHERE` (0 dòng, mồi nhử nguyên vẹn); một lượt `day-close` thật và danh sách ứng viên với đồng hồ đẩy xa về sau không bao giờ có mồi nhử, và lời gọi apply nêu tên mồi nhử không làm gì.
- `server/test/dayclose.sql.test.ts`: ứng viên (mồi nhử, chưa onboarding, đã xóa không bao giờ có mặt; `p_limit`, `p_after`), compare-and-set, dữ liệu đã đổi, `streak_best`, mốc một lần trong đời, `PET_TIRED`, `app._notify`, quyền thực thi, chế độ và thứ tự khóa.
- `server/src/jobs/dayClose.test.ts`: tiêu chí ra mắt (hai nhiệm vụ cốt truyện ba ngày liền, lúc 23:50 và 00:30, đóng ngay sau 03:00: chuỗi 1, 2, 3); tính lặp lại được (cùng thời điểm hai lần; hai lượt cùng lúc); ranh giới từng múi giờ; nghỉ năm ngày; đứt chuỗi và dữ liệu cứu; vé (`FROZEN`, và vé cộng nhiệm vụ xong là `COMPLETED`); mốc 7; đổi múi giờ giữa hai lượt; `DAY_CLOSED` sau khi đóng; một người hỏng không dừng người khác; log; mồi nhử.
- `server/src/jobs/dayClose.race.test.ts`: `day-close` đóng hôm qua của người dùng U đúng lúc U tick, ghi calo, ghi buổi tập, đánh dấu giờ ngủ (cả bốn nêu thời điểm 20:00 hôm qua) và đổi múi giờ, mỗi loại 25 vòng trên pool đã mở sẵn, đồng hồ thật: không `5xx`; lượt ghi hoặc được nhận (trước lúc đóng, và ngày của nó rồi được đóng dấu) hoặc nhận `DAY_CLOSED`; không dòng `daily_logs` nào của ngày đã đóng thiếu `closed_at`; lượt chạy thứ hai không mở lại gì; sổ cái lành.
- `server/src/jobs/scheduler.test.ts`, `server/src/routes/inbox.test.ts`.

### Phần ba cổng không nhìn thấy

Cổng 1 và cổng 3 đọc catalog; cổng 2 hỏi quyền và chạy năm ca tấn công ở trên. Những thay đổi sau không làm cổng nào đỏ (trừ chỗ ghi rõ); chỉ test bắt được (đã chạy thử, báo cáo Task 22):

- thân hàm: bỏ compare-and-set; đổi khóa sổ cái của mốc (trả hai lần); bỏ `greatest` của `streak_best`; lấy khóa `users` sau `progression_state`; bỏ điều kiện `onboarded_at` (cổng 2 thấy: ca tấn công về mồi nhử đỏ);
- code Node: job tự tính ngày cần đóng bằng `logicalDateOf`; bộ lập lịch chạy hai lượt một job cùng lúc; bỏ dòng cảnh báo trễ;
- ràng buộc: `CHECK` loại của `notifications`, khóa chống trùng, chỉ mục duy nhất `(user_id, created_at)` (test SQL giữ), các khóa duy nhất của `freeze_tickets`; việc mọi nơi gọi `app._notify` giữ khóa `users` của người nhận thì không cổng nào thấy: chỉ mục duy nhất làm nơi quên khóa hỏng ngay trong test của nó;
- `job_runs`: một lượt chạy một dòng (`run_id` rút cho mỗi lượt), có test hai lượt cho cùng một thời điểm;
- dữ liệu: cổng 2 chạy trên bản sao mới, nơi chưa job nào chạy; ca tấn công về mồi nhử chạy job thật một lần, nhưng không thấy một job **khác** xóa hay sửa nhầm dòng mồi nhử;
- `Pacific/Chatham`, 04/04 hằng năm: nhãn ngày đi lùi 15 phút sau lần đóng lúc 13:15 UTC (xem `app.logical_day_end`), nên trong 15 phút đó lượt ghi nào cũng nhận `409 DAY_CLOSED` (ngày mà nhãn quay về đã đóng). Đó là luật đóng ngày của đề bài; một lần mỗi năm, không cổng nào báo;
- thời gian: job chạy theo giờ của bộ lập lịch, mỗi giờ phút 15; múi giờ lệch nửa giờ (Ấn Độ: 03:00 là hh:30 UTC) được đóng trễ tới 45 phút, theo thiết kế: ngày vẫn mở cho tới khi job xử lý nó (AR-09).

Sửa `32-dayclose.sql` hay `33-inbox.sql` thì chạy `npm run server:test`, không chỉ `npm run db:verify`.

## Kịch bản phát triển và dịch chuyển thời gian (`scripts/scenario.ts`, `scripts/scenarios/*.ts`)

Một dòng lệnh đưa cơ sở dữ liệu phát triển vào một tình huống có tên (chưa onboarding, ngày đầu, chuỗi 2, chuỗi 6, bỏ ba ngày, chuỗi vừa đứt) để mở app lên là thấy ngay. Cổng kiểm đầu-cuối (Task 29) dùng đúng các kịch bản này. Mọi trạng thái được dựng **chỉ bằng API của server đang chạy và các job thật**, trong lúc đồng hồ test được bước qua từng ngày; không có hàng nghiệp vụ nào được chèn thẳng.

### Dùng

Bật `npm run server:dev` (cửa sổ khác), rồi từ thư mục gốc:

```sh
npm --prefix server run scenario -- list             # tên và mô tả từng kịch bản
npm --prefix server run scenario -- streak2          # dựng một kịch bản
npm --prefix server run scenario -- clock 2027-03-04T02:00:00Z   # đặt đồng hồ test (có múi giờ)
npm --prefix server run scenario -- clock off        # trả về giờ thật
npm --prefix server run scenario -- streak2 --include-real-users   # khi có tài khoản dev không phải demo (đọc "Nguy hiểm" dưới đây)
npm --prefix server run jobs -- day-close --now 2027-03-04T21:00:00Z   # chạy một job một lần
```

Kịch bản in tài khoản (`demo-<tên>@hoimau.test`, mật khẩu `matkhau123`, tên hiển thị "An"), một ghi chú, và đồng hồ nó để lại. Chạy lại cùng kịch bản xóa tài khoản đó rồi dựng lại từ đầu, kết quả như nhau.

**Ngày trong bảng dưới là ngày của test** (cố định từ 01/03/2027, `START`). Lệnh `scenario` ở dòng lệnh thì neo vào ngày thật: `makeCtx({ …, today })` với `today` là ngày logic hôm nay ở Hồ Chí Minh, và `begin(ctx, tên, onboard, days)` bắt đầu `days` ngày trước đó, nên kịch bản kết thúc vào hôm nay, cùng giờ trong ngày như bảng. Nhờ vậy điện thoại chạy ngày thật thấy cùng một ngày với server (xem "Chạy demo trên Android" trong [development.md](development.md)). Test không truyền `today`, mọi ngày test khẳng định vẫn cố định; một test riêng chạy cả chín kịch bản với `today` và kiểm chúng kết thúc đúng ngày đó (nên `days` của mỗi kịch bản phải khớp số ngày nó chơi). `guild4` bắt đầu một ngày trước hôm nay: chạy vào thứ Hai thì ngày đầu rơi vào tuần trước.

| Tên | Tình huống | Đồng hồ khi xong (giờ địa phương Hồ Chí Minh) |
|---|---|---|
| `fresh` | đã đăng ký, chưa onboarding | 01/03/2027 09:00 |
| `day1` | đã onboarding, chưa ghi gì | 01/03/2027 09:00 |
| `streak2` | hai ngày hoàn thành đã đóng; hôm nay mở, chưa ghi gì: còn một ngày tốt nữa là có ngọn lửa | 03/03/2027 20:00 |
| `streak6` | sáu ngày hoàn thành đã đóng; hôm nay mở, lần đóng sau chạm mốc 7 ngày | 07/03/2027 20:00 |
| `missed3` | ba ngày bỏ lỡ đã đóng; thú mệt (`GET /pet` mood `TIRED`) | 04/03/2027 09:00 |
| `broken` | chuỗi 5, hôm qua bỏ lỡ và đã đóng: trong cửa sổ cứu chuỗi, `breakNotice.previous` là 5 | 07/03/2027 09:00 |
| `rich` | cấp 8, 500 xu, 3 điểm đặc quyền (đã mở `TICKET_CAP_PLUS` và chủ đề `THEME_FOREST`). XP và xu được **cấp thẳng** qua `app._grant` bằng superuser (`ctx.grant`, chỉ cho tài khoản demo), không kiếm bằng cách chơi | 01/03/2027 09:00 |
| `guild4` | tổ đội "Tổ Bốn Mùa" bốn người: An (tổ trưởng, tài khoản in ra), Bình, Chi, Dũng (`demo-guild4b`, `demo-guild4c`, `demo-guild4d@hoimau.test`, cùng mật khẩu). Thứ Hai An và Bình hoàn thành nhiệm vụ chính, Chi một nửa (chỉ bữa ăn); thứ Ba An hoàn thành lần nữa; Dũng không ghi gì và đã tắt nhắc nhở. Chạy lại: kịch bản xóa tổ đội cũ bằng `ctx.removeGuild` (cả khi nó còn đủ, mất tổ trưởng hay đã rỗng) trước khi xóa các tài khoản, để tên tổ đội được giải phóng; tổ đội trùng tên có người không phải tài khoản demo thì kịch bản **dừng với lỗi**, không xóa gì | 02/03/2027 12:00 |
| `ticket` | như `broken` (chuỗi 5 gãy hôm qua, 09:00) cộng **một vé đóng băng chưa dùng**, có được nhờ một dòng nhật ký viết sáng nay (vé của tuần, `GRANTED`; kèm +15 XP). Dùng để thử cứu chuỗi trước 15:00 | 07/03/2027 09:00 |

- **Cách dựng.** Đăng ký, onboarding (Hồ Chí Minh, số đo hợp lý), rồi mỗi ngày: đồng hồ tới 12:00 địa phương, ghi một bữa mà tổng nằm giữa `calorieWindow.min` và `.max` của `GET /day` (không tự tính dải), hoàn thành bài tập ngắn nhất của thư viện thật; đồng hồ tới 04:00 địa phương hôm sau (sau 03:00) và chạy `day-close`. Một ngày bỏ lỡ chỉ bỏ hai bước đầu.
- **Ngày và giờ chỉ đến từ server.** Giờ địa phương được đặt từ `closesAt` của `GET /day` (03:00 hôm sau), không từ phép tính múi giờ của Node: Node và PostgreSQL lệch nhau ở bốn múi giờ (xem "Ngày và nhiệm vụ"). Cách trừ giờ từ `closesAt` chỉ đúng với múi giờ có độ lệch cố định; tài khoản demo luôn ở `Asia/Ho_Chi_Minh` (không đổi giờ mùa hè). Múi giờ khác thì phải hỏi server từng thời điểm.
- **Đồng hồ là của chung.** Một cơ sở dữ liệu có một đồng hồ test. Kịch bản nào cũng bắt đầu từ 09:00 của ngày bắt đầu (01/03/2027 trong test, `days` ngày trước hôm nay ở dòng lệnh; lùi nếu kịch bản trước kết thúc muộn hơn) và để đồng hồ ở thời điểm cuối. Khi đồng hồ đi tới, `day-close` (của kịch bản, và của bộ lập lịch trong `server:dev`) đóng ngày cho **mọi** người dùng: tài khoản demo của kịch bản chạy trước sẽ có thêm ngày bỏ lỡ. Muốn thấy một tình huống nguyên vẹn thì chạy kịch bản đó **sau cùng**.
- **Nguy hiểm: đồng hồ đi tới đóng ngày cho MỌI người dùng đã onboarding của cơ sở dữ liệu, không chỉ tài khoản demo.** Kịch bản hay `scenario -- clock <ISO>` nhảy đồng hồ từ hiện tại tới hàng tháng sau, và `day-close` thật đóng từng ngày đã qua của tất cả: tài khoản dev của chính bạn (không phải `demo-*@hoimau.test`) nhận hàng tháng ngày bỏ lỡ, chuỗi đứt, thú mệt, và xóa đồng hồ (hay khởi động lại `server:dev`) **không mở lại** những ngày đó. Vì vậy trước lần dời đồng hồ đầu tiên, lệnh đếm người dùng đã onboarding không phải `demo-*@hoimau.test` (mồi nhử `@decoy.invalid` không tính) và **từ chối chạy** nếu có, nêu số lượng; chỉ khi thêm `--include-real-users` nó in cảnh báo rồi chạy tiếp. `scenario -- clock off` không bị kiểm. Dòng cuối của lệnh nhắc lại điều này mỗi khi đồng hồ đang bị đóng băng.
- **Server nhận lệnh không được kiểm chứng.** Rào cản cơ sở dữ liệu chỉ nói về kết nối của chính lệnh (cổng 54330, `hoimau`); API ở `PORT` (mặc định 8787) không được chứng minh là phục vụ cùng cơ sở dữ liệu đó. Một server khác trên cổng 8787 chỉ gây lỗi khó hiểu giữa chừng, nên chỉ chạy lệnh khi `npm run server:dev` là thứ đang nghe.
- **`jobs -- <tên> --now <ISO>` chỉ đưa thời điểm cho job**, không đổi `app.now()` của SQL (dấu giờ của thông báo, của phiên). Muốn dời cả hai thì đặt đồng hồ bằng `scenario -- clock`, rồi chạy `jobs -- <tên>` không có `--now`.

### Cảnh báo: đồng hồ là của phát triển và test

- `meta.test_clock` làm `app.now()` đứng yên ở một thời điểm cho **mọi** kết nối. Nó tồn tại để dev và test dời thời gian, không bao giờ để ở nơi khác: **`90-verify.sql` (cổng 1, `npm run db:verify`) báo lỗi khi bảng có dòng**.
- Sau khi dùng xong: `scenario -- clock off`. `npm run server:dev` cũng xóa dòng đó mỗi lần khởi động và in `Removed the test clock (…)`: nếu không, `migrate` chạy `90-verify.sql` và từ chối khởi động.
- Lệnh từ chối chạy nếu kết nối không phải cơ sở dữ liệu `hoimau` ở cổng **54330**. Nó hỏi chính kết nối (`current_database()` và `current_setting('port')`), không tin chuỗi kết nối. Nó không bao giờ nối vào cổng 5432.

### Hợp đồng kịch bản

Mỗi file `scripts/scenarios/<tên>.ts` (trừ `*.test.ts`) export mặc định một `Scenario` và được `scenario.ts` tìm thấy khi chạy; thêm kịch bản là thêm một file, không sửa danh sách nào. `name` chỉ gồm a-z, 0-9 (không là `list` hay `clock`) và là phần giữa của email.

```ts
type Scenario = {
  name: string;
  describe: string;
  run(ctx: ScenarioCtx): Promise<{ email: string; password: string; note: string }>;
};
type ScenarioCtx = {
  call(method: string, path: string, opts?: { token?: string; body?: unknown; key?: string }): Promise<any>;
  admin: pg.Pool;
  setClock(iso: string | null): Promise<void>;
  runJob(name: string): Promise<unknown>;
  reset(email: string): Promise<void>;
};
```

- `call` đi tới server qua HTTP (đường dẫn so với `/api/v1`), trả về thân JSON, và **ném** khi trạng thái ngoài 2xx, xét trạng thái trước khi đọc thân (kèm mã lỗi nếu thân là JSON, ngược lại 200 ký tự đầu của thân). Lượt ghi nào hợp đồng đòi `Idempotency-Key` thì kịch bản truyền `key`.
- `admin` là một Proxy của pool superuser, chỉ có `query(text, values?)`: **đúng một câu lệnh bắt đầu bằng `SELECT`, văn bản không có dấu `;`**, chạy trong `BEGIN READ ONLY` … `ROLLBACK` trên một kết nối riêng. Nên hàm có ghi, `SELECT … INTO`, `INSERT`/`DELETE` đều lỗi (`read-only transaction`), và `set_config` bị hoàn lại cùng lượt `ROLLBACK`. Không chặn được khóa tư vấn (advisory lock) mức phiên, vì nó sống qua `ROLLBACK`. Mọi thành viên khác của pool (`connect`, `end`, …) ném lỗi. Hàng nghiệp vụ chỉ vào qua API.
- `setClock` ghi `meta.test_clock`; `runJob` chạy job thật một lần cho `SELECT app.now()` và trả về số đếm của nó; `reset` xóa hẳn người dùng demo đó (khóa ngoại `ON DELETE CASCADE` kéo theo mọi hàng của họ) và **từ chối** mọi email ngoài `demo-<tên>@hoimau.test`, nên không chạm tới mồi nhử (`@decoy.invalid`). `removeGuild(name)` xóa tổ đội mang tên đó (không phân biệt hoa thường, so trên dạng NFC) chỉ khi **mọi** thành viên của nó là tài khoản demo (không có thành viên nào cũng tính), trong một câu lệnh; có ai khác thì ném lỗi và để nguyên tổ đội.
- `scripts/scenarioKit.ts` (không nằm trong `scenarios/`) có các bước dùng chung: `begin` (reset, đồng hồ về `START`, đăng ký, onboarding), `playDays`, `completeStory`, `closeDay`, `goTo`. Kịch bản mới của nhiệm vụ sau thường chỉ gọi chúng rồi thêm bước của tính năng mình.
- **Cổng đầu-cuối** gọi `makeCtx({ baseUrl, admin, app })` của `scenario.ts` với server thử và cơ sở dữ liệu của nó rồi `loadScenarios()`, chạy `run`, và đọc kết quả bằng API (`server/scripts/scenario.test.ts` làm đúng vậy).

### Test và phần cổng không nhìn thấy

`server/scripts/scenario.test.ts` chạy từng kịch bản trên một app thử (đồng hồ test, job thật) và đọc kết quả lại qua API: `fresh` → `onboarded: false`; `day1` → chuỗi 0, cấp 1; `streak2` → chuỗi 2; `streak6` → chuỗi 6, rồi hoàn thành hôm nay và `day-close` sau 03:00 → chuỗi 7 và một mốc trong `celebrations`; `missed3` → thú `TIRED`; `broken` → `breakNotice.previous` 5. Thêm: chạy hai lần cho cùng kết quả, đồng hồ để đúng chỗ, mồi nhử không đổi, `reset` từ chối email ngoài mẫu (cả chữ hoa, `%`, `_`, xuống dòng cuối), `admin` không ghi được (hai câu lệnh, hàm có ghi, `SELECT … INTO`, `set_config`), `call` ném lỗi theo trạng thái khi thân không phải JSON, `closeDay` / `goTo` ném khi một người bị `skipped`, ngày chưa đóng hay đồng hồ không dời, lệnh từ chối dời đồng hồ khi có người dùng onboarding không phải demo (và chạy với `--include-real-users`), và rào cản cơ sở dữ liệu từ chối cơ sở dữ liệu test. `guild4` chạy lại được sau khi tổ trưởng bị xóa hẳn (tổ đội mất tổ trưởng) và sau khi cả bốn bị xóa (tổ đội rỗng); tổ đội cùng tên có một người không phải demo → kịch bản ném `removeGuild refuses …` và người đó vẫn là thành viên.

Không cổng nào đọc các file này (cổng 1 đọc catalog, cổng 2 và 3 gọi hàm): `scripts/` chỉ do `scenario.test.ts` giữ. `scripts/dev.ts` xóa đồng hồ trước `migrate` được kiểm bằng tay (đặt đồng hồ, khởi động lại `server:dev`, thấy dòng thông báo, `npm run db:verify` xanh), không có test tự động.

## Thực đơn ngày (`40-nutrition.sql`, `routes/nutritionPlan.ts`, `readModels/mealPlan.ts`, `seed/meals.ts`)

Mỗi ngày logic người dùng có bốn bữa (sáng, trưa, tối, phụ) khớp đơn kê, đổi được từng bữa trong giới hạn và ghi một bữa trong thực đơn bằng một request. Hợp đồng: `MealPlanState`, `SwapCandidates`, `SwapRequest`, `NutritionLogRequest` trong `docs/api/openapi.yaml`; luật xếp hạng ở `domain/mealPlan.ts` (F-04, AR-15).

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `meal_plans` | `content` | Thư viện món. Khóa chính `id`, duy nhất `code`. `kcal` 1–5000 (như `nutrition_logs`, nên một bữa luôn ghi được), `protein_g`, `carbs_g`, `fat_g ≥ 0` (`numeric`), `meal_slot` (4 bữa), `tags`, `portion_text`, `description`, `image_key` (`NULL` khi không có ảnh). |
| `daily_meal_plans` | `own_read` | Khóa chính `(user_id, logical_date, meal_slot)`. `meal_id` (khóa ngoại; `NULL` khi mọi món của bữa bị loại trừ lúc lập thực đơn), `swaps_used ≥ 0`, `shown_meal_ids` (các món bữa này đã hiện trong ngày, không bao giờ được đề xuất lại), `macro_warning`, `logged_action_id` (khóa ngoại tới `nutrition_logs`, có khi bữa đã được ghi). |

`40-nutrition.sql` cũng thêm khóa ngoại `nutrition_logs.meal_id → meal_plans (id)` mà `31-story.sql` để lại.

### Seeder

`server/src/seed/meals.ts`, từ `server/content/meals.ts`: upsert theo `code`, món giữ nguyên `id` (thực đơn và lượt ghi trỏ vào nó). Món không còn trong nội dung thì **không bị xóa** (một thực đơn cũ có thể trỏ vào nó). Chạy lại không ghi lại dòng nào (test so `xmin`).

### Lập thực đơn (trong Node)

`GET /nutrition/plan` đọc thực đơn của **hôm nay** (ngày logic của `app.now()` theo múi giờ đã lưu, do SQL quyết). Chưa có dòng nào thì Node lập: với mỗi bữa `rankMeals(thư viện, slotTarget(đơn kê hiện tại, bữa), bữa, { excludeIds: [], excludedTags: excluded_meal_tags })`, rồi `pickMeal(ranked, Math.random)` (ngẫu nhiên trong 5 món đầu); `macroWarning` lấy từ kết quả xếp hạng. Bốn bữa được lưu bằng `nutrition_plan_save`, rồi đọc lại. Không còn món nào cho một bữa (mọi món bị loại trừ) → `meal: null`, `macroWarning: true`. Không món nào trong ±30 % → món gần nhất theo kcal, `macroWarning: true`. Thay đổi loại trừ nguyên liệu tác động ngay tới ứng viên đổi món và tới thực đơn từ lần lập sau (AR-15); lập lại thực đơn khi đổi cài đặt nằm ngoài phạm vi.

Hai lần đọc đầu tiên chạy song song: cả hai có thể thấy chưa có dòng nào và cùng gọi `nutrition_plan_save`; hàm khóa dòng `users` trước, lượt sau chờ lượt trước commit rồi `ON CONFLICT DO NOTHING`, và câu đọc lại (một câu lệnh mới, READ COMMITTED) thấy thực đơn của lượt trước. Kết quả: một thực đơn, mọi câu trả lời giống nhau.

**Qua nửa đêm logic giữa đọc và lưu.** `ensurePlan` đọc "hôm nay" (ngày D) rồi mới gọi `nutrition_plan_save(D, …)`. Nếu ranh giới ngày logic rơi đúng giữa hai câu lệnh, hàm tính lại hôm nay là D+1 và từ chối D là `DAY_CLOSED`: request trả `409 DAY_CLOSED`, không dòng nào được lưu. Gửi lại (app coi như mọi `409` có thể thử lại) sẽ lập thực đơn cho D+1. Cửa sổ chỉ dài bằng hai câu lệnh trong cùng một request; không có cơ chế tự thử lại trong server.

### Hàm

| Hàm | Việc |
|---|---|
| `app._open_today(p_user uuid) → date` (nội bộ) | Hôm nay của người dùng, giữ khóa dòng `users`. `ONBOARDING_REQUIRED` cho người đã xóa / chưa onboarding; `DAY_CLOSED` khi hôm nay không mở (≤ `last_closed_date` hoặc trước ngày đầu tiên). Không tạo dòng `daily_logs`: mở thực đơn không phải là một hoạt động của ngày. |
| `nutrition_plan_save(p_logical_date date, p_slots jsonb) → void` | Lưu thực đơn Node đã chọn. Chỉ cho hôm nay: ngày trước là `DAY_CLOSED`, ngày sau là `OCCURRED_AT_INVALID`. `p_slots` là mảng `{mealSlot, mealId (món của đúng bữa đó, hoặc null), macroWarning (boolean)}`; khác đi là `VALIDATION_FAILED` (`slots` / `format`). Không bao giờ ghi đè một dòng đã có. |
| `nutrition_swap(p_meal_slot text, p_meal_id uuid, p_action_id uuid) → void` | Đổi món một bữa của hôm nay. Thứ tự lỗi: `DAY_CLOSED` → `PLAN_NOT_FOUND` (không có dòng của bữa) → `MEAL_ALREADY_LOGGED` → `SWAP_LIMIT_REACHED` (`swaps_used` đã tới 3, hoặc 5 khi người gọi có perk `MEAL_SWAP_PLUS` trong `perk_unlocks`) → `SWAP_CANDIDATE_INVALID` (không phải món của bữa đó, là món đang ở bữa, hoặc đã hiện trong ngày). Món cũ vào `shown_meal_ids`, `swaps_used + 1`. `macro_warning` mới = kcal của món nằm ngoài ±30 % phần của bữa trong mục tiêu calo (`SLOT_SHARE`), đúng điều `rankMeals` nói về chính món đó (có test so). `p_action_id` không đặt tên dòng nào: phát lại là việc của tầng idempotency. |
| `nutrition_log_slot(p_action_id uuid, p_meal_slot text, p_occurred_at timestamptz) → jsonb` | Ghi bữa trong thực đơn của ngày `p_occurred_at` rơi vào (qua `app._open_log`): một dòng `nutrition_logs` với kcal, bữa, id và **tên món** (`label`, nên lịch sử ngày hiện tên món), đánh dấu `logged_action_id`, rồi `app._add_calories` (chốt `NUTRITION_TARGET` như ghi tay). Trả đúng kết quả của `app._add_calories`. Id đã có: của người gọi là no-op, của người khác `IDEMPOTENCY_KEY_REUSED`. Rồi: `VALIDATION_FAILED` (`mealSlot` / `enum`) → `OCCURRED_AT_INVALID` → `DAY_CLOSED` → `PLAN_NOT_FOUND` (không có dòng, hoặc bữa không có món) → `MEAL_ALREADY_LOGGED`. |

Ba hàm gọi được là `SECURITY DEFINER`, chỉ `app_auth`. **Khóa**: `users`, dòng ngày, dòng thực đơn (`FOR NO KEY UPDATE`), rồi dòng tiến độ nhiệm vụ và `progression_state` (trong `app._add_calories`); dòng `nutrition_logs` chèn sau cùng.

### Ba route mới và nhánh `mealSlot`

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `GET /nutrition/plan` | `user` | `200 MealPlanState` | `409 DAY_CLOSED` (chỉ khi phải lập mà hôm nay không mở) |
| `GET /nutrition/swap-candidates?mealSlot=` | `user` | `200 SwapCandidates` | `422 VALIDATION_FAILED` (`mealSlot` / `required`, `enum`), `409 DAY_CLOSED` (như trên) |
| `POST /nutrition/swap` | `user`, có khóa | `200 MealPlanState` | `422 VALIDATION_FAILED` (`mealSlot` / `required`, `enum`; `mealId` / `required`, `format`), `409 PLAN_NOT_FOUND`, `409 MEAL_ALREADY_LOGGED`, `409 SWAP_LIMIT_REACHED`, `422 SWAP_CANDIDATE_INVALID`, `409 DAY_CLOSED` |
| `POST /nutrition/log` với `mealSlot` | `user`, có khóa | `200 ActionResult` | `409 PLAN_NOT_FOUND`, `409 MEAL_ALREADY_LOGGED`, `409 DAY_CLOSED`, `422 OCCURRED_AT_INVALID`, `422 VALIDATION_FAILED` (`mealSlot` cùng `kcal`) |

- **`MealPlanState`**: `logicalDate`, `target` (đơn kê hiện tại: `kcal`, `proteinG`, `carbsG`, `fatG`), `caloriesIn` (của hôm nay, gồm cả ghi tay), `calorieWindow` (`calorieWindow` của `domain/energy.ts`), `slots` luôn đủ bốn theo thứ tự `BREAKFAST`, `LUNCH`, `DINNER`, `SNACK`, mỗi bữa `{mealSlot, meal (Meal hoặc null), logged, swapsUsed, swapsAllowed (3 hoặc 5), macroWarning}`.
- **Ứng viên**: xếp hạng lại mỗi request với `excludeIds` = `shown_meal_ids` của bữa + món đang ở cả bốn bữa, `excludedTags` = cài đặt hiện tại; trả tối đa 3 món đầu, mỗi món là `Meal` + `kcalDelta` = kcal ứng viên − kcal món hiện tại (0 khi bữa không có món). `swapsRemaining` = `swapsAllowed − swapsUsed`; **bữa đã ghi hoặc hết lượt → `swapsRemaining: 0`, `candidates: []`** (không phải lỗi). Chưa có thực đơn thì route lập trước (như `GET /nutrition/plan`).
- **Đổi món**: route tính lại ứng viên **trước** khi gọi `nutrition_swap`; lỗi của hàm (không có thực đơn, đã ghi, hết lượt, sai bữa) đi trước; rồi nếu `mealId` không nằm trong 3 ứng viên đã tính thì `422 SWAP_CANDIDATE_INVALID` và transaction bị hoàn tác. Câu trả lời là `MealPlanState` sau khi đổi; cùng khóa, cùng thân → câu trả lời đã lưu, không tính thêm lượt.

### Mồi nhử, ca tấn công, test

- `server/sql/84-decoy-nutrition.sql`: `DECOY_1` có một dòng thực đơn (bữa trưa ngày `2026-01-01`, món `COM_GA_RAU_CU` theo `code`, đã đổi một lần).
- `server/checks/attacks/nutrition.ts` (năm ca): `nutrition_plan_save` cho hôm qua (`DAY_CLOSED`), ngày mai (`OCCURRED_AT_INVALID`) và ngày của mồi nhử; `nutrition_swap` và `nutrition_log_slot` của A không chạm được dòng của mồi nhử (`PLAN_NOT_FOUND`); `nutrition_log_slot` với id lượt ghi của mồi nhử (`IDEMPOTENCY_KEY_REUSED`); `UPDATE daily_meal_plans` trực tiếp (`permission denied`); đối chứng: lưu và đổi món của A ghi dòng của A, không dòng nào của mồi nhử.
- `server/src/routes/nutritionPlan.test.ts` (qua HTTP, đồng hồ test): bốn dòng ở lần đọc đầu, lần sau giống hệt, 10 lần đọc song song → bốn dòng; mỗi món là một trong 5 món đầu của `rankMeals` và trong dung sai nó báo; loại trừ nguyên liệu; mục tiêu 1200 và 4000; ứng viên; 3 lượt đổi (2, 1, 0 rồi `SWAP_LIMIT_REACHED`), 5 lượt với perk; ứng viên ngoài danh sách, món của bữa khác, id không tồn tại → 422; ghi bữa, chốt nhiệm vụ, ghi lại → `MEAL_ALREADY_LOGGED`, đổi bữa đã ghi → `MEAL_ALREADY_LOGGED`; `nutrition_swap` gọi thẳng với món bữa khác; `nutrition_plan_save` không ghi đè kể cả khi hai transaction đua nhau; seeder; `macro_warning` sau khi đổi so với `rankMeals`.
- `server/src/routes/nutritionPlan.reduced.test.ts` (file riêng vì cắt thư viện): thư viện chỉ còn món của mồi nhử → bữa trưa nhận món đó với `macroWarning: true`, ba bữa kia `meal: null`, `macroWarning: true`, không có ứng viên, ghi bữa không có món → `PLAN_NOT_FOUND`.

### Phần ba cổng không nhìn thấy

- Việc chọn món, xếp hạng ứng viên và kiểm "nằm trong 3 ứng viên" chạy trong Node: một client gọi thẳng `nutrition_swap` bằng `app_auth` có thể đổi sang **bất kỳ** món đúng bữa chưa hiện trong ngày (giới hạn lượt, bữa, đã ghi vẫn do SQL giữ). `nutrition_plan_save` cũng nhận bất kỳ món đúng bữa cho hôm nay khi chưa có thực đơn. Cả hai chỉ chạm thực đơn của chính người gọi, không chạm calo hay phần thưởng.
- `SLOT_SHARE` có hai bản: `domain/mealPlan.ts` và biểu thức `CASE` trong `nutrition_swap`; test `macro_warning` sau khi đổi giữ chúng khớp nhau với nội dung hiện có.
- Ràng buộc "không ghi đè", giới hạn lượt, thứ tự lỗi và chốt nhiệm vụ do test giữ; cổng 1 và 3 không đọc thân hàm.

Sửa `40-nutrition.sql` thì chạy `npm run server:test`, không chỉ `npm run db:verify`.

## Cửa hàng, kho đồ và đặc quyền (`41-shop.sql`, `routes/shop.ts`, `routes/perks.ts`, `readModels/shop.ts`)

Tiêu xu vào vật phẩm thẩm mỹ, mỗi vật phẩm một lần, không bao giờ tiêu quá số dư; trang bị vật phẩm; tiêu điểm đặc quyền vào ba tiện ích. Hợp đồng: `Shop`, `ShopItem`, `PurchaseResult`, `Inventory`, `Perks`, `PerkUnlockRequest` trong `docs/api/openapi.yaml`; giá đặc quyền là `PERKS` của `domain/economy.ts` (F-10, R-03.2, R-D07, AR-31).

### Bảng

Không có bảng mới: `shop_items`, `inventory`, `perk_unlocks`, `coin_ledger` của `20-progression.sql`. Không lưu số dư, cấp hay điểm (AR-04): xu là tổng `coin_ledger`, cấp tính từ tổng XP hiện tại, điểm đặc quyền tính từ `xp_high_water`, chủ đề / trang phục / huy hiệu đang dùng là dòng `inventory` có `equipped`. Vật phẩm mặc định (`THEME_DEFAULT`, `SKIN_DEFAULT`) ai cũng sở hữu và **không bao giờ là một dòng `inventory`** (AR-31): "đang dùng mặc định" nghĩa là loại đó không có dòng nào `equipped`.

### Hàm

| Hàm | Việc |
|---|---|
| `app._lock_progression(p_user uuid) → void` (nội bộ) | Khóa dòng `users` (`FOR NO KEY UPDATE`, khóa đầu tiên của mọi thao tác ghi của người dùng) rồi dòng `progression_state` (`FOR UPDATE`). `ONBOARDING_REQUIRED` cho người đã xóa / chưa onboarding. |
| `shop_purchase(p_item_code text, p_action_id uuid) → jsonb` | Mua bằng xu. Thứ tự lỗi: `ITEM_NOT_FOUND` → `ITEM_NOT_PURCHASABLE` (huy hiệu kiếm được, vật phẩm mặc định) → `ITEM_LOCKED_LEVEL` (`details.minLevel`; cấp của tổng XP hiện tại, `app._level`) → `ALREADY_OWNED` → `INSUFFICIENT_COINS` (`details.price`, `details.coin`). Rồi `app._grant(người gọi, 0, −giá, 'PURCHASE', mã vật phẩm)` và dòng `inventory`, trong cùng transaction (R-10.2). Khóa sổ cái là **mã vật phẩm** (AR-34): một vật phẩm chỉ được trả tiền một lần trong đời tài khoản. Không ghi XP, không chạm chuỗi ngày hay tổ đội (R-10.1). Trả kết quả `app._grant` cộng `reason`, `ref`. `p_action_id` không đặt tên dòng nào: phát lại là việc của tầng idempotency. |
| `inventory_equip(p_item_code text) → void` | `ITEM_NOT_OWNED` trừ khi vật phẩm là của người gọi hoặc là mặc định (mã không tồn tại cũng là `ITEM_NOT_OWNED`). Bỏ trang bị mọi dòng **cùng loại** của người gọi, rồi trang bị dòng của vật phẩm; vật phẩm mặc định không có dòng, nên trang bị nó để loại đó không còn dòng nào `equipped`. Loại khác không bị đụng tới. |
| `perk_unlock(p_perk_code text, p_item_code text) → void` | Giá: `MEAL_SWAP_PLUS` 2, `TICKET_CAP_PLUS` 3, `THEME_UNLOCK` 1 (bằng `PERKS`; test đọc cột `cost` sau mỗi lần mở). Mã khác: `VALIDATION_FAILED` (`perkCode` / `enum`). Hai đặc quyền một lần: `PERK_ALREADY_UNLOCKED` ở lần thứ hai. `THEME_UNLOCK` lấy chủ đề `p_item_code` bất kể giá (AR-31): `ITEM_NOT_FOUND` (không phải chủ đề, hoặc là chủ đề mặc định) → `ALREADY_OWNED` → `ITEM_LOCKED_LEVEL` (`details.minLevel`), rồi thêm dòng `inventory`, không chạm xu. Cuối cùng `PERK_POINTS_INSUFFICIENT` nếu điểm còn lại không đủ: (cấp cao nhất có `cumulative_xp ≤ xp_high_water`) − 1 − tổng `perk_unlocks.cost`. |

Ba hàm gọi được là `SECURITY DEFINER`, `EXECUTE` chỉ cho `app_auth`, đăng ký trong `meta`; người dùng luôn là `app.current_user_id()`, không hàm nào nhận id người dùng, giá hay số điểm.

**Vì sao không bao giờ tiêu quá.** Mỗi hàm gọi `app._lock_progression` **trước khi đọc** số dư, cấp, quyền sở hữu hay điểm. Hai request của cùng một người chạy lần lượt: request sau chờ khóa, rồi (READ COMMITTED, mỗi câu lệnh đọc cái đã commit) thấy dòng sổ cái và dòng `inventory` của request trước. Không có `CHECK` nào giữ điều này (số dư không phải một cột): bỏ khóa đi là test đua thấy tiêu quá ngay (xem dưới). Mua cùng một vật phẩm hai lần còn có thêm hai lớp: khóa duy nhất `(user_id, reason, ref_id)` của sổ cái và `(user_id, shop_item_id)` của `inventory`.

**Điểm đặc quyền không bao giờ bị lấy lại.** Điểm tính từ `xp_high_water`, không từ tổng XP: một lượt hoàn tác (hay một bút toán âm) hạ tổng XP và có thể hạ cấp hiện tại (cửa hàng khóa lại vật phẩm cấp cao), nhưng điểm vẫn nguyên.

**Hoàn tác sau khi mua.** Một tick cho 5 xu, người dùng tiêu chúng trong 10 giây rồi bấm Hoàn tác: `quest_undo` từ chối bằng `409 UNDO_COINS_SPENT` (mã mới của Task 37, thay mã tạm `UNDO_WINDOW_EXPIRED` của Task 20) và không ghi gì. Hoàn tác phải đảo đúng các dòng sổ cái của tick, và tổng xu không bao giờ âm; báo "hết thời gian" thì sai sự thật.

### Sáu route

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `GET /shop` | `user` | `200 Shop` | – |
| `POST /shop/{itemCode}/purchase` | `user`, có khóa, không thân | `200 PurchaseResult` | `404 ITEM_NOT_FOUND`, `409 ITEM_NOT_PURCHASABLE`, `409 ITEM_LOCKED_LEVEL` (`minLevel`), `409 ALREADY_OWNED`, `409 INSUFFICIENT_COINS` (`price`, `coin`) |
| `GET /inventory` | `user` | `200 Inventory` | – |
| `POST /inventory/{itemCode}/equip` | `user`, có khóa, không thân | `200 Inventory` | `409 ITEM_NOT_OWNED` |
| `GET /perks` | `user` | `200 Perks` | – |
| `POST /perks/unlock` | `user`, có khóa | `200 Perks` | `422 VALIDATION_FAILED` (`body`; `perkCode` / `required`, `enum`; `itemCode` / `required`, `format`, chỉ với `THEME_UNLOCK`), `404 ITEM_NOT_FOUND`, `409 ALREADY_OWNED`, `409 ITEM_LOCKED_LEVEL` (`minLevel`), `409 PERK_ALREADY_UNLOCKED`, `409 PERK_POINTS_INSUFFICIENT` |

- **`ShopItem`**: `code`, `name`, `kind`, `priceCoin`, `minLevel`, `assetKey`, `purchasable`, `isDefault` (của `shop_items`), `owned` (mặc định, hoặc có dòng `inventory`), `equipped` (dòng `equipped`; vật phẩm mặc định khi loại đó không có dòng nào `equipped`), `locked` (cấp hiện tại < `minLevel`). Thứ tự cố định: loại (`THEME`, `PET_SKIN`, `BADGE`), mặc định trước, rồi cấp, giá, mã.
- **`GET /shop`**: vật phẩm mua được và vật phẩm mặc định (huy hiệu kiếm được không có trong cửa hàng), `coin` = tổng sổ cái, `level` = cấp của tổng XP hiện tại.
- **`GET /inventory`**: vật phẩm đã sở hữu: hai mặc định, đồ đã mua, chủ đề mở bằng đặc quyền, huy hiệu kiếm được.
- **`PurchaseResult`**: `coin` = số dư sau khi mua, `item` = vật phẩm vừa mua (`owned: true`, `equipped: false`). Mua **không** tự trang bị.
- **`Perks`**: ba đặc quyền theo thứ tự `PERKS`, mỗi cái `{code, cost, unlocked, repeatable}`; `repeatable` chỉ đúng với `THEME_UNLOCK`, và `unlocked` của nó đúng khi đã dùng ít nhất một lần; `pointsAvailable`. Với đặc quyền khác `THEME_UNLOCK`, `itemCode` bị bỏ qua.
- `GET /me` `appearance` đổi ngay sau khi trang bị (cùng nguồn: dòng `equipped`).
- Mỗi lần mua ghi một dòng `log.ledger` (`kind: 'coin'`, số âm, `reason: 'PURCHASE'`, `refId` = mã vật phẩm). Trang bị và mở đặc quyền không ghi sổ cái.

### Mồi nhử, ca tấn công, test

- Không có file mồi nhử mới: `80-decoy-base.sql` đã cho `DECOY_1` một dòng `inventory` (`THEME_FOREST`) và một dòng `perk_unlocks` (`THEME_UNLOCK` của `THEME_FOREST`).
- `server/checks/attacks/shop.ts` (ba ca): `INSERT` trực tiếp vào `inventory`, `coin_ledger`, `perk_unlocks` bằng `app_auth` → `permission denied for table`; A mua và trang bị `THEME_FOREST` trong lúc mồi nhử sở hữu **và đang trang bị** nó (chỉ điều kiện chủ sở hữu ngăn A bị báo `ALREADY_OWNED`, ngăn lượt trang bị của A bỏ trang bị dòng của mồi nhử, và ngăn A trang bị trước khi mua); A mở `THEME_FOREST` bằng điểm đặc quyền duy nhất của mình (chỉ điều kiện chủ sở hữu ngăn điểm đã tiêu và dòng chủ đề của mồi nhử tính vào A). Ca tấn công cấp xu / XP cho A rồi xóa lại mọi thứ đã cho, để các ca sau gặp A như cũ.
- `server/src/routes/shop.test.ts` (qua HTTP, và qua hai pool `app_conn` với đổi vai thật): cửa hàng; mua (số dư giảm đúng giá, một dòng `inventory`, một dòng sổ cái, không dòng XP, `progression_state` không đổi, dòng log; phát lại cùng khóa → câu trả lời giống hệt, vẫn một dòng); từng lỗi với mã và `details`; hoàn tác sau khi mua → `UNDO_COINS_SPENT`; ba cuộc đua (`Promise.allSettled`, mỗi lời gọi là một transaction, xen kẽ hai pool): hai vật phẩm mỗi cái bằng cả số dư (20 vòng) → đúng một thành công, số dư 0; cùng vật phẩm hai khóa (20 vòng) → một dòng `inventory`, một dòng sổ cái, lượt kia `ALREADY_OWNED`; mười vật phẩm 30 xu với 100 xu → đúng 3 thành công, còn 10; trang bị; kho đồ; đặc quyền; năm `THEME_UNLOCK` song song với 3 điểm (10 vòng) → đúng 3, điểm về 0, không âm; điểm còn nguyên sau khi tổng XP bị hạ dưới ngưỡng cấp.
- **Test có cắn.** Mỗi luật đã được phá thử một lần và test tương ứng đỏ: bỏ khóa (thêm `pg_sleep` giữa đọc số dư và trừ xu) → ba test đua đỏ; giá lệch 1 xu; bỏ kiểm số dư; bỏ `ALREADY_OWNED`; phát lại không qua tầng idempotency; bỏ khóa của `perk_unlock`; đổi giá đặc quyền; đặc quyền một lần mở lại được; `THEME_UNLOCK` bỏ qua cấp hoặc chủ đề đã có; điểm tính từ tổng XP; trang bị bỏ trang bị mọi loại hoặc không kiểm quyền sở hữu; hoàn tác trả lại mã cũ. Bỏ từng điều kiện chủ sở hữu (sở hữu khi mua, bỏ trang bị, sở hữu khi trang bị, tổng điểm đã tiêu, sở hữu khi mở chủ đề) thì ca tấn công tương ứng đỏ.
- Kịch bản `rich` (cấp 8, 500 xu, 3 điểm) để thử cửa hàng trên app: xem "Kịch bản phát triển".

### Phần ba cổng không nhìn thấy

- Giá đặc quyền có hai bản: `PERKS` của `domain/economy.ts` và biểu thức `CASE` trong `perk_unlock`; test đọc cột `cost` giữ chúng khớp nhau. Ngưỡng cấp đến từ `level_thresholds` (seed từ domain).
- Thứ tự lỗi, "mua không ghi XP", khóa trước khi đọc và các điều kiện chủ sở hữu do test và ca tấn công giữ; cổng 1 và 3 không đọc thân hàm.
- Vật phẩm giá 0 sẽ được mua mà không có dòng sổ cái nào (`amount <> 0`); hiện không có vật phẩm như vậy.
- `app._level` và điểm đặc quyền đọc `level_thresholds`, chỉ được seed tới cấp 200 (khoảng 22,5 triệu XP): trên đó SQL dừng ở 200 còn `levelForXp` của domain vẫn đếm tiếp. Không ai chạm tới được trong thực tế; không cổng nào kiểm điều này.

Sửa `41-shop.sql` thì chạy `npm run server:test` và `npm run db:api-check`, không chỉ `npm run db:verify`.

## Tổ đội (`50-guild.sql`, `routes/guild.ts`, `readModels/guild.ts`)

Tổ đội 3–8 người, vào bằng mã mời, mỗi người tối đa một tổ đội, mỗi tổ đội đúng một tổ trưởng. Thành viên thấy nhau ở mức tên hiển thị, cấp, vai trò, số ngày hoàn thành trong tuần và nhiệm vụ chính hôm nay đã xong chưa, **không gì khác** (F-11, R-D08, R-P.1, AR-17, AR-18). Hợp đồng: `GuildState`, `GuildMember`, `GuildCreateRequest`, `GuildJoinRequest`, `TransferRequest` trong `docs/api/openapi.yaml`. Bảng xếp hạng và thưởng tuần: xem "Bảng xếp hạng và thưởng tuần"; nhắc nhở: xem "Nhắc nhở (nudge) và nhắc nhiệm vụ"; không có kick, không có chat.

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `guilds` | `internal` (`app_auth` không có quyền nào, chỉ đọc qua hàm) | `name` đã cắt khoảng trắng, 3–30 ký tự, **duy nhất không phân biệt hoa thường** (`guilds_name_key` trên `lower(name)`); `name` và `motto` luôn ở dạng **NFC** (`guilds_text_nfc_check`), nên dạng tổ hợp NFD của một tên đã có là chính tên đó; `motto` ≤ 80, không có là `''`; `invite_code` duy nhất, 8 ký tự `A-Z0-9` ở mức bảng |
| `guild_memberships` | `own_read` (mỗi người chỉ `SELECT` được dòng của mình) | khóa chính `user_id` = một tổ đội mỗi người; `guild_id` xóa lan theo tổ đội; `role` `LEADER` / `MEMBER`; `joined_at`. **Chỉ mục duy nhất `guild_memberships_one_leader_idx` trên `guild_id` WHERE `role = 'LEADER'`: hai tổ trưởng là điều cơ sở dữ liệu không cho.** Người rời tổ đội mất dòng: bảng chỉ chứa thành viên hiện tại |

Mã mời theo AR-18: 8 ký tự từ `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (`app._invite_code()`: mỗi ký tự một byte ngẫu nhiên của `sha256(gen_random_uuid())`; 256 chia hết cho 32 nên mọi ký tự đều khả năng như nhau). Bảng nhận rộng hơn (`A-Z0-9`) chỉ để tổ đội mồi nhử giữ được một mã mà `guild_join` không bao giờ khớp.

### Hàm

| Hàm | Việc và thứ tự lỗi |
|---|---|
| `guild_create(p_name text, p_motto text) → uuid` | Tên và khẩu hiệu được chuẩn hóa NFC (`normalize(…, NFC)`) rồi cắt khoảng trắng **trước** mọi kiểm tra và trước khi lưu, nên không route nào lách được. `VALIDATION_FAILED` (tên 3–30 ký tự sau khi cắt, khẩu hiệu ≤ 80; route đã xét, đây là hàng rào thứ hai) → `ALREADY_IN_GUILD` → `GUILD_NAME_TAKEN` (mọi kiểu hoa thường; cũng là kết quả của người thua khi hai người tạo cùng một tên một lúc: người sau chờ chỉ mục duy nhất rồi nhận lỗi này). Mã mời trùng thì rút lại, tối đa 5 lần. Người gọi thành `LEADER`. |
| `guild_join(p_invite_code text) → uuid` | Mã được cắt khoảng trắng và viết hoa. `INVITE_CODE_INVALID` (không tổ đội nào có mã đó, hoặc mã không phải 8 ký tự của bảng chữ AR-18) → `ALREADY_IN_GUILD` (ở bất kỳ tổ đội nào, kể cả chính tổ đội này) → `GUILD_FULL` (đã 8, đếm sau khi khóa dòng tổ đội). |
| `guild_leave() → void` | `NOT_IN_GUILD` → `LEADER_MUST_TRANSFER` (tổ trưởng còn thành viên khác). Tổ trưởng một mình: xóa dòng tổ đội (dòng thành viên và mã mời đi theo, tên được giải phóng). Thành viên: xóa dòng của mình. |
| `guild_transfer(p_user_id uuid) → void` | `NOT_LEADER` (không ở tổ đội nào, hoặc không phải tổ trưởng) → `TRANSFER_TARGET_INVALID` (chính mình, hoặc người không thuộc tổ đội này, kể cả id không tồn tại). Hai câu lệnh: hạ người gọi xuống `MEMBER` rồi mới nâng người nhận lên `LEADER` (chỉ mục một-tổ-trưởng được kiểm từng dòng). |
| `guild_overview() → jsonb` | Không có tham số: chỉ tổ đội của người gọi, `{"guild": null}` khi không có. Trả `id`, `name`, `motto`, `inviteCode`, `createdAt`, `myRole`, `today` (ngày lịch `Asia/Ho_Chi_Minh` của `app.now()`), `weekStart` (thứ Hai của nó), `lastLogDate` (ngày logic mới nhất trong mọi nhật ký ngày của các thành viên, `null` nếu chưa có), và mỗi thành viên: `userId`, `displayName`, `role`, `joinedDate` (ngày logic của `joined_at` theo múi giờ của thành viên), `xp` (tổng sổ cái), `days` (mỗi ngày của tuần hiện tại có nhật ký: `date`, `storyDone`, `storyTotal`, `frozen`; đọc qua `app._member_days`, bản duy nhất của luật này, dùng chung với `job_guild_week_inputs`), `today` (ngày logic **của chính thành viên**: `date`, `storyDone`, `storyTotal`). Tổ trưởng đứng đầu, rồi theo `joined_at`, rồi `user_id` (người vào cùng một thời điểm, như khi đồng hồ test đứng yên). |

- `frozen` = có vé dùng cho ngày đó **và** chưa xong hết nhiệm vụ STORY (AR-10: ngày có vé mà xong hết là ngày hoàn thành, không phải ngày đóng băng).
- `storyTotal` đếm nhiệm vụ STORY đang bật của archetype của thành viên, như `app._story_check`.
- Năm hàm là `SECURITY DEFINER`, `EXECUTE` chỉ cho `app_auth`, đăng ký trong `meta`; người gọi luôn là `app.current_user_id()`. `app._lock_member` (khóa dòng `users`; `ONBOARDING_REQUIRED` cho người đã xóa hoặc chưa onboarding) và `app._invite_code` là nội bộ, không vai trò nào gọi được.

**Thứ tự khóa.** Mọi hàm ghi: dòng `users` của người gọi (`FOR NO KEY UPDATE`, khóa đầu tiên của mọi thao tác ghi của một người, như `30-day.sql` và `41-shop.sql`) → dòng `guilds` (`FOR UPDATE`) → các dòng `guild_memberships`. Không bao giờ khóa `progression_state` ở đây. Dòng tổ đội là mutex của danh sách thành viên: ai đếm thành viên, đọc vai trò hay đổi một trong hai đều giữ nó, và **đọc lại sau khi khóa** điều đã đọc trước đó. Ví dụ: tổ trưởng chuyển quyền cho M đúng lúc M rời đi; M đọc lại vai trò sau khi khóa, thấy mình đã là tổ trưởng và nhận `LEADER_MUST_TRANSFER`, thay vì rời đi để lại một tổ đội không ai đứng đầu. `FOR UPDATE` an toàn dù `guild_memberships` và `guild_weekly_scores` tham chiếu `guilds`: dòng thành viên chỉ được chèn dưới chính khóa đó (hoặc cho tổ đội vừa tạo trong cùng transaction); nơi duy nhất khác giữ khóa key-share trên tổ đội là `job_apply_guild_week`, và nó khóa **mọi dòng `users` nó cần trước** khi chạm tới tổ đội, nên không bao giờ vừa giữ tổ đội vừa chờ một dòng `users`: không có vòng chờ (deadlock) với thứ tự ở đây.

**Một người một tổ đội** nhờ khóa chính `user_id` và việc kiểm `ALREADY_IN_GUILD` dưới khóa dòng `users` (hai lượt tạo hoặc tham gia của cùng một người chạy lần lượt). **Tối đa 8** nhờ đếm dưới khóa dòng tổ đội: năm người tham gia một tổ đội 7 người cùng lúc thì đúng một người vào.

### Năm route

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `POST /guilds` | `user`, có khóa | `200 GuildState` | `422 VALIDATION_FAILED` (`body`; `name` / `required`, `min`, `max`, `format`; `motto` / `max`, `format`), `422 NAME_NOT_ALLOWED`, `409 ALREADY_IN_GUILD`, `409 GUILD_NAME_TAKEN` |
| `POST /guilds/join` | `user`, có khóa | `200 GuildState` | `422 VALIDATION_FAILED` (`body`; `inviteCode` / `required`, `format`), `404 INVITE_CODE_INVALID`, `409 ALREADY_IN_GUILD`, `409 GUILD_FULL` |
| `GET /guilds/me` | `user` | `200 GuildState` (`{"guild": null}` khi không ở tổ đội nào) | – |
| `POST /guilds/me/leave` | `user`, có khóa, không thân | `204` | `409 NOT_IN_GUILD`, `409 LEADER_MUST_TRANSFER` |
| `POST /guilds/me/transfer` | `user`, có khóa | `200 GuildState` | `422 VALIDATION_FAILED` (`body`; `userId` / `required`, `format`: phải là UUID), `403 NOT_LEADER`, `422 TRANSFER_TARGET_INVALID` |

- Thứ tự lỗi của `POST /guilds`: thân sai (`VALIDATION_FAILED`) → từ cấm trong tên hoặc khẩu hiệu (`NAME_NOT_ALLOWED`, `findBannedTerms` của `domain/language.ts`, xét sau cùng ở route như với tên hiển thị) → `ALREADY_IN_GUILD` → `GUILD_NAME_TAKEN`. Tên: chuẩn hóa NFC, cắt khoảng trắng, 3–30 ký tự (đếm trên dạng NFC), cùng định dạng với tên hiển thị (không ký tự vô hình, có ít nhất một chữ hoặc số). Khẩu hiệu: tùy chọn, chuẩn hóa NFC, cắt khoảng trắng, ≤ 80, không ký tự vô hình.
- Người không ở tổ đội nào gọi chuyển quyền nhận `403 NOT_LEADER` (hợp đồng không ghi `NOT_IN_GUILD` cho route này).
- **`GuildState`** do `buildGuild` tính từ `guild_overview` bằng domain: `level` = `levelForXp(xp)`; `daysCompletedThisWeek` = số ngày từ `max(weekStart, joinedDate)` tới hôm nay có đủ mọi nhiệm vụ STORY (ngày có vé mà xong hết vẫn tính); `daysCountedThisWeek` = `memberWeek(…).countedDays`; `weekCompletion` = `scoreGuildWeek(…).avgCompletion`. Tuần là tuần bắt đầu thứ Hai của `Asia/Ho_Chi_Minh`, **tính tới ngày lịch hôm nay ở đó** (AR-17); chỉ `storyDoneToday` dùng ngày logic của chính thành viên. `inactiveDays` = số ngày tới hôm nay (giờ Hồ Chí Minh) tính từ ngày **muộn hơn** trong hai ngày: `lastLogDate` (ngày ghi gần nhất của bất kỳ thành viên nào) và ngày tạo tổ đội (giờ Hồ Chí Minh); chưa ai ghi gì thì tính từ ngày tạo. Tổ đội không thể "lặng" lâu hơn tuổi của nó: tổ đội mới tạo hôm nay không bao giờ `inactive` ngay ngày đầu, kể cả khi mọi thành viên ghi lần cuối từ 20 ngày trước; `inactive` = `inactiveDays ≥ 14` (`GUILD_INACTIVE_DAYS`). `nudge` = `{allowed: reason == null, reason}` với `reason` = `app._nudge_block_reason(người gọi, thành viên)` mà `guild_overview` trả cho từng dòng (xem "Nhắc nhở (nudge) và nhắc nhiệm vụ"); riêng dòng của chính người gọi là `{allowed: false, reason: null}` như hợp đồng quy định.
- Không route nào ghi sổ cái, nên không có dòng `log.ledger`.

### Riêng tư

`guild_overview` chỉ đọc `users` (tên, múi giờ, archetype), `guild_memberships`, `guilds`, `xp_ledger`, `daily_logs` (chỉ `id` và `logical_date`), `quests`, `quest_completions`, `freeze_tickets`. Nó không đọc `biometric_snapshots`, `prescriptions`, `nutrition_logs`, `journal_entries`, `calories_in`, `water_ml`; một test đọc mã nguồn của hàm (`pg_proc.prosrc`) để giữ điều này. Điều khoản trong app (`src/shared/i18n/vi/legal.ts`, mục "Điều thành viên tổ đội thấy") hứa đúng những gì route trả.

### Mồi nhử, ca tấn công, test

- `86-decoy-guild.sql`: tổ đội "decoy-guild" với `DECOY_1` (`LEADER`) và `DECOY_2` (`MEMBER`). Mã mời `DECOY000` có chữ O và số 0, ngoài bảng chữ AR-18: `guild_join` từ chối trước khi tìm, nên không ai tham gia được tổ đội mồi nhử.
- `server/checks/attacks/guild.ts` (bảy ca): `app_auth` đọc `guilds` → `permission denied for table guilds`, chèn thẳng vào `guild_memberships` → `permission denied`; A ngoài mọi tổ đội `SELECT` `guild_memberships` → 0 dòng, rồi A làm tổ trưởng tổ đội riêng → chỉ dòng của A (dòng `LEADER` của mồi nhử không bao giờ hiện: chính sách chỉ theo chủ sở hữu, không theo giá trị cột); A **là thành viên của chính tổ đội mồi nhử** (chèn bằng superuser) và `SELECT` `guild_memberships` → chỉ dòng của A (chỉ điều kiện chủ sở hữu ngăn A thấy dòng mồi nhử cùng tổ); A **là tổ trưởng tổ đội riêng** và chuyển quyền cho `DECOY_2`, `DECOY_1` → `TRANSFER_TARGET_INVALID` (dòng thành viên đích có thật, chỉ điều kiện cùng tổ đội từ chối), vai trò mồi nhử không đổi; A là thành viên tổ đội mồi nhử: chuyển quyền → `NOT_LEADER`, rời đi chỉ xóa dòng của A; `guild_join` với `DECOY000` theo mọi cách viết → `INVITE_CODE_INVALID`; `guild_overview` của A ngoài tổ đội → `{"guild": null}`, trong tổ đội riêng → chỉ có A. Mỗi ca so dòng tổ đội mồi nhử và danh sách thành viên của nó trước và sau (`decoyRows` không với tới `guilds`).
- `server/src/routes/guild.test.ts` (qua HTTP, và qua hai pool `app_conn` với đổi vai thật): tạo (đúng một `LEADER`, mã theo AR-18, tên và khẩu hiệu được cắt); từng lỗi với mã và `details`, không ghi gì; ba thứ tự lỗi (tạo, tham gia, chuyển quyền) ở chỗ hai lỗi cùng áp dụng được, kể cả thân vừa sai trường vừa chứa từ cấm → `VALIDATION_FAILED`; tên dạng NFD của một tên đã có → `GUILD_NAME_TAKEN` qua HTTP và khi gọi thẳng `guild_create`, tên / khẩu hiệu NFD được lưu thành NFC; người chưa onboarding → `409 ONBOARDING_REQUIRED` ở cả năm route (lớp route `user`) và ở bốn hàm ghi gọi thẳng (`app._lock_member`, trước `INVITE_CODE_INVALID` / `NOT_IN_GUILD`); phát lại cùng khóa; mã trùng được rút lại (thay `app._invite_code` tạm thời trong cơ sở dữ liệu của test); tham gia bằng mã chữ thường có khoảng trắng; người thứ 9 → `GUILD_FULL`; ma trận rời / chuyển quyền; tổ trưởng một mình rời → tổ đội mất, mã mời hết hiệu lực, tên dùng lại được. **Riêng tư:** thành viên B có cân nặng 77,7 kg, chiều cao 177,7 cm, năm sinh 1979, mục tiêu calo 2777, calo nạp 1777,7 (kiểm là đã nằm trong cơ sở dữ liệu); thân `GET /guilds/me` của A không có khóa nào trong `weightKg`, `heightCm`, `calorieTarget`, `caloriesIn`, `bmr`, `tdee`, `waterMl`, `birthYear`, `sex` ở bất kỳ độ sâu nào và không chứa giá trị canh gác nào. Người ngoài → `{"guild": null}`. Số liệu tuần bằng đúng `memberWeek` / `scoreGuildWeek` trên cùng đầu vào (3 ngày đủ và 1 ngày nửa; người vào thứ Năm được đếm từ thứ Năm; một ngày có vé đóng băng; một ngày có vé mà xong hết; một thành viên ở Los Angeles có `storyDoneToday` theo ngày của mình, cả khi ngày đó thuộc tuần trước ở Hồ Chí Minh). `inactive` đúng ở ngày thứ 14, sai ở ngày thứ 13, cả khi chưa ai ghi gì; tổ đội mới tạo mà log cuối của thành viên đã 20 ngày: không `inactive` (0 ngày), 14 ngày sau ngày tạo mà không log mới thì `inactive`.
- **Cuộc đua** (`Promise.allSettled`, mỗi lời gọi một transaction, xen kẽ hai pool): tổ đội 7 người, 5 người tham gia cùng lúc (qua HTTP một lần, qua hai pool 5 vòng) → đúng một người vào, không bao giờ 9; tổ trưởng chuyển quyền cho hai người cùng lúc (10 vòng) → một thành công, lượt kia `NOT_LEADER`, đúng một tổ trưởng; chuyển quyền cho M trong lúc M rời đi (10 vòng) → hoặc chuyển xong và M nhận `LEADER_MUST_TRANSFER`, hoặc M đã rời và chuyển nhận `TRANSFER_TARGET_INVALID`, luôn đúng một tổ trưởng; tổ trưởng và thành viên duy nhất cùng rời (10 vòng) → không bao giờ còn tổ đội không tổ trưởng; tổ trưởng một mình rời trong lúc có người tham gia (10 vòng) → hoặc người đó đã vào, hoặc tổ đội mất và mã bị từ chối; hai người tạo cùng một tên, một người tạo hai tổ đội (10 vòng) → đúng một thành công.
- **Test có cắn.** Mỗi luật đã được phá thử một lần, test tương ứng đỏ, rồi khôi phục: bỏ khóa dòng tổ đội khi tham gia, khi rời, khi chuyển quyền (thêm `pg_sleep` vào khe giữa đọc và ghi); bỏ khóa dòng `users` khi tạo và khi chuyển quyền; giới hạn 9; đảo từng cặp thứ tự lỗi; bỏ kiểm bảng chữ (mã mồi nhử tham gia được); không viết hoa mã; tên duy nhất phân biệt hoa thường; không rút lại mã trùng; tổ trưởng còn thành viên vẫn rời được; tổ trưởng một mình rời mà tổ đội còn lại; chuyển quyền cho người tổ đội khác hoặc cho chính mình; `frozen` bỏ qua AR-10; "hôm nay" theo ngày Hồ Chí Minh thay vì ngày của thành viên; bỏ `joinedDate`; đọc `calories_in`; bỏ `lastLogDate`; thành viên của tổ đội khác lọt vào danh sách; tuần bắt đầu Chủ nhật; ngưỡng không hoạt động 15; đếm ngày trước khi vào; bỏ kiểm từ cấm của khẩu hiệu; route không cắt tên; tổ đội chưa ai ghi gì không bao giờ "không hoạt động". Bỏ từng điều kiện của ca tấn công (cùng tổ đội khi chuyển quyền, chủ sở hữu của chính sách `SELECT`, phạm vi tổ đội của `guild_overview`, bảng chữ của mã mời) thì ca tương ứng đỏ.
- Kịch bản `guild4`: xem "Kịch bản phát triển".

### Phần ba cổng không nhìn thấy

- Thứ tự lỗi, thứ tự khóa, "đọc lại sau khi khóa", phạm vi "chỉ tổ đội của người gọi" và danh sách bảng mà `guild_overview` đọc do test và ca tấn công giữ; cổng 1 và 3 không đọc thân hàm. Chỉ mục một-tổ-trưởng và khóa chính `user_id` là hai luật cơ sở dữ liệu tự giữ.
- Giới hạn 8 có hai bản: `GUILD_MAX_MEMBERS` của domain và số `8` trong `guild_join`; test tạo người thứ 9 theo hằng của domain, nên hai bản lệch nhau là test đỏ. Độ dài khẩu hiệu cũng có hai hàng rào (route và hàm): phá một trong hai thì hàng rào kia vẫn trả cùng lỗi.
- Tài khoản bị xóa hẳn (`DELETE FROM users`, như `reset` của kịch bản) kéo theo dòng thành viên nhưng **không** chuyển quyền tổ trưởng và không xóa tổ đội rỗng: tổ đội có thể còn lại không tổ trưởng, hoặc rỗng mà vẫn giữ tên. Xóa tài khoản qua API (Task 46, AR-30) phải tự chuyển quyền cho người vào sớm nhất và xóa tổ đội khi người cuối rời; trigger thì `90-verify.sql` chưa cho phép. Vì thế `guild4` xóa tổ đội cũ bằng `ctx.removeGuild` (superuser, chỉ khi mọi thành viên là tài khoản demo) trước khi xóa tài khoản; một lần chạy trước bị dừng giữa chừng (tổ đội mất tổ trưởng hoặc rỗng) cũng được dọn, không còn kẹt ở `GUILD_NAME_TAKEN`.
- "Hôm nay" của tuần tổ đội là ngày **lịch** ở Hồ Chí Minh (tuần bắt đầu thứ Hai 00:00, R-D08), không phải ngày logic bắt đầu lúc 03:00: từ 00:00 tới 03:00 thứ Hai, tuần mới đã bắt đầu trong khi ngày Chủ nhật của người dùng ở Hồ Chí Minh vẫn đang mở.

Sửa `50-guild.sql` thì chạy `npm run server:test` và `npm run db:api-check`, không chỉ `npm run db:verify`.

## Bảng xếp hạng và thưởng tuần (`51-guild-week.sql`, `leaderboardCache.ts`, `jobs/leaderboardRefresh.ts`, `jobs/weeklyRollover.ts`, `routes/leaderboard.ts`)

Xếp hạng tổ đội theo tỉ lệ hoàn thành trung bình của tuần, gần như tức thời trong tuần, rồi chốt mỗi tuần một lần và trả thưởng **đúng một lần** (F-11, R-D07, R-D08, AR-03, AR-17). Hợp đồng: `Leaderboard` và `GET /leaderboard` trong `docs/api/openapi.yaml`; thông báo `GUILD_WEEKLY_RESULT`.

### Tuần và cách tính

- Tuần là tuần bắt đầu thứ Hai của `Asia/Ho_Chi_Minh`, **khớp theo nhãn `logical_date`** của nhật ký ngày (R-D08): nhật ký mang nhãn Chủ nhật là của Chủ nhật, dù người dùng ở múi giờ nào và ghi lúc nào. Ví dụ: người ở New York ghi lúc 20:00 Chủ nhật giờ của họ (07:00 thứ Hai ở Hồ Chí Minh) → nhật ký mang nhãn Chủ nhật, tính cho tuần vừa qua; nhật ký mang nhãn thứ Hai thì không.
- Bảng tức thời tính tới **ngày lịch hôm nay ở Hồ Chí Minh** (như `GuildState`, AR-17); tuần chốt tính đủ bảy ngày.
- Số liệu do domain tính, không do SQL: `scoreGuildWeek` (trung bình của các thành viên hoạt động; ngày đóng băng và ngày không có nhật ký là 0; người vào giữa tuần tính từ ngày vào; ≥ 3 thành viên hoạt động mới được xếp hạng), `rankGuilds` (`avgCompletion` giảm dần, `activeMembers` giảm dần, `createdAt` tăng dần), `guildWeeklyReward`. Đầu vào của `rankGuilds` được sắp theo id tổ đội trước, nên khi ba tiêu chí bằng nhau thì id quyết định, không phụ thuộc thứ tự dòng.
- `scoreWeek` (`leaderboardCache.ts`) là đường duy nhất: job làm mới, job chốt tuần và route đều đi qua nó, nên không thể đếm lệch nhau.

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `guild_weekly_scores` | `internal` (không vai trò nào có quyền, chỉ đọc qua `leaderboard_final`) | một dòng mỗi tổ đội mỗi tuần đã chốt: **duy nhất `(guild_id, week_start)`**, `week_start` là thứ Hai (`CHECK`), `avg_completion` 0–1, `active_members`, `rank` (`NULL` = không xếp hạng; **duy nhất `(week_start, rank)`**: hai tổ đội cùng hạng là điều cơ sở dữ liệu không cho); chỉ mục `(week_start, avg_completion desc)`; xóa lan theo tổ đội |

Bản ghi "tuần đã chốt" là một dòng `job_runs` với `job = 'guild-week'`, `run_for` = 00:00 thứ Hai của tuần đó ở Hồ Chí Minh, `ran_at` = lúc chốt; chỉ mục duy nhất từng phần `job_runs_guild_week_key` trên `run_for` WHERE `job = 'guild-week'` giữ "mỗi tuần một lần".

### Hàm

| Hàm | Vai trò | Việc |
|---|---|---|
| `job_guild_week_inputs(p_week_start date, p_through date)` → bảng `(guild_id, name, created_at, members)` | `app_job` | Mỗi tổ đội một dòng, theo id. `members` = các thành viên **hiện tại** (người đã rời không còn dòng thành viên nên tự bị loại; người đã xóa hoặc chưa onboarding không tính), mỗi người `{userId, joinedDate (ngày logic của joined_at theo múi giờ của thành viên, cùng luật với guild_overview), days}`; `days` = `app._member_days` trên `[p_week_start, p_through]` (`date`, `storyDone`, `storyTotal`, `frozen`). Không cột nào khác. |
| `job_apply_guild_week(p_week_start date, p_rows jsonb)` → `{applied, grants}` | `app_job` | Một transaction. Ghi bản ghi tuần **trước tiên** (`ON CONFLICT DO NOTHING`); đã có → `{applied: false, grants: []}`. Rồi chèn `guild_weekly_scores` cho mọi tổ đội còn tồn tại, và với mỗi tổ đội có hạng, mỗi thành viên hoạt động **vẫn còn trong tổ đội đó**: xu qua `app._grant(…, 'GUILD_WEEKLY', '<week_start>')` (AR-34), huy hiệu hạng 1 vào `inventory`, thông báo `GUILD_WEEKLY_RESULT` `{rank, coins, weekStart}` (khóa chống trùng = ngày đầu tuần). Trả các dòng sổ cái đã ghi, mỗi dòng có `userId`, để job gọi `log.ledger`. Từ chối dòng không có tổ đội, dòng có hạng mà không có thưởng, huy hiệu không phải `BADGE`. |
| `leaderboard_final(p_week_start date)` → jsonb | `app_auth` | `{updatedAt (ran_at của bản ghi tuần, null nếu chưa chốt), entries (top 50 có hạng theo hạng: rank, guildName, avgCompletion, activeMembers, isMine), mine (dòng của tổ đội hiện tại của người gọi trong tuần đó, hoặc null)}`. Chỉ tên, tỉ lệ, số người, hạng (R-P.1). |
| `app._member_days(p_user, p_from, p_through)` | nội bộ | Ngày có nhật ký của một người, với STORY xong / tổng và `frozen` (có vé **và** chưa xong hết, AR-10). Bản duy nhất của luật này: `guild_overview` và `job_guild_week_inputs` cùng đọc ở đây. |
| `app._guild_week_rows(jsonb)` | nội bộ | Kiểu hóa `p_rows`: `guildId`, `avgCompletion`, `activeMembers`, `rank`, `coins`, `badgeCode`, `members`. |

**Thứ tự khóa của `job_apply_guild_week`:** bản ghi tuần (lượt chạy thứ hai chờ ở chỉ mục duy nhất rồi thấy tuần đã chốt) → **mọi dòng `users` có thể được trả thưởng** (`FOR NO KEY UPDATE`, theo id) → các dòng `guilds` (`FOR KEY SHARE`, theo id; tổ đội đã bị xóa thì bỏ qua) → `progression_state` (trong `app._grant`). Các hàm tổ đội khóa `users` rồi mới `guilds FOR UPDATE`; nếu job khóa tổ đội trước rồi mới khóa `users` thì hai bên có thể chờ nhau vòng tròn (deadlock). Thành viên hoạt động rời tổ đội đúng lúc chốt: rời trước → không được thưởng (vẫn được đếm trong `active_members` đã tính); chốt trước → được thưởng rồi mới rời.

### Hai job

| Job | Khi nào | Việc |
|---|---|---|
| `leaderboard-refresh` | mỗi 5 phút | Tính bảng tức thời của tuần đang chạy, cất vào bộ nhớ đệm trong tiến trình (`{weekStart, updatedAt, entries (top 50), byGuild}`). |
| `weekly-rollover` | từ 03:30 thứ Hai giờ Hồ Chí Minh | Với mỗi tuần trong 28 ngày trước tuần đang mở (tuần đang mở = tuần của thời điểm hiện tại lùi 3 giờ 30 phút), cũ nhất trước, mỗi tuần một transaction: tính đủ 7 ngày, xếp hạng, gọi `job_apply_guild_week`. Tuần đã chốt trả `applied: false` và không trả gì. Máy chủ tắt hai thứ Hai → lần chạy kế tiếp chốt cả hai tuần, theo thứ tự. Kết quả ghi vào `job_runs`: danh sách tuần đã chốt và số dòng sổ cái. Một tuần lỗi dừng lần chạy ở đó (các tuần mới hơn chờ, giữ thứ tự); lần chạy lỗi được chạy lại sau 15 phút (mỗi lần lỗi là một dòng log `error` và một dòng `job_runs` `ok = false`), không đợi tới thứ Hai sau. |

Bộ nhớ đệm là của một tiến trình (`// ponytail: in-process cache, one server process`; không Redis, AR-17).

### Route

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `GET /leaderboard?week=current\|previous` | `user` | `200 Leaderboard` | `422 VALIDATION_FAILED` (`week` / `required`, `format`: chỉ đúng `current` hoặc `previous`) |

- Thứ tự lỗi: `401 SESSION_INVALID` → `409 ONBOARDING_REQUIRED` → `422 VALIDATION_FAILED`.
- `current`: từ bộ nhớ đệm; khi trống, cũ hơn 10 phút hoặc thuộc tuần khác thì tính một lần (single flight: các request cùng lúc chờ chung một lần tính). Request tính **mượn transaction của chính nó**: đổi sang `app_job` (chỉ vai trò này gọi được `job_guild_week_inputs`), tính, rồi đổi lại `app_auth` với đúng người gọi. Không lấy client thứ hai từ pool: một handler đã giữ một client, lấy thêm có thể làm cạn pool (`noPoolInHandler` của `app.ts`). `final: false`, `updatedAt` = thời điểm tính. `mine` luôn có khi người gọi ở trong tổ đội, kể cả ngoài top 50 hay không xếp hạng (`ranked: false`, `rank: null`); tổ đội lập sau lần tính gần nhất hiện `{ranked: false, rank: null, avgCompletion: 0, activeMembers: 0}` tới lần làm mới sau; ngoài tổ đội → `null`.
- `previous`: `leaderboard_final(thứ Hai tuần trước)`; `final: true`; `updatedAt` = lúc chốt. Trước khi tuần đó được chốt (kể cả 00:00–03:30 thứ Hai): `entries: []`, `mine: null`, `updatedAt` = thời điểm của request.
- Thân trả về chỉ có các khóa của hợp đồng: không id người dùng, không id tổ đội.

### Mồi nhử, ca tấn công, test

- `87-decoy-guild-week.sql`: một dòng `guild_weekly_scores` không xếp hạng của tổ đội mồi nhử, tuần 05/01/2026.
- `server/checks/attacks/leaderboard.ts` (hai ca): `app_auth` gọi `job_guild_week_inputs` / `job_apply_guild_week` → `permission denied for function`, đọc hay xóa `guild_weekly_scores` → `permission denied for table`; A ngoài tổ đội, rồi A làm tổ trưởng tổ đội riêng, gọi `leaderboard_final` đúng tuần của mồi nhử → `{updatedAt: null, entries: [], mine: null}` (chỉ điều kiện "có hạng" giữ dòng mồi nhử khỏi `entries`, chỉ điều kiện "tổ đội của người gọi" giữ nó khỏi `mine`). Mỗi ca so dòng mồi nhử trước và sau.
- `server/src/routes/leaderboard.test.ts` (đồng hồ test cố định, `runJob`; nhật ký sắp bằng superuser, riêng ca New York ghi qua HTTP): bảng tức thời và tuần chốt bằng đúng `scoreGuildWeek` + `rankGuilds` trên cùng đầu vào; tổ đội 3 người trung bình cao hơn đứng trên tổ đội 8 người trung bình thấp hơn; tổ đội 2 người hoạt động → `mine.ranked` false, không trong `entries`, không thưởng; thưởng 150 + `BADGE_GUILD_TOP1`, 100, 60, 20, thành viên không hoạt động của tổ đội có hạng không nhận gì, thông báo và dòng `log.ledger` khớp từng người; người vào thứ Năm tính từ thứ Năm, người rời trước khi chốt bị loại, ngày đóng băng (một nhiệm vụ đã xong + vé) và ngày không nhật ký là 0 (mỗi luật đổi con số, test khẳng định cả điều đó); `guild_overview` và `job_guild_week_inputs` đọc ra cùng các ngày trên cùng dữ liệu; nhãn Chủ nhật / thứ Hai của người ở New York; 03:29 thứ Hai chưa đến hạn và chưa chốt tuần, 03:30 đến hạn và chốt; chạy hai lần không trả gì hai lần (sổ cái, kho đồ, thông báo, điểm, bản ghi tuần không đổi); hai lượt chốt cùng lúc trên hai pool → đúng một lượt áp dụng; tắt hai thứ Hai → một lần chạy chốt các tuần theo thứ tự cũ trước; bộ nhớ đệm: hai request trong 5 phút đọc `job_guild_week_inputs` một lần (đếm bằng `mock.method`), làm mới thì `updatedAt` đổi, cũ hơn 10 phút thì đọc lại, hai request song song đọc một lần; 51 tổ đội có hạng → `entries` 50, `mine` hạng 51; hòa ba tiêu chí → xếp theo id tổ đội, dù dòng đến theo thứ tự nào; `previous` trước khi chốt → rỗng, `final: true`; `week` sai → 422; thứ tự 401 → 409 → 422; quét riêng tư (đúng khóa của hợp đồng, không id, không giá trị canh gác sinh trắc) trên cả hai loại bảng; mã nguồn các hàm mới không đọc bảng hay cột riêng tư.
- **Cuộc đua** (hai pool `app_conn`, một transaction được giữ mở tới khi test thả): thành viên hoạt động rời trước → không được thưởng, chốt trước → được thưởng rồi mới rời; thứ tự khóa của `guild_join` / `guild_leave` (dòng `users`, rồi tổ đội `FOR UPDATE`) dừng giữa hai khóa trong khi chốt chạy → không deadlock; thành viên không hoạt động rời và người mới tham gia trong khi chốt giữ tổ đội → cả hai chờ rồi thành công, không ai trong họ được thưởng; 10 vòng chốt và rời cùng lúc → không lỗi nào.

### Phần ba cổng không nhìn thấy

- Thứ tự khóa của `job_apply_guild_week`, "mỗi tuần một lần" ở mức hàm, và việc chỉ trả thưởng cho thành viên còn trong tổ đội do test giữ; cổng 1 và 3 không đọc thân hàm.
- `joinedDate` là ngày logic của `joined_at` theo múi giờ của thành viên, cùng luật với `guild_overview` (test so `joinedDate` của hai bên trên một người vào lúc 01:00 giờ Hồ Chí Minh và một người ở New York).

Sửa `51-guild-week.sql` thì chạy `npm run server:test` và `npm run db:api-check`.

## Nhắc nhở (nudge) và nhắc nhiệm vụ (`52-nudge.sql`, `routes/nudge.ts`, `jobs/reminderDispatch.ts`, `seed/nudgeTemplates.ts`)

Thành viên tổ đội gửi cho đồng đội một trong các câu mẫu cố định, dưới sáu ràng buộc chống lạm dụng (F-12, R-12.1–R-12.6, AR-19); người đã bật nhắc nhiệm vụ nhận một mục trong hộp thư mỗi ngày, trong khung giờ họ chọn (AR-23). Không có thông báo đẩy. Hợp đồng: `NudgeTemplates`, `NudgeRequest`, `NudgeResult`, `GuildMember.nudge`, `InboxItemNudge` trong `docs/api/openapi.yaml`.

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `nudge_templates` | `content` (đọc) | khóa `code`, `text`; seed từ `server/content/nudgeTemplates.ts` theo `code`, không bao giờ xóa (sự kiện cũ trỏ tới mã của nó) |
| `nudge_events` | `internal` (không vai trò nào có quyền) | khóa `id` = action id của request; `sender_id`, `receiver_id` (khóa ngoại về `users`, xóa lan), `template_code` (khóa ngoại về `nudge_templates`), `sender_date` (ngày logic của người gửi), `receiver_date` (ngày logic của người nhận), `sent_at`; **duy nhất `(receiver_id, receiver_date)`** (mỗi người nhận tối đa một lời nhắc mỗi ngày của họ); `CHECK (sender_id <> receiver_id)`; chỉ mục `(sender_id, sender_date)` |

### Hàm

| Hàm | Vai trò | Việc |
|---|---|---|
| `app._nudge_block_reason(p_sender, p_receiver)` → text | nội bộ | Lý do không được nhắc lúc này, `NULL` = được. Gặp điều nào trước thì trả điều đó, theo đúng thứ tự: `NOT_IN_GUILD` (người gửi không ở tổ đội nào) → `NUDGE_NOT_SAME_GUILD` (người nhận là chính mình hoặc không cùng tổ đội) → `NUDGE_RECEIVER_MUTED` (`nudges_enabled` false) → `NUDGE_NOT_NEEDED` (mọi nhiệm vụ STORY của ngày logic hiện tại của người nhận đã xong, đọc qua `app._member_days`: cùng luật với `storyDoneToday`) → `NUDGE_OUTSIDE_WINDOW` (giờ đồng hồ của **người nhận** ngoài `[12:00, 20:00)`) → `NUDGE_RECEIVER_LIMIT` (người nhận đã có một lời nhắc cho ngày logic hiện tại của họ) → `NUDGE_SENDER_LIMIT` (người gửi đã gửi 3 cho ngày logic hiện tại của **họ**). Mỗi bên đếm theo ngày logic của chính mình. |
| `nudge_send(p_receiver_id, p_template_code, p_action_id)` → `{sentAt, senderRemainingToday}` | `app_auth` | Thứ tự: `NUDGE_TEMPLATE_UNKNOWN` → `ONBOARDING_REQUIRED` → khóa → lý do của `app._nudge_block_reason` (raise) → chèn sự kiện (vi phạm khóa duy nhất của ngày người nhận cũng thành `NUDGE_RECEIVER_LIMIT`; vi phạm khóa chính, tức action id đã là một sự kiện mà câu trả lời đã lưu không còn, thành `IDEMPOTENCY_KEY_REUSED`) → `app._notify(người nhận, 'NUDGE', {senderName, templateCode, text}, <id sự kiện>)`. Thông báo không mang gì của người gửi ngoài tên hiển thị. |
| `guild_overview()` | `app_auth` | Được tạo lại ở đây bằng `CREATE OR REPLACE` (cùng chữ ký, nên quyền và đăng ký `meta` của `50-guild.sql` giữ nguyên). Thân giống `50-guild.sql` **từng ký tự**, chỉ thêm `nudge` = `app._nudge_block_reason(người gọi, thành viên)` cho mỗi dòng. Sửa một bản thì sửa cả hai: một test so đầu ra của hai bản trên cùng dữ liệu. |
| `job_reminder_dispatch(p_now)` → int | `app_job` | Một câu lệnh: với mỗi người dùng đã onboarding, chưa xóa, bật `reminder_enabled`, có giờ đồng hồ (múi giờ của chính họ) tại `p_now` nằm trong khung đã chọn (`MORNING` `[07:00, 09:00)`, `NOON` `[11:30, 13:30)`, `EVENING` `[18:00, 20:00)`) và ngày logic hiện tại chưa `story_completed`: `app._notify(user, 'QUEST_REMINDER', {}, <ngày logic>)`. Khóa chống trùng là ngày logic nên mỗi ngày một lần. Trả số mục đã tạo. |

**Thứ tự khóa của `nudge_send`** (thứ tự chung của cả mã nguồn: dòng `users` trước hết): một câu lệnh khóa `FOR NO KEY UPDATE`, **theo id**, dòng `users` của người gửi và (chỉ khi người nhận đang cùng tổ đội) của người nhận, vì `app._notify` đòi giữ khóa dòng của người nhận; rồi `progression_state` của người gửi `FOR UPDATE` (tuần tự hóa số lời nhắc của người gửi); không khóa gì sau đó. Lý do từ chối được tính **sau** các khóa, trong một câu lệnh riêng (READ COMMITTED: thấy việc rời tổ đội, chuyển tổ trưởng hay lời nhắc khác vừa commit trong lúc chờ). A nhắc B trong khi B nhắc A: cả hai lấy hai dòng `users` theo cùng một thứ tự, không thể chờ nhau vòng tròn; `job_apply_guild_week` cũng khóa các dòng `users` theo id trước mọi thứ khác. Người nhận chưa cùng tổ đội lúc khóa (nên không bị khóa) mà vào tổ đội ngay sau đó → vẫn `NUDGE_NOT_SAME_GUILD`: không bao giờ gọi `app._notify` khi chưa giữ khóa dòng người nhận. `job_reminder_dispatch` khóa các dòng `users` sẽ nhận thông báo, theo id, trong chính câu lệnh đó.

**Đổi múi giờ** có thể dời ngày logic của người gửi, nên mượn hoặc dùng trước 3 lượt gửi của một ngày; mỗi người nhận vẫn nhận tối đa một lời nhắc mỗi ngày của chính họ. Chấp nhận.

### Route và job

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `GET /guilds/nudge-templates` | `user` | `200 NudgeTemplates` (các mẫu đã seed, theo `code`) | – |
| `POST /guilds/nudge` | `user`, idempotent, **10 lần/phút mỗi tài khoản** (AR-21) | `200 NudgeResult` | `422 VALIDATION_FAILED` (`receiverId` / `required`, `format`: UUID; `templateCode` / `required`, `format`: chuỗi), `422 NUDGE_TEMPLATE_UNKNOWN`, `409 NOT_IN_GUILD`, `403 NUDGE_NOT_SAME_GUILD`, `409 NUDGE_RECEIVER_MUTED`, `409 NUDGE_NOT_NEEDED`, `409 NUDGE_OUTSIDE_WINDOW`, `409 NUDGE_RECEIVER_LIMIT`, `409 NUDGE_SENDER_LIMIT` |

- Thứ tự lỗi: `401` → `409 ONBOARDING_REQUIRED` → `422 VALIDATION_FAILED` → thứ tự của `nudge_send` ở trên.
- Thân request chỉ được đọc hai khóa `receiverId`, `templateCode`; khóa nào khác (một câu tự viết chẳng hạn) không được đọc, không được lưu (R-12.5).
- Gửi lại cùng `Idempotency-Key` → cùng câu trả lời đã lưu, không thêm sự kiện, không tốn lượt.
- Job `reminder-dispatch` (`jobs/reminderDispatch.ts`) đến hạn ở phút 0, 15, 30, 45 (mỗi phần tư giờ một lần, từ phút đầu của nó) và gọi `job_reminder_dispatch(now)`; kết quả `{created}` ghi vào `job_runs`.

### Mồi nhử, ca tấn công, test

- `88-decoy-nudge.sql`: một lời nhắc từ `DECOY_1` tới `DECOY_2` (cả hai trong tổ đội mồi nhử) với mẫu đã seed `MOVE_TOGETHER`.
- `server/checks/attacks/nudge.ts` (hai ca): A làm tổ trưởng tổ đội riêng gọi `nudge_send` tới `DECOY_1` và `DECOY_2` (lần sau dùng chính id của lời nhắc mồi nhử làm action id) → `NUDGE_NOT_SAME_GUILD`, không dòng nào được ghi hay đổi (sự kiện, thông báo của mồi nhử); `app_auth` đọc/xóa `nudge_events`, sửa `nudge_templates` → `permission denied for table`; gọi `job_reminder_dispatch`, `app._nudge_block_reason` → `permission denied for function`. Điều kiện cùng tổ đội có ở hai nơi (câu khóa và lý do từ chối): bỏ một nơi thì nơi kia vẫn chặn; bỏ cả hai thì ca tấn công đỏ.
- `server/src/routes/nudge.test.ts` (đồng hồ test; người gửi và người nhận ở múi giờ khác nhau khi điều đó quan trọng): đường đúng (sự kiện, một mục `NUDGE` với câu mẫu, `senderRemainingToday` 2, khóa tự do bị bỏ qua); từng lỗi với đúng mã và mã HTTP, không ghi dòng nào; khung giờ: London 11:59 và Tokyo 20:00 bị từ chối trong khi người gửi đang 18:59 / 18:00, London 12:00 và Tokyo 19:59 được, London 14:00 được dù người gửi đang 21:00; **từng cặp kề nhau của thứ tự lỗi** (gồm `ONBOARDING_REQUIRED` và `VALIDATION_FAILED` của route, `NUDGE_TEMPLATE_UNKNOWN`, và thứ tự trong SQL cho người chưa onboarding); 5 người cùng nhắc một người → đúng 1 thành công, 4 `NUDGE_RECEIVER_LIMIT`; một người nhắc 5 người cùng lúc → đúng 3; gửi lại cùng khóa; người gửi ở Los Angeles bị giới hạn tới 03:00 giờ của họ rồi được lại, ngày hôm sau người nhận cũng được lại; `GET /guilds/me` hiện đúng lý do mà `nudge_send` raise cho từng thành viên (kể cả `NUDGE_SENDER_LIMIT`), dòng của mình `{allowed: false, reason: null}`; giới hạn 10/phút → request thứ 11 `429`; `guild_overview` của `52-nudge.sql` trả đúng như bản của `50-guild.sql` trừ trường `nudge` (bản cũ được tạo lại trong `pg_temp` từ chính file `50-guild.sql`).
- **Cuộc đua** (hai pool `app_conn`, một transaction của owner giữ khóa để ép một thứ tự): A nhắc B trong khi B nhắc A, cả hai đã qua khóa `users` và đang chờ `progression_state` → cả hai thành công, không deadlock (với thứ tự khóa "người gửi trước, người nhận sau" test này đỏ vì deadlock), cộng 5 vòng tự do; người nhận rời tổ đội trong lúc lời nhắc chờ → `NUDGE_NOT_SAME_GUILD`, ngược lại việc rời chờ rồi thành công; người nhận chuyển tổ trưởng trong lúc lời nhắc chờ → cả hai thành công; người nhận vào tổ đội ngay sau khi lời nhắc đã khóa → `NUDGE_NOT_SAME_GUILD`; lời nhắc và `job_apply_guild_week` theo cả hai thứ tự, và trường hợp job chờ dòng `users` của người nhận mà lời nhắc đang giữ → không deadlock, mọi người được thưởng, lời nhắc được gửi.
- `server/src/jobs/reminderDispatch.test.ts`: bật + trong khung + STORY chưa xong → 1 mục `{}` với khóa là ngày logic; chạy lại → 0; ngoài khung → 0; STORY đã xong, tắt nhắc, tài khoản đã xóa → 0 trong khi người đối chứng được nhắc; ba khung ở hai mép (đầu tính, cuối không tính); người ở `America/New_York` chọn `EVENING` được nhắc lúc 18:00 giờ New York, không phải 18:00 giờ Hồ Chí Minh; job đến hạn mỗi phần tư giờ.

### Phần ba cổng không nhìn thấy

- Thứ tự khóa, việc tính lý do sau khóa và trường hợp người nhận vào tổ đội giữa chừng do test cuộc đua giữ; cổng 1 và 3 không đọc thân hàm.
- `progression_state FOR UPDATE` của người gửi là yêu cầu của bản đặc tả; khóa dòng `users` của người gửi (lấy trước nó) đã tuần tự hóa các lời nhắc của một người.

Sửa `52-nudge.sql` thì chạy `npm run server:test` và `npm run db:api-check`; sửa `guild_overview` ở một trong hai file thì sửa cả file kia.

## Nhật ký và vé đóng băng (`60-journal.sql`, `journalCrypto.ts`, `routes/journal.ts`, `routes/tickets.ts`, `readModels/tickets.ts`, `jobs/ticketGrant.ts`, `seed/quotes.ts`)

Nhật ký riêng tư, mã hóa ở tầng ứng dụng, đáp lại bằng một câu trích dẫn; dòng đầu tiên của một ngày logic được +15 XP; mỗi tuần tối đa một vé đóng băng; vé giữ chuỗi cho hôm nay, hoặc cứu ngày hôm qua đã gãy cho tới 15:00 giờ địa phương (F-08, F-13, R-D04, AR-09, AR-10, §10.1). Hợp đồng: `JournalCreateRequest`, `JournalCreateResult`, `JournalList`, `JournalEntry`, `Tickets`, `TicketUseRequest` trong `docs/api/openapi.yaml`.

### Mã hóa và `JOURNAL_KEY`

- AES-256-GCM trong tiến trình Node (`server/src/journalCrypto.ts`): `encryptJournal(key, userId, entryId, text)`, `decryptJournal(key, userId, entryId, blob)`. Khóa là `ctx.journalKey` = `JOURNAL_KEY` (32 byte, base64 44 ký tự). IV ngẫu nhiên 12 byte cho mỗi dòng; dữ liệu xác thực kèm theo (AAD) là `"<userId>:<entryId>"`, nên một blob chép sang dòng khác hay người khác **không giải mã được**. Blob lưu = byte phiên bản `0x01` ‖ IV ‖ bản mã ‖ tag 16 byte.
- **Cơ sở dữ liệu không bao giờ thấy chữ**: SQL chỉ nhận blob (`bytea`), nên không hàm, log, chỉ mục hay lỗi nào của PostgreSQL có thể chứa nó. `journal_entries` không có chỉ mục nào trên nội dung (chỉ khóa chính và `(user_id, created_at desc, id desc)`).
- Chữ không bao giờ vào dòng log, thông báo lỗi, bảng `idempotency_keys` (câu trả lời của `POST /journal` không lặp lại chữ; `request_hash` là HMAC, xem mục Idempotency) hay chỉ mục. Giải mã thất bại → log một dòng `{evt: 'journal_decrypt_failed', entryId}`, chỉ có id; `GET /journal/{id}` của dòng đó → `500 INTERNAL`; `GET /journal` **bỏ dòng đó khỏi trang** và trả các dòng khác (`preview` của hợp đồng là chuỗi; `nextBefore` vẫn tính trên các dòng đã đọc nên phân trang không vỡ).
- `JOURNAL_KEY`: `config.ts` từ chối khởi động khi thiếu hoặc không đúng 32 byte, thông báo chỉ nêu tên biến, không in giá trị; khóa đã viết trong repo (khóa dev của `scripts/dev.ts`, khóa test của `test/http.ts`) chỉ được nhận khi `NODE_ENV` đúng là `development` hoặc `test` (production, staging, không đặt → từ chối khởi động); `server:dev` dùng khóa cố định của máy phát triển khi môi trường không đặt; test dùng `TEST_JOURNAL_KEY` của `test/http.ts`. **Mất hoặc đổi khóa = mọi dòng nhật ký cũ không đọc được** (`500`), và mọi câu trả lời idempotency đã lưu không còn khớp. Chưa có công cụ xoay khóa (ngoài phạm vi).

### Bảng

| Bảng | Lớp | Ghi chú |
|---|---|---|
| `quotes` | `content` (đọc) | khóa `code`, `text`, `author` (null); seed từ `server/content/quotes.ts` theo `code`, không bao giờ xóa |
| `journal_entries` | `own_read` | khóa `id` = action id; `body_encrypted bytea` (CHECK: 30–20029 byte, byte đầu `0x01`), `quote_code` (khóa ngoại về `quotes`), `logical_date`; chỉ mục `(user_id, created_at desc, id desc)`, không chỉ mục nội dung |
| `freeze_tickets`, `ticket_grant_weeks` | `own_read` | của `32-dayclose.sql` (xem mục đóng ngày) |

### Hàm

| Hàm | Vai trò | Việc |
|---|---|---|
| `app._ticket_cap(user)` | nội bộ | 2, hoặc 3 khi có đặc quyền `TICKET_CAP_PLUS` (`TICKET_CAP`). |
| `app._ticket_grant_check(user, week_start)` → text | nội bộ | Tuần đã có dòng `ticket_grant_weeks` → `ALREADY_DECIDED`; vé chưa dùng ≥ trần → ghi `granted = false` → `AT_CAP` (tuần đó mất vé, kể cả khi sau đó dùng bớt vé); ngược lại thêm vé của tuần và `granted = true` → `GRANTED`. Quyết định ghi bằng `INSERT … ON CONFLICT DO NOTHING` trên khóa chính `(user_id, week_start)`: hàng rào cuối, cả khi job đọc danh sách trước khi khóa. Dòng quyết định mất mà vé của tuần còn (sửa tay) → vé đó tính là đã cấp, không thêm vé thứ hai. |
| `app._ticket_dates(user)` → (day, target) | nội bộ | **Nguồn duy nhất của cửa sổ ngày**: TODAY (ngày logic hiện tại) luôn có; YESTERDAY khi giờ địa phương thuộc `[3, 15)`. `ticket_use` (qua `app._ticket_block_reason`) và `ticket_overview` cùng đọc nó. |
| `app._ticket_needed(user, date)` → bool | nội bộ | Ngày **còn mở** (sau `last_closed_date`, từ ngày đầu): nhiệm vụ STORY của ngày đó chưa xong hết (`daily_logs.story_completed`) **và** chuỗi mà vé sẽ giữ > 0 — chuỗi **sau khi** `day-close` đóng các ngày còn mở trước ngày đó (`closeDays` trên `app._close_days`, đúng dữ liệu `day-close` đọc): đi lùi từ ngày trước đó, ngày đầu tiên không đóng băng quyết định (xong → > 0, lỡ → 0); không có ngày nào như vậy → `streak_current > 0`. Nên vé TODAY khi hôm qua còn mở và sắp gãy là `TICKET_NOT_NEEDED` (nó chỉ đóng băng chuỗi 0). Ngày **đã đóng**: `break_date = date` và `streak_before_break` khác null. |
| `app._ticket_block_reason(user, date)` → text | nội bộ | Gặp điều nào trước thì trả điều đó: `TICKET_DATE_NOT_ELIGIBLE` (không thuộc `app._ticket_dates`) → `TICKET_ALREADY_USED_FOR_DATE` → `NO_TICKET` → `TICKET_NOT_NEEDED` (`app._ticket_needed`); `NULL` = được dùng. |
| `journal_create(p_id, p_body_encrypted)` → jsonb | `app_auth` | Thứ tự: `ONBOARDING_REQUIRED` → khóa (`app._lock_progression`: dòng `users` rồi `progression_state`) → câu trích dẫn: ngẫu nhiên trong những câu người gọi **chưa nhận trong 30 ngày qua**, nếu đã nhận hết thì câu nhận lâu nhất → chèn dòng (id đã là một dòng → `IDEMPOTENCY_KEY_REUSED`) → `app._grant(caller, 15, 0, 'JOURNAL', '<ngày logic>')` (AR-34: chỉ dòng đầu của ngày được trả) → `app._ticket_grant_check(caller, app.week_start(<ngày logic>))`. Trả `{entry, quote, grant, ticket: {outcome, available, cap}}`. |
| `ticket_use(p_date, p_action_id)` | `app_auth` | Thứ tự: `ONBOARDING_REQUIRED` → khóa (như trên) → lý do của `app._ticket_block_reason` (raise). Vé chưa dùng **cũ nhất** nhận `used_at`, `used_for_date` (khóa duy nhất của ngày là hàng rào cuối → `TICKET_ALREADY_USED_FOR_DATE`). Ngày đã đóng: cứu chuỗi (`rescueWithTicket`): `streak_current = streak_before_break`, xóa hai trường gãy, `missed_run = greatest(0, missed_run − 1)`, `last_outcome = 'FROZEN'`; `streak_best` không đổi. Ngày còn mở: để `day-close` đọc vé (AR-10: vé + STORY xong hết → vẫn `COMPLETED`, vé vẫn mất). |
| `ticket_overview()` → jsonb | `app_auth` | Màn hình của `GET /freeze-tickets`: `available`, `cap`, trạng thái chuỗi, và `eligible` (`app._ticket_dates`) với `open`, `before` (`app._close_days` của các ngày còn mở trước ngày đó), `deadline` (15:00 địa phương của ngày sau ngày đó, tính trong SQL bằng múi giờ của người dùng), `needed` = `app._ticket_needed`, `alreadyUsed`. |
| `job_ticket_grant(p_now)` → int | `app_job` | Lưới an toàn: với mỗi người đã onboarding, chưa xóa, có dòng nhật ký trong tuần của ngày logic của họ tại `p_now` mà tuần đó chưa có quyết định: khóa dòng `users` (`FOR NO KEY UPDATE`) rồi `progression_state`, theo id, rồi `app._ticket_grant_check`. Trả số tuần đã quyết định; bình thường là 0. |

**Một luật, hai nơi đọc.** `ticket_use` raise đúng điều `app._ticket_block_reason` trả; `ticket_overview` hiện `needed` từ chính `app._ticket_needed` mà lý do đó dùng. Vì vậy màn hình và hàm không thể bất đồng: `needed` của một ngày đủ điều kiện là `true` đúng khi một lần dùng (có vé, ngày chưa dùng vé) sẽ thành công (test so trên từng fixture). Ngày hôm qua **còn mở** (từ 03:00 tới khi `day-close` chạy) được xem như ngày đang mở: số xem trước của một ngày còn mở lấy `ticketPreview(closeDays(state, before).state, 'TODAY')`, cùng phép chiếu mà `app._ticket_needed` làm; ngày đã đóng lấy `ticketPreview(state, 'YESTERDAY')`.

**Thứ tự khóa** (thứ tự chung của mã nguồn): dòng `users` của người gọi, rồi `progression_state`, không khóa gì của người khác. `job_apply_day_close` cũng khóa dòng `users` trước và đọc lại các ngày (kể cả vé) dưới khóa đó: vé dùng cho hôm qua lúc 03:05 mà job đã đọc danh sách lúc 03:04 → lần áp dụng thấy ngày đã đổi, không áp dụng gì, đọc lại và đóng ngày thành `FROZEN`. Job đóng trước → ngày `MISSED`, gãy chuỗi; vé tới sau là một lần cứu. Kết quả như nhau.

### Năm route và job

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `POST /journal` | `user`, idempotent (khóa = id của dòng), **10 lần/phút mỗi tài khoản** (AR-21) | `200 JournalCreateResult` (không lặp lại chữ) | `422 VALIDATION_FAILED` (`body` / `required`, `format`: chuỗi, `min`, `max`: sau khi cắt khoảng trắng hai đầu, 1–5000 **ký tự** đếm theo code point) |
| `GET /journal?limit=&before=` | `user` | `200 JournalList`, mới nhất trước, `limit` 1–50 (mặc định 20), `preview` = 80 ký tự đầu của chữ đã giải mã, `nextBefore` = id của dòng cuối trang | `422` (`limit` / `format`, `min`, `max`; `before` / `format`: UUID) |
| `GET /journal/{id}` | `user` | `200 JournalEntry` | `422` (`id` / `format`), `404 NOT_FOUND` (không có, hoặc của người khác: không phân biệt) |
| `GET /freeze-tickets` | `user` | `200 Tickets` | – |
| `POST /freeze-tickets/use` | `user`, idempotent | `200 Tickets` | `422 VALIDATION_FAILED` (`date` / `required`, `format`), `409 TICKET_DATE_NOT_ELIGIBLE`, `409 TICKET_ALREADY_USED_FOR_DATE`, `409 NO_TICKET`, `409 TICKET_NOT_NEEDED` |

- Thứ tự lỗi `POST /journal`: `401` → `400 IDEMPOTENCY_KEY_REQUIRED` → `409 ONBOARDING_REQUIRED` → `422` → lỗi của `journal_create`. `POST /freeze-tickets/use`: `401` → `400` → `409 ONBOARDING_REQUIRED` → `422` → thứ tự của `app._ticket_block_reason`.
- Con trỏ trang là id của dòng cuối, so theo `(created_at, id)`: hai dòng cùng `created_at` (đồng hồ test đứng yên) không bao giờ rơi cùng phía của một trang.
- Gửi lại cùng khóa `POST /freeze-tickets/use` → cùng câu trả lời, chỉ tốn một vé.
- Job `ticket-grant` (`jobs/ticketGrant.ts`) đến hạn mỗi giờ từ phút 20 và gọi `job_ticket_grant(now)`; kết quả `{decided}` ghi vào `job_runs`.

### Mồi nhử, ca tấn công, test

- `89-decoy-journal.sql`: một dòng nhật ký của `DECOY_1` với nội dung là byte ngẫu nhiên theo đúng bố cục và câu trích dẫn đã seed `Q001`. (Vé và tuần của mồi nhử ở `83-decoy-dayclose.sql`.)
- `server/checks/attacks/journal.ts` (ba ca): `GET /journal/{id của dòng mồi nhử}` qua HTTP thật → `404`, danh sách rỗng; `app_auth` `SELECT` trên `journal_entries` không thấy dòng mồi nhử, `UPDATE`/`DELETE` → `permission denied for table`; `journal_create` với id của dòng mồi nhử → `IDEMPOTENCY_KEY_REUSED`, mồi nhử không đổi; `INSERT`/`UPDATE`/`DELETE` trên `freeze_tickets`, `ticket_grant_weeks`, `quotes` → `permission denied for table`; gọi `job_ticket_grant` và bốn hàm nội bộ → `permission denied for function`.
- `server/src/journalCrypto.test.ts`: khứ hồi, bố cục, IV mới mỗi lần; đổi người, đổi dòng, đổi khóa, lật một byte, đổi phiên bản → lỗi với thông báo cố định.
- `server/src/routes/journal.test.ts`: khứ hồi qua HTTP (tiếng Việt có dấu và emoji), `preview` 80 ký tự; byte lưu không chứa chữ UTF-8; tráo blob của hai người → `500` và dòng log chỉ có id; lật một byte → `500`; một blob hỏng giữa ba dòng → `GET /journal` bỏ nó, trả hai dòng kia, con trỏ vẫn đúng, `GET /journal/{id}` của nó → `500`; **câu canh gác** không có trong log nào (kể cả của một `422`, một `429` và một lần giải mã thất bại), không trong `idempotency_keys.response`, không trong byte lưu, không chỉ mục nào trên nội dung; XP: +15, 0 cùng ngày, 0 lúc 02:59 hôm sau, +15 từ 03:00; vé tuần: `GRANTED`, `ALREADY_DECIDED`, Chủ nhật 02:00 và thứ Hai 02:00 vẫn thuộc tuần cũ, thứ Hai 03:00 `GRANTED`, `AT_CAP` và vẫn mất sau khi dùng một vé, `TICKET_CAP_PLUS` → trần 3; lỗi và thứ tự lỗi (5000 emoji được, 5001 không); trang và con trỏ; quyền riêng tư của `GET /guilds/me` (lặp lại phép quét của Task 39, thêm câu canh gác nhật ký); hai dòng song song của một ngày mới → +15 một lần, một quyết định vé.
- `server/src/routes/journal.quote.test.ts` (cơ sở dữ liệu riêng, kho câu còn 3 kể cả `Q001` của mồi nhử): ba dòng → ba câu khác nhau; dòng thứ tư → câu nhận lâu nhất; 31 ngày sau chỉ câu đã quá 30 ngày được chọn; giữa hai câu cùng tự do thì chọn ngẫu nhiên (cả hai đều xuất hiện).
- `server/src/routes/tickets.test.ts`: giữ hôm nay (chuỗi 4) và `day-close` sau đó → chuỗi 4, `FROZEN`; `TICKET_NOT_NEEDED` khi chuỗi 0 hoặc STORY đã xong; cứu lúc 09:00 sau khi gãy chuỗi 5 → đúng `rescueWithTicket`; 14:59 được, 15:00 và 02:59 không, hôm kia và ngày mai không; mỗi ngày một vé, vé cũ nhất đi trước, gửi lại cùng khóa tốn một vé; **từng cặp kề nhau** của thứ tự lỗi và lỗi của route; `GET /freeze-tickets` so với `ticketPreview` và với một lần dùng thử (rollback) trên sáu fixture, hạn chót 15:00, `needed` hôm nay thành `false` khi STORY xong và lần dùng khi đó nhận `TICKET_NOT_NEEDED`; vé cho hôm qua lúc 03:05 được `day-close` tôn trọng; mép cửa sổ (02:59, 03:00, 14:59, 15:00): màn hình có YESTERDAY đúng khi hàm cho ngày đó qua; TODAY khi hôm qua còn mở và sắp gãy → `TICKET_NOT_NEEDED`, sau khi hôm qua có vé → cần (chuỗi giữ 3, cả hai ngày `FROZEN`), hôm qua đã xong mà chưa đóng → TODAY cần, giữ 1; **cuộc đua** (khóa của owner ép thứ tự): hai lần dùng một vé → một thành công; dùng vé cho hôm qua và `day-close` của hôm qua theo cả hai thứ tự khóa và 5 vòng tự do → luôn `FROZEN`, chuỗi giữ nguyên.
- `server/src/jobs/ticketGrant.test.ts`: không có việc → 0; sau khi xóa quyết định của tuần → tạo lại một lần, lần sau 0; tuần theo ngày logic; `journal_create` và job cho cùng người, cùng tuần theo cả hai thứ tự và vòng tự do → đúng một quyết định, một vé; đến hạn mỗi giờ từ phút 20.
- Kịch bản `ticket`: xem "Kịch bản phát triển".

### Phần ba cổng không nhìn thấy

- Không một cổng nào đọc được chữ của nhật ký (nó không bao giờ tới cơ sở dữ liệu); việc chữ không lọt vào log hay bảng idempotency do test câu canh gác giữ.
- Thứ tự khóa và việc lý do từ chối được tính sau khóa do các test cuộc đua giữ; cổng 1 và 3 không đọc thân hàm. Khóa chính của `ticket_grant_weeks` (cùng `ON CONFLICT`) là hàng rào thứ hai sau khóa dòng `users`.

Sửa `60-journal.sql` thì chạy `npm run server:test` và `npm run db:api-check`.

## Quyền riêng tư: xuất dữ liệu, xóa tài khoản, dọn dẹp (`61-privacy.sql`, `routes/privacy.ts`, `readModels/export.ts`, `jobs/housekeeping.ts`)

Spec §10 (R-P.2, R-P.3), AR-08, AR-30. Không có bảng mới.

### Hàm

| Hàm | EXECUTE | Bảo đảm |
|---|---|---|
| `account_salt()` → bytea | `app_auth` | Salt của chính người gọi (route `/me/delete` chạy bằng `app_auth`, không gọi được `auth_salt`). |
| `account_delete(p_key)` → boolean | `app_auth` | Không có tham số người dùng: luôn là người gọi. Thứ tự: khóa advisory `auth:<email>` (như `auth_login`, `auth_reset_*`) → đếm một lần vào `login:<email>` (cùng bộ đếm của đăng nhập: từ lần thứ sáu trong 15 phút luôn `false`, kể cả mật khẩu đúng) → so khóa trong DB (không khóa dòng: mọi hàm auth của email đó đợi khóa advisory). Sai → `false`, không đổi gì ngoài lần đếm. Đúng → thu hồi mọi phiên (trước khi đụng tới dòng `users`), `deleted_at = app.now()`, `purge_after` = 30 ngày sau, dùng hết mã đặt lại, xóa khỏi hộp thư của người nhận mọi thông báo `NUDGE` do người này gửi (khóa chống trùng của `NUDGE` là id sự kiện; payload có `senderName`, tên không được sống lâu hơn việc xóa), rời tổ đội (`app._guild_depart`). Email vẫn bị giữ tới khi xóa cứng. |
| `export_nudges()` → jsonb | `app_auth` | `[{direction: SENT\|RECEIVED, templateCode, sentAt}]` của người gọi, không có danh tính người kia (`nudge_events` là `internal`). |
| `job_account_purge(p_now)` → int | `app_job` | Xóa cứng người có `purge_after ≤ p_now`, không bao giờ là mồi nhử (`@decoy.invalid`); mọi bảng dữ liệu người dùng xóa lan từ `users`. Tối đa **50 người mỗi lần gọi** (một câu lệnh phải xong trong `statement_timeout` 10 s của pool; job gọi lại tới khi trả 0). Khóa dòng `users` `FOR UPDATE SKIP LOCKED` rồi tổ đội `FOR UPDATE SKIP LOCKED` (người đang bận, hoặc tổ đội đang bị giữ, được xóa ở lần chạy sau; không bao giờ đợi khóa), rời tổ đội trước. Sau đó sửa tổ đội bị bỏ lại bằng đường khác (xóa tay): không có trưởng nhóm → thành viên còn sống vào sớm nhất làm `LEADER`; không còn ai → xóa tổ đội. |
| `job_purge_idempotency(p_now)` → int | `app_job` | Xóa khóa idempotency tạo từ 7 ngày trước trở lên (kể cả câu trả lời đã lưu, ví dụ của `POST /me/biometrics`), trừ của mồi nhử. |
| `job_purge_auth(p_now)` → int | `app_job` | Xóa phiên hết hạn hoặc đã thu hồi, mã đặt lại hết hạn, dòng `auth_throttle` có cửa sổ bắt đầu từ 1 giờ trước trở lên; trừ của mồi nhử. (Không có trong kế hoạch; xem báo cáo Task 46.) |

Nội bộ (không role nào EXECUTE): `app._is_decoy(user)`, `app._guild_depart(user)` (AR-30: thành viên → xóa dòng; trưởng nhóm → giao cho thành viên còn sống có `joined_at` sớm nhất rồi xóa dòng của mình; trưởng nhóm một mình → xóa tổ đội).

**Thứ tự khóa.** `account_delete`: advisory của email → các dòng `sessions` của người gọi → dòng `users` → `guilds` (`FOR UPDATE`) → `guild_memberships`. Phiên trước `users` vì mọi request làm vậy: `auth_session` trượt hạn (khóa dòng) phiên của nó trước khi handler khóa dòng `users`; thứ tự ngược lại gây deadlock (`40P01`, trả `500`) với một request của thiết bị khác vào ngày phiên đó trượt hạn (có test). Purge: dòng `users` → tổ đội → thành viên, đều `SKIP LOCKED`.

**Chỉ mục cho việc xóa lan.** Mọi khóa ngoại mà việc xóa cứng kích hoạt (bảng cha không phải `content`) có một chỉ mục bắt đầu bằng đúng các cột của khóa: `(user_id, daily_log_id)` trên `quest_completions`, `quest_ticks`, `nutrition_logs`, `workout_sessions` (phủ cả khóa tới `users` lẫn khóa ghép tới `daily_logs`), `daily_meal_plans (logged_action_id)`. Không có chúng, mỗi người bị xóa (và mỗi `nutrition_logs` bị xóa) quét cả bảng. Một test catalog giữ quy tắc này cho bảng thêm sau.

**Người đã xóa mềm** không còn là ai với mọi hàm: đăng nhập, phiên, khóa của mọi lệnh ghi, mọi job (`day-close`, `reminder-dispatch`, `ticket-grant`, đầu vào bảng xếp hạng) đều lọc `deleted_at IS NULL`. `app._nudge_block_reason` (`52-nudge.sql`) coi người đã xóa (gửi hoặc nhận) là không ở tổ đội nào: `NOT_IN_GUILD` / `NUDGE_NOT_SAME_GUILD`.

### Route và job

| Route | Auth | Thành công | Lỗi riêng |
|---|---|---|---|
| `GET /me/export` | `user`, **5 lần/giờ mỗi tài khoản** | `200 ExportDocument`: `data` theo tên bảng cho mọi bảng `own_read`/`own_rw` (trừ `idempotency_keys`, vốn là `internal`), `inventory`/`perk_unlocks` kèm `itemCode`, `itemName`; `guild_memberships` kèm `guildName`; `journal_entries` kèm `text` đã giải mã (không có `body_encrypted`); thông báo `NUDGE` bỏ `senderName`; `nudge_events` = `export_nudges()` | – |
| `POST /me/delete` | `session`, idempotent, 10 lần/phút | `204` | `422 VALIDATION_FAILED` (`password` / `required`, `format`, `max`), `401 INVALID_CREDENTIALS` (trả về chứ không ném: lần đếm được commit) |

- Mật khẩu qua `normalizePassword` (NFC) như lúc đăng ký và đăng nhập.
- `prepare` giờ dùng được trên route có phiên (`app.ts`): phiên được tra trong một giao dịch riêng **trước** `prepare`, giới hạn theo tài khoản được tính ở đó (một lần), token lạ hoặc phiên đã thu hồi → `401` mà không tốn lần scrypt nào; giao dịch của request tra phiên lại.
- `prepare` của `/me/delete`: `account_salt()` trả null (tài khoản vừa bị xóa bởi một request song song, sau khi phiên đã được tra) → `401 SESSION_INVALID`, không phải `500`.
- Job `housekeeping`: đến hạn mỗi ngày từ 04:00 `Asia/Ho_Chi_Minh`, gọi ba hàm dọn dẹp, mỗi hàm một giao dịch (purge tài khoản: lặp tới khi trả 0); `{accounts, idempotencyKeys, authRows}` ghi vào `job_runs`. Ba bước chạy độc lập: bước hỏng được ghi log (`housekeeping_step`) với lỗi của nó, hai bước kia vẫn chạy và commit, rồi lần chạy được ghi là hỏng (`ok = false`).

### Ca tấn công, test

- `server/checks/attacks/privacy.ts`: `account_delete` của A với khóa sai và với chính khóa của mồi nhử → `false`, không ai bị xóa; ba hàm của `app_auth` không có tham số người dùng (đọc từ catalog); `app_auth` gọi ba job và hai hàm nội bộ → `permission denied for function`, `DELETE FROM users` → `permission denied for table users`; `app_anon` gọi `account_delete` → bị từ chối; chạy cả ba job với `p_now` năm 2999 (mồi nhử còn được gắn `purge_after` đã qua) → mọi dòng mồi nhử y nguyên, một người thật tới hạn thì bị xóa.
- `server/src/routes/privacy.test.ts`: xuất dữ liệu có khóa và dòng cho mọi bảng `own_*` của registry, chữ nhật ký, không tên/không id của đồng đội, không trường bí mật; lần xuất thứ sáu trong giờ → `429`; xóa với mật khẩu sai → `401`, không đổi gì; lần thứ sáu bị khóa như đăng nhập; NFC; xóa đúng → `204`, đăng nhập thất bại giống hệt email lạ, token cũ `401`, đăng ký lại → `REGISTRATION_UNAVAILABLE`, đồng đội không còn thấy; trưởng nhóm bị xóa → người vào sớm nhất làm trưởng nhóm, một mình → tổ đội biến mất; nudge tới/từ người đã xóa; chạy mọi job sau khi xóa → mọi dòng của người đã xóa không đổi, còn người "sinh đôi" được xử lý.
- `server/src/jobs/housekeeping.test.ts`: kiểm tra xóa lan **suy ra từ catalog** (mọi khóa ngoại tới `users`, cột tên gì cũng vậy, là `ON DELETE CASCADE`; mọi khóa vào một bảng dữ liệu người dùng xóa lan, trừ danh sách ngoại lệ `daily_meal_plans.logged_action_id`; mọi bảng của chuỗi khóa có một đường xóa lan); mọi khóa mà purge kích hoạt có chỉ mục bắt đầu bằng cột của nó; purge tối đa 50 người mỗi lần, job gọi tới hết; một bước hỏng không chặn hai bước kia; +29 ngày → 0, +30 ngày → xóa, không còn dòng nào trỏ tới người đó (kể cả bữa ăn kế hoạch đã ghi, mà `logged_action_id` là `NO ACTION`), lần sau → 0, mồi nhử còn, email đăng ký lại được, tổ đội bị bỏ lại được sửa; khóa 8 ngày bị xóa, 6 ngày còn; dọn phiên, mã, throttle; lịch 04:00.
- `server/src/routes/privacy.race.test.ts`: xóa và một lần tick của cùng người theo hai thứ tự ép bằng khóa và vòng tự do; xóa trưởng nhóm và một thành viên rời / người mới vào, hai thứ tự; purge và một lần đăng nhập, purge bỏ qua người đang bị khóa; xóa trên thiết bị A và tick trên thiết bị B đi qua `auth_session` vào ngày phiên B trượt hạn (không deadlock); purge không đợi tổ đội đang bị giữ.
- `privacy.test.ts` thêm: thông báo `NUDGE` người đã xóa gửi biến khỏi hộp thư người nhận; salt null → `401 SESSION_INVALID`; ca "không job nào xử lý tài khoản sau khi xóa" đặt người bị xóa vào một tổ đội có xếp hạng (bốn thành viên) để kiểm tra đầu vào bảng xếp hạng có nghĩa.

### Phần ba cổng không nhìn thấy

- Việc mọi bảng xóa lan, việc có chỉ mục cho mọi khóa của việc xóa lan, việc dữ liệu xuất không chứa người khác, và thứ tự khóa do test giữ, không do cổng 1 hay 3.

Sửa `61-privacy.sql` thì chạy `npm run server:test` và `npm run db:api-check`.

## Hiệu năng (`checks/perf.test.ts`, `npm run server:perf`)

NFR-01 (p95 của API < 300 ms; bảng xếp hạng < 500 ms, có cache) được **đo**, không giả định. Lệnh nằm ngoài `server:test` (mất khoảng 80 giây, nạp hơn hai triệu dòng) và chạy trên cụm test như các cổng khác, nên cũng chỉ chạy được một lệnh một lúc.

- **Bộ dữ liệu**, nạp bằng `admin` vào một bản sao của template (không đi qua hàm SQL: đây là dữ liệu, không phải luồng; luồng có test riêng) rồi `ANALYZE` (cơ sở dữ liệu đã dùng một thời gian có thống kê, autovacuum sẽ tạo chúng rất lâu trước người dùng thật đầu tiên): 2 000 người dùng đã onboarding cách đây 30 ngày (một phần mười ở New York, một phần mười ở Paris, còn lại ở Hồ Chí Minh; ba nguyên mẫu xen kẽ), 300 tổ đội 3–8 thành viên (1 650 người trong tổ đội, 350 người không), và 30 ngày `daily_logs` mỗi người (ngày hôm nay chưa có dòng nào), cùng tiến độ nhiệm vụ, tick, nhật ký ăn, buổi tập, sổ cái, hộp thư. Số dòng đã đo ở lần chạy cuối (nạp thêm / tổng trong bảng; phần chênh là các dòng mồi nhử của lược đồ):

| Bảng | Nạp thêm | Tổng |
|---|---:|---:|
| `users` | 2 000 | 2 002 |
| `daily_logs` | 60 000 | 60 001 |
| `quest_completions` | 220 927 | 220 928 |
| `quest_ticks` | 648 334 | 648 335 |
| `xp_ledger` | 179 888 | 179 889 |
| `coin_ledger` | 179 888 | 179 889 |
| `nutrition_logs` | 180 003 | 180 004 |
| `workout_sessions` | 60 000 | 60 001 |
| `notifications` | 10 000 | 10 001 |
| `guilds` | 300 | 301 |
| `guild_memberships` | 1 650 | 1 652 |

- **Phép đo**: qua HTTP thật (app thật, pool `app_conn`), 200 lần gọi tuần tự mỗi endpoint sau một lần khởi động. Các lệnh `GET` xoay vòng qua 200 thành viên tổ đội khác nhau (chặt hơn một người dùng duy nhất: mỗi request gặp dòng mà request trước không chạm); `POST /day/quests/WATER_8/progress` dùng 200 người dùng khác nhau chưa có dòng hôm nay (nên không bao giờ hoàn thành, nhiệm vụ cần 8 lần). Bảng xếp hạng được tính một lần ở lần khởi động và 200 request sau đó đọc từ cache: test đếm số lần đọc `job_guild_week_inputs` và đòi đúng một (giới hạn 500 ms một mình không chứng minh cache, vì tính bảng chỉ mất khoảng 200 ms).
- **Ngưỡng**: p95 `< 300 ms` (`< 500 ms` cho bảng xếp hạng). Vượt ngưỡng thì sửa nguyên nhân (chỉ mục, câu truy vấn) trong file SQL sở hữu nó, không bao giờ sửa ngưỡng. Lần đo đầu tiên đã dưới ngưỡng hàng chục lần nên **Task 51 không thêm chỉ mục nào**.
- **Hai job** được đo một lần, không có ngưỡng: `day-close` trên 2 000 người (mỗi người một ngày để đóng) và `weekly-rollover` (bốn tuần đã đóng, 300 tổ đội mỗi tuần, 6 600 lần trả thưởng). Số dòng sổ cái hai job tạo ra bằng số dòng log `evt:'ledger'` của chúng.

Lần chạy cuối (Windows, ngày 23/10/2026). Máy: AMD Ryzen 5 5600X 6 nhân (12 luồng), 31,9 GiB RAM, Windows 11 (10.0.26300), Node v24.8.0, PostgreSQL 18.4 (`embedded-postgres` 18.4.0-beta.17), server và cơ sở dữ liệu cùng một máy:

| Endpoint | p50 ms | p95 ms | max ms | lần đầu ms | giới hạn p95 |
|---|---:|---:|---:|---:|---|
| `GET /day` | 4,1 | 6,1 | 16,8 | 91,7 | < 300 ms |
| `POST /day/quests/WATER_8/progress` | 7,1 | 9,5 | 12,4 | 34,8 | < 300 ms |
| `GET /me` | 3,4 | 4,9 | 14,8 | 16,7 | < 300 ms |
| `GET /nutrition/plan` | 5,0 | 6,7 | 12,9 | 14,0 | < 300 ms |
| `GET /guilds/me` | 6,0 | 10,1 | 20,5 | 35,3 | < 300 ms |
| `GET /leaderboard?week=current` | 2,0 | 2,4 | 21,7 | 201,1 | < 500 ms |

`day-close` trên 2 000 người: 2,94 giây. `weekly-rollover`: 9,50 giây. Cột "lần đầu" là request đầu tiên của endpoint trong tiến trình (kế hoạch truy vấn, bộ nhớ đệm; với bảng xếp hạng là lần tính bảng). Đây là số của **một máy phát triển, không có mạng giữa máy khách và server**: thời gian trên điện thoại thêm thời gian mạng và của chính điện thoại (xem danh sách kiểm tra thiết bị).

Đổi một câu truy vấn của sáu endpoint trên, hay thêm bảng vào `buildDay`, thì chạy lại `npm run server:perf`.

## Quan trắc (`test/observability.test.ts`)

NFR-10: log có cấu trúc cho mọi bút toán sổ cái, và cảnh báo khi `day-close` không chạy đúng lịch. Cách ghi log (một dòng JSON mỗi request, `evt:'ledger'`, những gì không bao giờ được vào log) nằm ở "Log" trong "Tầng HTTP"; phần này nói test giữ những gì.

- **Một dòng `ledger` cho mỗi dòng sổ cái.** Test chạy luồng của lát cắt 1 (đăng ký, onboarding, ba ngày logic với tick nước, calo, buổi tập, `day-close` sau mỗi 03:00) cộng một lần hoàn tác tick, một dòng nhật ký, một lần mua đồ. Số dòng `xp_ledger` + `coin_ledger` mới tạo bằng số dòng log `evt:'ledger'` (log của app cộng log của job), và **tập các bộ (loại, người, số lượng, lý do, ref) trong log bằng tập các dòng sổ cái**, không chỉ cùng số đếm. Gửi lại mọi lượt ghi với đúng khóa cũ không thêm dòng sổ cái nào và không thêm dòng log nào. Với hai job: `perf.test.ts` đòi cùng đẳng thức cho `day-close` (thưởng mốc chuỗi) và `weekly-rollover` (thưởng tổ đội, 6 600 dòng).
- **Không giá trị cá nhân nào trong log.** Giá trị cài sẵn: email, mật khẩu, token, bản băm token (hex và base64url), mã đặt lại mật khẩu, chiều cao, cân nặng, năm sinh, calo của bữa ăn, mục tiêu calo, tên bữa ăn, câu nhật ký; chúng còn nằm trong đường dẫn, query và thông báo lỗi của các request thất bại (một route thử ném `Error` chứa mọi bí mật). Kiểm tra **có đối chứng**: với mỗi giá trị, (1) chứng minh nó có trong fixture (trong cơ sở dữ liệu, hoặc trong câu trả lời của server), (2) chứng minh bộ quét thấy nó trong một dòng log cố tình làm rò, (3) mới quét log thật và đòi không dòng nào có nó. Số được tìm như giá trị của một trường (trừ `ts`, `ms`, `status`), không như chuỗi con: "1987" là một mẩu của nhiều uuid.
- **`job_late`.** Với `day-close` thất bại ở mọi lần: không có cảnh báo ở phút 90, có đúng một dòng `{level:'alert', evt:'job_late', job:'day-close'}` ở phút 91; với `day-close` thành công ở mọi lần trong 25 giờ: không bao giờ. Lỗi của job được ghi không kèm thông báo của nó.
- Test được kiểm bằng đột biến (bỏ dòng ledger của đồng xu, ghi hai lần, đưa URL / header `Authorization` / thông báo lỗi / calo / câu nhật ký vào log, đổi ngưỡng 90 phút thành 80 hoặc 100, tính trễ từ lần chạy cuối thay vì lần thành công cuối): mọi đột biến đều làm test đỏ.

## Chỉ số sản phẩm (`scripts/metrics.sql`, `test/metrics.test.ts`)

Các tiêu chí thành công của đặc tả §12, tính từ cơ sở dữ liệu. Chạy **bằng chủ sở hữu cơ sở dữ liệu**, không qua ứng dụng (không vai trò nào của ứng dụng được đọc mọi người dùng):

```sh
psql "postgres://postgres:<mật khẩu superuser>@127.0.0.1:54330/hoimau" -f server/scripts/metrics.sql
```

Mỗi chỉ số là một câu lệnh, một dòng kết quả gồm `value` và `n` (tính trên bao nhiêu người). Không câu nào xuất một giá trị cá nhân: chỉ tỉ lệ (0–1), với M-04 là số trung vị, và số đếm.

| Mã | Đo | Mục tiêu (§12) |
|---|---|---|
| M-01 | người đã đăng ký và hoàn tất onboarding / người đã đăng ký | > 70 % |
| M-02 | D1: trong số người đã onboarding mà ngày thứ hai đã qua hẳn, tỉ lệ có dòng `daily_logs` đúng ngày sau `onboard_date` | > 40 % |
| M-03 | D7: như M-02, cho ngày thứ tám | > 20 % |
| M-04 | trung vị chuỗi hiện tại của người có `daily_logs` trong 7 ngày logic gần nhất | ≥ 4 |
| M-05 | người đã onboarding đang ở trong một tổ đội / người đã onboarding | > 35 % |
| M-07 | người đã onboarding có đơn kê hiện hành bị `safety_clamped` / người đã onboarding | theo dõi; > 15 % là có vấn đề |

- **M-06 (thời gian ghi nhận xong một ngày) không đo được từ server** và không có câu lệnh: nó cần thời gian giữa lúc mở app và lần ghi cuối trên điện thoại, tức là phân tích phía máy khách, thứ chưa được xây (R-P.4: công cụ phân tích chỉ nhận sự kiện ẩn danh, và chưa có công cụ nào được duyệt). Server thấy các lượt ghi, không thấy thời gian trên màn hình giữa chúng; đừng suy ra nó từ dấu thời gian.
- **Ai được tính**: tài khoản thật, còn sống. Tài khoản mồi nhử (`@decoy.invalid`) và tài khoản đã yêu cầu xóa (`deleted_at`) bị loại khỏi mọi câu.
- **Ngày là ngày logic của chính người đó** (`app.logical_date(app.now(), users.timezone)`, cùng hàm mà app dùng). Ngày chưa qua hẳn không bị tính là "không quay lại": D1 chỉ xét người có ngày thứ hai đã kết thúc, D7 người có ngày thứ tám đã kết thúc.
- **Không ai để đếm thì `value` là `NULL`, `n` là 0**, không phải 0: "chưa có ai" không phải "không ai quay lại".
- M-04 là một số trung vị: với một nhúm người dùng nó chính là chuỗi của một người. Đọc nó cùng `n`.
- Test: một cơ sở dữ liệu có sẵn người dùng cho từng loại trừ (hai mồi nhử có sẵn của lược đồ; một tài khoản đã xóa có số đẹp nhất ở mọi chỉ số; người quay lại ngày thứ ba thay vì thứ hai; người có ngày thứ hai là hôm nay; người có log ngày liền trước và liền sau ngày D7), đồng hồ đóng băng ở 10/03/2027, mỗi câu phải ra đúng con số của fixture (0,8; 0,6667; 0,4; 4; 0,375; 0,25) và đúng hai cột `value`, `n`; cơ sở dữ liệu rỗng cho `NULL` và 0; kết quả không chứa id, email hay tên. Mười đột biến của các câu SQL (bỏ loại mồi nhử / tài khoản xóa, `<=` thay cho `<`, ngày thứ 7 thành thứ 6, đổi mẫu số, đổi cột, cửa sổ 8 ngày, trả 0 thay NULL, thêm cột email) đều làm test đỏ.
