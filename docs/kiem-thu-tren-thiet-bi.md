# Kiểm thử trên thiết bị

Trạng thái: **Chưa thực hiện, chưa có thiết bị.** Máy phát triển không chạy được emulator và chưa có điện thoại nào được cắm (xem [quyết định 0002](decisions/0002-kiem-chung-khong-co-thiet-bi.md)). Mọi cột "Kết quả" bên dưới để trống cho tới khi có người chạy.

Tài liệu này gom mọi thứ chỉ một điện thoại hoặc emulator Android thật mới chứng minh được. Jest, bản xem trước trên trình duyệt, đầu-cuối HTTP và `assembleDebug` đã chạy xong và được ghi ở [Kiểm thử và phát hành](testing-and-release.md#hiện-trạng); chúng không thay được các mục dưới đây. iOS chưa build nên chỉ có một dòng ghi nhận (mục 14).

## Cách dùng

1. Làm hết phần **Chuẩn bị**.
2. Chạy từng khối theo thứ tự. Trước mỗi khối, áp kịch bản dữ liệu mẫu ghi ở đầu khối. Mọi kịch bản dùng chung một đồng hồ test: chạy kịch bản cần trình diễn **sau cùng**.
3. Điền cột **Kết quả** bằng `Đạt`, `Hỏng` hoặc `Bỏ qua`, kèm một câu mô tả khi `Hỏng`; điền **Máy · Android** (kiểu máy, phiên bản Android, emulator hay máy thật) và **Ngày · người kiểm**.
4. Với mỗi lỗi: ghi tệp sở hữu lỗi vào bảng cuối tài liệu, sửa ở đó, chạy lại test của tệp đó, rồi chạy lại mục này. Nếu sửa chạm `src/` hoặc `android/` thì dựng lại APK và cập nhật kích thước, SHA-256 và commit ở [Bản debug đã dựng](testing-and-release.md#bản-debug-đã-dựng).
5. Khi mọi dòng có kết quả: chép tóm tắt vào [Kiểm thử và phát hành](testing-and-release.md#hiện-trạng) và đổi trạng thái của [quyết định 0002](decisions/0002-kiem-chung-khong-co-thiet-bi.md).

Ký hiệu: S09, S19... là mã màn hình trong [phân tích màn hình](design/screen-map.md). "Cỡ chữ 2.0" là cỡ phông chữ lớn nhất cộng kích thước hiển thị lớn nhất trong Cài đặt Android; "360 dp" là máy hoặc AVD rộng 360 dp. "Giảm chuyển động" là tùy chọn "Xóa hoạt ảnh" (Remove animations) của Android. D-01 là quyết định trong [sổ quyết định](product/mobile-scope.md#sổ-quyết-định).

## Chuẩn bị

Các bước này chỉ người dùng máy làm được (BIOS, driver, cáp USB); không tự động hóa.

| # | Việc | Cách làm và dấu hiệu đúng | Xong |
|---|---|---|---|
| P1 | Bật ảo hóa trong BIOS (chỉ cho emulator) | Khởi động lại vào BIOS, bật **SVM Mode** (CPU AMD) hoặc **Intel VT-x**. Trong Windows, `systeminfo` dòng "Virtualization Enabled In Firmware" phải là `Yes`. Máy phát triển hiện báo `No`. | |
| P2 | Cài driver hypervisor (chỉ cho emulator) | PowerShell quyền Administrator: `& "$env:LOCALAPPDATA\Android\Sdk\extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat"`, hoặc bật tính năng Windows "Windows Hypervisor Platform". Kiểm tra: `& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -accel-check` thoát 0. Ảnh arm64 không chạy được trên máy x86: dùng ảnh x86_64. | |
| P3 | Hoặc: điện thoại thật | Bật Tùy chọn nhà phát triển và Gỡ lỗi USB, cắm cáp, chấp nhận hộp thoại "Cho phép gỡ lỗi USB" cho máy tính này. APK debug có đủ 4 ABI, arm64 chạy được. | |
| P4 | `adb` thấy thiết bị | `$env:Path += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"` rồi `adb devices`: thiết bị ở trạng thái `device` (không phải `unauthorized` hay `offline`). Với emulator: `& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd <tên AVD>` (liệt kê bằng `-list-avds`). | |
| P5 | Dựng APK | `cd android; .\gradlew.bat assembleDebug --console=plain` (thêm `-PreactNativeArchitectures=x86_64` cho emulator). Nếu từng build trước khi có module native `HoiMauNative`: xóa `android/app/.cxx` trước khi build. Xác nhận mã sinh có đủ module: `llvm-strings libappmodules.so \| grep -i HoiMau` trên tệp `.so` trong APK phải có kết quả; nếu không, chia sẻ tệp lùi về Share văn bản và giữ màn hình sáng không bao giờ bật. | |
| P6 | Server và dữ liệu mẫu | Terminal 1: `npm run server:dev`, đợi `API ready: http://127.0.0.1:8787/api/v1` và `curl http://127.0.0.1:8787/api/v1/healthz` trả 200. Terminal 2: `npm --prefix server run scenario -- list`, rồi `npm --prefix server run scenario -- fresh`. Tài khoản `demo-<tên>@hoimau.test`, mật khẩu `matkhau123`. | |
| P7 | Chuyển cổng | `npm run demo:reverse` (`adb reverse tcp:8787 tcp:8787` và `tcp:8081`); `adb reverse --list` có `tcp:8787`. Làm lại sau mỗi lần cắm lại thiết bị hoặc khởi động lại emulator. | |
| P8 | Metro và cài app | Terminal 3: `npm start`. Terminal 4: `adb install -r android\app\build\outputs\apk\debug\app-debug.apk` rồi mở app, hoặc `npm run android`. APK debug lấy JavaScript từ Metro nên Metro phải chạy và P7 phải xong. | |
| P9 | Khởi động nguội chuẩn | Trước mỗi mục nói "khởi động nguội": `adb shell am force-stop com.hoi_mau`, rồi mở lại từ launcher (hoặc `adb shell am start -W -n com.hoi_mau/.MainActivity`). | |
| P10 | Nhật ký lỗi | Một terminal riêng: `adb logcat "*:E" ReactNativeJS`. Giữ mở suốt buổi kiểm; ghi mọi lỗi đỏ không giải thích được vào cột kết quả của mục đang chạy. | |

Hết buổi: Ctrl+C ở `server:dev` và Metro, `npm --prefix server run scenario -- clock off`, `adb reverse --remove-all`, rồi `npm run db:cleanup` phải báo không còn gì.

## 1. Khởi động và font

Kịch bản: không cần (màn Chào mừng).

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 1.1 | Khởi động nguội (P9) khi chưa đăng nhập. | Hiện màn Chào mừng với font đóng gói: tiêu đề Be Vietnam Pro, thân chữ Inter (không phải Roboto), dấu tiếng Việt đúng. `adb logcat "*:E" ReactNativeJS` sạch. Android tìm font theo tên tệp (`BeVietnamPro_700Bold`, `Inter_400Regular`, `Inter_500Medium`, `Inter_600SemiBold`, `Inter_700Bold`). | | | |
| 1.2 | Nhãn thanh tab dưới (`navLabel` 11/14) với dấu chồng như "Ệ", ở cỡ chữ 1.0 và 1.3. | Không glyph nào bị cắt ở trên hoặc dưới nhãn. | | | |
| 1.3 | Ngày giờ trên Hermes: mở lịch sử ngày (S51) với một hành động ghi lúc 00:45 UTC, múi giờ `Asia/Ho_Chi_Minh`. | Hiện "07:45". Nếu động cơ thiếu dữ liệu múi giờ thì giờ bị bỏ chứ app không sập. Các phép tính nền (`logicalDateOf(Date.parse('2026-09-09T18:30:00Z'), 'Asia/Ho_Chi_Minh') === '2026-09-09'`; `localParts(Date.parse('2026-09-09T17:00:00Z'), 'Asia/Ho_Chi_Minh')` cho giờ 0 chứ không 24 và ngày `2026-09-10`; `normalizeVi('Đồ ĂN bẩn') === 'do an ban'`) mới chỉ được chứng minh trên V8, nên xác nhận qua các màn dùng chúng (ngày logic quanh 03:00 ở 11.1, tìm múi giờ ở 5.10, tìm kiếm tiếng Việt không dấu). | | | |
| 1.4 | Mở app khi chưa `adb reverse` (`adb reverse --remove-all`), đã đăng nhập từ trước. | Hiện trạng thái lỗi mạng, không sập. Làm lại P7 thì "Thử lại" vào được. | | | |
| 1.5 | Mở app với P7 đã làm, server đang chạy, đã đăng nhập. | Server in một dòng `GET /me`. HTTP thường tới `localhost` được bản debug cho phép. | | | |

## 2. Phiên đăng nhập

Kịch bản: `fresh` (đăng nhập `demo-fresh@hoimau.test`).

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 2.1 | Đăng nhập, tắt hẳn app (vuốt khỏi danh sách gần đây), mở lại. | Vào thẳng app với cùng người dùng (keychain thật). Không hộp thoại sinh trắc học. Không có gì về phiên trong AsyncStorage (`adb shell run-as com.hoi_mau`, bản debug, rồi xem thư mục `files` và `databases`). | | | |
| 2.2 | Đăng xuất, mở lại. | Hiện Chào mừng. Đăng xuất bình thường không để lại mật khẩu chung nào trong keychain. Khi keychain không đặt lại được, app ghi đè bằng chuỗi rỗng và lần khởi động sau coi là đã đăng xuất; react-native-keychain 10 trên Keystore có nhận mật khẩu rỗng không thì chưa biết: nếu ép được lỗi đặt lại, ghi lại việc token cũ có còn sống không (còn sống là lỗi). | | | |
| 2.3 | Đăng nhập, rồi vô hiệu hóa phiên phía server (xóa dòng phiên hoặc đổi mật khẩu từ nơi khác), thao tác bất kỳ. | Về màn Đăng nhập kèm thông báo phiên đã hết hạn; không còn tới được màn đã đăng nhập. | | | |
| 2.4 | Khởi động nguội, server dừng, đã có hồ sơ đệm. | Không chớp trắng trước màn tải; vào được app bằng hồ sơ đệm. Khi không có đệm: trạng thái lỗi với "Thử lại" và "Đăng xuất"; "Đăng xuất" chạy cả khi ngoại tuyến (có thể chờ tới 10 giây khi mạng nuốt gói thay vì báo lỗi). Khung xương hiện tối đa bằng thời gian yêu cầu. | | | |
| 2.5 | Tạm dừng server giữa chừng (đã `adb reverse`, dừng API khi một yêu cầu đang bay). | Sau khoảng 10 giây app báo hết thời gian chờ, "Thử lại" chạy được. Trên Hermes `AbortController` hoạt động và `newActionId()` ra chuỗi UUID v4 (server nhận làm `Idempotency-Key`). | | | |
| 2.6 | Đăng nhập (S02) và đăng ký (S03), xem log server. | `signIn` chạy đúng một lần sau câu trả lời tốt; bấm nút lần hai khi đang gửi không gửi thêm gì. S03 dẫn vào onboarding; S02 vào app chính (hoặc onboarding khi `onboarded` là false). | | | |
| 2.7 | Keychain lỗi sau khi server trả lời tốt (chỉ khi ép được). | Biểu mẫu giữ giá trị và hiện lỗi chung (S03: "Tài khoản đã được tạo nhưng chưa đăng nhập được…"); trên S02 bấm lại là đăng nhập được mà không gõ lại. Trên máy có keystore chạy tốt thì trường hợp này không xảy ra. | | | |
| 2.8 | Tab chưa có màn hình riêng (nếu còn) và "Đăng xuất" ở đó khi có bản ghi chờ. | Hỏi như bình thường; sau khi đăng nhập lại app mở ở Hôm nay; thông báo không bị đẩy lên bởi đệm đáy thứ hai trên thanh tab (nhỏ về thẩm mỹ). | | | |
| 2.9 | Hàng "Đăng xuất" ở tab Cá nhân (S31) khi có bản ghi chờ, bằng TalkBack. | Đọc "Đăng xuất, nút"; chạm đôi mở câu hỏi; "Ở lại" giữ phiên và hàng vẫn hoạt động. | | | |
| 2.10 | "Đăng xuất" ở bước đầu onboarding (S05). | Một chạm kết thúc phiên và về Chào mừng (cả khi ngoại tuyến); không giữ gì đã gõ cho lần đăng nhập sau; TalkBack tới được nó sau nút chính; nó không có ở S06, S07, S08, S61. | | | |

## 3. Hàng đợi ngoại tuyến và sang ngày

Kịch bản: `fresh`.

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 3.1 | Bật chế độ máy bay, chạm ô nước (S09) ba lần, `adb shell am force-stop com.hoi_mau`, mở lại khi vẫn ngoại tuyến. | Hàng phía trên app báo "Bạn đang ngoại tuyến" và "3 ghi nhận đang chờ gửi — đã lưu trên máy"; ba ô có dấu đồng hồ và "Đang chờ gửi". Bản ghi nằm ở khóa AsyncStorage `pending:v1:<userId>`, ghi trước mọi yêu cầu. | | | |
| 3.2 | Tắt chế độ máy bay, bấm "Thử lại". | Cả ba được gửi đúng một lần, theo thứ tự (server: ba lượt tick, không trùng; kiểm sổ cái); hàng báo "Đã đồng bộ" khoảng 4 giây rồi biến mất. Ô thành dấu tích, XP và xu cập nhật; KHÔNG có snackbar "Đã ghi nhận" và Mầm không nhảy. | | | |
| 3.3 | Khi còn bản ghi chờ, chuyển sang app khác, khôi phục mạng, quay lại. | Bản ghi được gửi mà không cần chạm gì. Không gửi gì khi app ở nền (không có tác vụ nền theo thiết kế); lần thử lại mỗi 30 giây không giữ máy thức. | | | |
| 3.4 | Ghi một bản ghi trước 03:00 giờ địa phương khi ngoại tuyến, rồi gửi sau khi ngày đã khép (qua 03:00; chỉnh đồng hồ server bằng kịch bản nếu cần). | Hiện thông báo "ngày đã khép lại"; bản ghi không bị mất âm thầm. | | | |
| 3.5 | Hàng ngoại tuyến (S38) và vùng an toàn phía trên: để hàng hiện rồi ẩn. | Chữ nằm dưới thanh trạng thái hoặc tai thỏ và màn bên dưới không có khoảng hở trên thứ hai; khi hàng hiện hoặc biến mất màn dịch đúng một lần bằng chiều cao hàng, không chớp; thanh tab, snackbar và nút dưới không bị che; ở cỡ chữ 2.0 và 360 dp dòng đếm xuống dòng và "Thử lại" còn nguyên, cao tối thiểu 48 dp. | | | |
| 3.6 | Hàng S38 với TalkBack. | TalkBack đọc "Bạn đang ngoại tuyến, 2 ghi nhận đang chờ gửi — đã lưu trên máy" khi hàng hiện và "Đã đồng bộ" khi gửi xong; chấm nhịp đập hai nhịp rồi đứng yên; với "Xóa hoạt ảnh" bật thì không bao giờ cử động. | | | |
| 3.7 | Hộp thoại ghi nhận bị từ chối ("Còn N ghi nhận chưa gửi") và câu hỏi khi đăng xuất. | Back là "Ở lại" (phiên và hàng đợi giữ nguyên); tiêu điểm TalkBack vào tiêu đề; hai nút đọc đủ ở cỡ chữ 2.0 (nhãn dài "Đăng xuất và bỏ các ghi nhận này" xuống dòng trong nút); khi cả hai cùng đòi mở thì mỗi lúc chỉ một hộp trên màn và không cái nào bị mất. | | | |
| 3.8 | Phát hiện ngoại tuyến (không dùng NetInfo): Wi-Fi có captive portal (HTTP 200 kèm trang HTML) và mạng nuốt gói. | Captive portal: bản ghi vẫn được xếp hàng (không bị bỏ), hàng báo số đang chờ mà không khẳng định máy ngoại tuyến. Mạng nuốt gói: yêu cầu kết thúc sau 10 giây và bản ghi được xếp hàng. | | | |
| 3.9 | Khởi động nguội không mạng: dùng app, force-stop, bật chế độ máy bay, mở. | Hôm nay hiện số lần cuối ngay, với "Bạn đang ngoại tuyến" phía trên; ghi nước được. Sau 03:00 giờ địa phương cùng thao tác hiện "Chưa tải được dữ liệu" với "Thử lại" (không có số cũ). Đồng hồ máy chỉnh sớm một ngày thì ngày đã giữ được coi là đã qua. | | | |
| 3.10 | Đổi ngày lúc 03:00: ghi đủ nước 8 / 8 buổi tối, để app ở nền qua đêm, mở sau 03:00 có mạng. | Trong chốc lát ô nước về 0 / 8 và "Ghi nhận nước" chạy được (không cần force-stop). | | | |
| 3.11 | Như 3.10 nhưng ở chế độ máy bay. | Dòng "Ngày mới chưa được đồng bộ. Các con số sẽ cập nhật khi có mạng trở lại." hiện, ô nước 0 / 8; một chạm cho ô đồng hồ và "Đang chờ gửi" LUÔN còn đó; cấp độ và xu là của đêm qua; không có chip ngọn lửa. Có mạng và "Thử lại" ở hàng phía trên: dòng biến mất, phần ghi thành dấu tích, chip chuỗi trở lại với số của server. | | | |
| 3.12 | Ngày tạm: ở chế độ máy bay vào buổi sáng, rồi bật mạng và mở một màn khác có tải dữ liệu. | Quay lại Hôm nay, dòng "Ngày mới chưa được đồng bộ…" đã mất và số là của server, không cần chạm gì ở đó. | | | |
| 3.13 | Đồng hồ máy chạy sớm 2 đến 3 phút quanh 03:00. | App không kẹt ở khung xương: ngày mới hiện trong vòng một phút sau lúc khép thật; phần ghi trong mấy phút đó không mất khỏi ô nước; không chớp "Chưa tải được dữ liệu" trước ngày mới sau một đợt ngoại tuyến. | | | |
| 3.14 | Một lần từ chối ở S09 (S58): ví dụ ghi nước khi server từ chối. | Ô rỗng lại và hiện "Chưa lưu được phần nước vừa ghi. <lý do>" cùng "Thử lại" (hàng 48 dp) cạnh ô nước; mỗi trường hợp chỉ một "Thử lại" trên màn; TalkBack đọc dòng lỗi khi nó hiện. | | | |
| 3.15 | Chạm hai lần khi ngoại tuyến (S58), rồi có mạng và "Thử lại" ở đó. | Hai ô đồng hồ, "Đang chờ gửi", hàng phía trên nói "2 ghi nhận đang chờ gửi — đã lưu trên máy"; sau đó cả hai thành dấu tích, XP và xu cập nhật, không có snackbar "Đã ghi nhận" và không có cú nhảy của Mầm. | | | |
| 3.16 | Ghi nước (S09): một chạm, hai chạm nhanh, chạm khi đã đủ 8 / 8, hoàn tác. | Một chạm: ô đầy ngay ("4 / 8 phần · đang lưu"), rồi snackbar "Đã ghi nhận · +10 XP" với "Hoàn tác", số đếm "· đã lưu" trong 5 giây, XP / xu / "Sức sống" đổi theo số của server; hai chạm nhanh cho hai ô và hai tick trên server (không một, không ba); ô không chớp rỗng giữa chạm và xác nhận. Ở 8 / 8 cả hai điều khiển xám và TalkBack đọc "Ghi nhận nước. Đã ghi đủ 8 phần hôm nay." | | | |
| 3.17 | Hoàn tác trong snackbar (S57). | Snackbar nằm trên thanh tab và không che "Xem tất cả nhiệm vụ" ở cuối cuộn; thanh co lại trong 5 giây (chữ "Còn N giây" khi giảm chuyển động), 9 giây khi có trình đọc màn hình; "Hoàn tác" cho "Đã hoàn tác", ô rỗng, XP và xu về số của server; ở chế độ máy bay "Hoàn tác" cho "Không hoàn tác được nữa, ghi nhận vẫn được giữ" với "Thử lại" chỉ trong 5 giây; sau cửa sổ đó server trả `409 UNDO_WINDOW_EXPIRED` cho cùng câu nhưng không có nút. | | | |

## 4. Điều hướng và nút Back

Kịch bản: `fresh`.

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 4.1 | Back cứng (và cử chỉ Back) trên từng tab: chi tiết về gốc tab; gốc của tab khác về tab đầu hoặc thoát; màn đăng nhập về màn trước; Chào mừng thoát. Thử cả điều hướng cử chỉ và ba nút. | Back không bao giờ để màn trống, không vượt qua cổng phiên (sau đăng xuất không tới được màn đã đăng nhập) và về đúng tab nơi chi tiết đã được mở. | | | |
| 4.2 | Chuyển tab và quay lại: mở danh mục bài tập từ "Lộ trình", sang "Hôm nay", rồi về. | Tab giữ vị trí cuộn và chi tiết đã mở (danh mục, buổi tập), các chip như đã chọn. | | | |
| 4.3 | Onboarding: Back ở S06, S07, S08, S61. Rồi rời app và quay lại trong cùng tiến trình. | Mỗi Back lùi một bước, mọi giá trị còn; ở S61 Back về biểu mẫu thay vì thoát; ở S05 Back thoát app như màn đầu. Giá trị gõ còn sau khi quay lại nhưng mất khi tiến trình bị giết (chỉ ở bộ nhớ). | | | |
| 4.4 | Back trong một buổi tập đang chạy. | Mở hộp thoại "Thoát buổi tập?" thay vì đóng modal toàn màn; với hộp mở, Back đóng hộp và buổi tập tiếp tục; khi đang gửi bản ghi Back không làm gì; ở màn chờ / chưa lưu và màn kết quả Back về buổi tập. Thử cả cử chỉ và ba nút; hoạt ảnh Back dự đoán không lộ màn bên dưới rồi nhảy lại. | | | |
| 4.5 | Modal toàn màn của luồng tập (S19 / S20) và thanh tab. | Modal che thanh tab và không với tới thanh tab. | | | |
| 4.6 | Từ kết quả buổi tập (S20) về một tab. | Modal đóng bằng hoạt ảnh gốc, gốc của tab được chọn nằm bên dưới (không chớp chi tiết đã mở), thanh tab hiện lại và viên thuốc nằm sau đúng mục. | | | |
| 4.7 | Lớp chúc mừng (S65 / S66) trên điều hướng thật: "Xem tiện ích", "Xem huy hiệu", X và Back. | Không chớp màn cũ; thanh tab không vẽ lên lớp phủ; "Xem tiện ích" mở "Cấp độ & tiện ích" trên tab đang hiện (Back quay về đó); Back khi lớp phủ lên chỉ đóng lớp phủ; S66 không để tab trống sau "Xem huy hiệu". | | | |
| 4.8 | Lên cấp khi hoàn tất một buổi tập. | Màn kết quả hiện số thưởng mà không có lớp phủ; rời kết quả (Back hoặc "Về …") mở "Cấp N · …" đúng một lần, trên tab đang hiện. | | | |
| 4.9 | Cấp đã chúc mừng (`celebrated:v1:<userId>`): lên cấp, giết app, mở lại; đăng xuất rồi đăng nhập lại; cài lại. | Không có S65 lần hai; đăng xuất và nhập lại ở cấp đã chúc mừng không có S65; cài lại không phát lại cấp cũ. | | | |
| 4.10 | Cột mốc khi ngoại tuyến (S66). | S66 hiện từ ngày đã giữ khi khởi động nguội, `POST /inbox/read` chưa gửi được và mục còn chưa đọc ở server; hiện một lần mỗi lần chạy, hiện lại sau lần khởi động tiếp theo khi có mạng, và lần khởi động đó gửi đã đọc (sau đó không nữa). | | | |
| 4.11 | "Tìm nhóm khác" (S76) mở S54 với tham số `focus: 'leave'`. | ScrollView cuộn tới thẻ "Rời tổ đội" khi tới nơi, không cuộn lần nữa khi bố cục đổi (chuyển quyền, dòng từ chối); "Mời bạn & quản lý nhóm" vẫn mở ở đầu trang; bàn phím đóng. | | | |
| 4.13 | Hàng thành viên (S27) và bảng xếp hạng (S28): giữ ngón tay trên một hàng trong lúc làm mới (kéo, quay lại app, đổi tuần qua lại, lý do nhắc đổi). | Hàng không nhảy hay đổi chỗ dưới ngón tay; vị trí cuộn được giữ sau khi làm mới; chân trang bảng xếp hạng là giờ địa phương của máy, kể cả sau khi múi giờ máy đổi. | | | |
| 4.14 | S26: dán mã mời " NHJPM2K9" (có dấu cách đầu, như copy từ nội dung chia sẻ). | Ô hiện NHJPM2K9 và tham gia nhóm được. | | | |

## 5. Bàn phím và vùng an toàn

Kịch bản: `fresh`.

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 5.1 | Mở bàn phím trên S03, S05, S16, S32, S37, S52 (và S55), chạm ô cuối và gõ, ở máy nhỏ, cỡ chữ 1.3 và 360 dp. | Ô đang gõ và dòng lỗi hoặc gợi ý của nó nằm trên bàn phím; nút chính với tới được bằng cuộn; không gì bị che. Android dựa vào `adjustResize`. | | | |
| 5.2 | Mọi màn: thanh trạng thái, thanh cử chỉ và thanh tab. | Không gì nằm dưới thanh trạng thái hoặc thanh cử chỉ; thanh tab dưới có đệm an toàn, nhãn không bị cắt (điều hướng ba nút và cử chỉ); thanh tab ẩn trên màn chi tiết. Snackbar nằm ngay trên thanh tab ở gốc tab và ngay trên vùng an toàn ở màn chi tiết hoặc luồng tập. Ở cỡ chữ 1.3 trở lên bốn nhãn tab vẫn một dòng; TalkBack đọc mỗi mục "<nhãn>, tab, đã chọn / chưa chọn". | | | |
| 5.3 | Bàn phím email (S02, S03, S04, S55); tên hiển thị (S03). | Bàn phím có phím "@", không viết hoa hay tự sửa trên địa chỉ; phím trả về ghi "tiếp / đi / gửi" đúng như đặt và làm đúng; phím "đi" ở ô cuối gửi một lần. | | | |
| 5.4 | Tự điền và trình quản lý mật khẩu (S02, S03, S55). | Hệ thống hoặc trình quản lý đề xuất thông tin đã lưu ở S02, đề xuất tạo và lưu mật khẩu ở S03 và S55 (mật khẩu hiện ra không bị viết hoa hay sửa); không điền nhầm ô. | | | |
| 5.5 | Ô mã S55. | Bàn phím chỉ số; không còn chữ số thứ chín; dán "1234 5678" (hoặc từ mail có khoảng trắng hay gạch ngang) ra 12345678. | | | |
| 5.6 | Sau xác thực hỏng hoặc server báo lỗi. | Tiêu điểm tới ô lỗi đầu tiên theo thứ tự biểu mẫu, bàn phím giữ hoặc lên ở ô đó, con trỏ nằm trong ô; TalkBack đọc "<nhãn>, lỗi: <thông báo>" đúng một lần; ở S03 hộp điều khoản chưa chọn được thông báo nhưng tiêu điểm không nhảy tới hộp. | | | |
| 5.7 | S03 và S55 (biểu mẫu dài nhất) khi bàn phím mở. | Ô đang gõ và nút chính cùng với tới được bằng cuộn; không gì bị che ở cỡ chữ 1.3 và 360 dp; lỗi dưới ô mật khẩu vẫn nhìn thấy khi nó hiện. | | | |
| 5.8 | S05: nhập số. | Chiều cao và cân nặng dùng bàn phím thập phân, năm sinh bàn phím số tối đa 4 ký tự; trên bàn phím tiếng Việt phím thập phân (dấu phẩy) gõ được vào ô; "170,5" và "170.5" đều qua; ô giữ nguyên điều đã gõ; không có phím trừ hay cách. | | | |
| 5.9 | S60: "Tiếp tục" khi giá trị sai. | Ô sai đầu tiên (theo thứ tự năm sinh, chiều cao, cân nặng) được lấy tiêu điểm, cuộn đưa nó lên trên bàn phím, con trỏ nằm trong, TalkBack đọc nhãn kèm lỗi một lần; gõ ở một ô không đẩy tiêu điểm sang ô sai kế tiếp. | | | |
| 5.10 | Chọn múi giờ (S05): `SelectField` có tìm kiếm trong BottomSheet, mở khi bàn phím có thể đang mở. | Bàn phím đóng hoặc sheet nằm trên nó; ô tìm với tới được; "ho chi minh" tìm ra `Asia/Ho_Chi_Minh`; danh sách (khoảng 419 múi giờ) cuộn mượt; Back cứng đóng sheet chứ không thoát app; chạm một tùy chọn khi bàn phím mở chọn ngay lần chạm đầu; sheet cao không quá 85 % màn hình; không cảnh báo VirtualizedList lồng nhau. Khi danh sách chưa tải, ô hiện `Asia/Ho_Chi_Minh` và "Thử lại" tải. | | | |
| 5.11 | Múi giờ mặc định theo máy. | Máy đặt Việt Nam hiện `Asia/Ho_Chi_Minh` (Hermes có thể báo `Asia/Saigon`: dự phòng cùng múi giờ); máy đặt múi giờ khác có trong danh sách thì hiện múi giờ đó sau khi danh sách tải xong. | | | |
| 5.12 | S16 (ghi calo thủ công). | Bàn phím số chỉ có chữ số (không dấu thập phân hay trừ), tối đa 5 ký tự; "Tên món" bàn phím thường; bàn phím không che "Ghi món đã ăn"; dán "1e3" hoặc "4,5" bị từ chối với lỗi ở ô; tiêu điểm tới ô sai đầu và TalkBack đọc lỗi; sau khi lưu snackbar với tổng của server hiện 4 giây và không có nút. | | | |
| 5.13 | S32 (viết nhật ký): gõ nhiều đoạn, dán văn bản rất dài (trên 5000 ký tự), xoay máy, đưa app xuống nền rồi quay lại, ở máy nhỏ và cỡ chữ 2.0. | Ô giữ chữ (chỉ ở bộ nhớ, giết tiến trình thì mất, theo thiết kế); bộ đếm thành dòng lỗi quá 5000 và "Lưu điều mình vừa viết" bị vô hiệu; bàn phím không che nút lưu hay lỗi; không cắt gì ở 360 dp. | | | |
| 5.14 | S37 (sửa hồ sơ): biểu mẫu khi bàn phím mở, cỡ chữ 2.0 (tên, năm sinh, chiều cao có dấu phẩy, cân nặng), bộ chọn múi giờ (419 mục, tìm kiếm), sheet đổi hướng, hộp "Chưa đến lúc đổi hướng" dưới Back, lưu tên và cân nặng cùng lúc. | Không gì bị cắt hoặc ẩn sau bàn phím; Back đóng hộp hay sheet trước màn; "Lưu hồ sơ" hiện trạng thái bận một lần; màn mục tiêu tiếp theo và "Xong" về Cài đặt. | | | |
| 5.15 | S52 (xóa tài khoản) khi bàn phím mở ở máy nhỏ, cỡ chữ 2.0: "Xóa tài khoản?", gõ mật khẩu, xóa; thử lại sau khi bật chế độ máy bay ngay sau chạm (nếu bắt được thời điểm); sai mật khẩu năm lần rồi đúng lần sáu. | Không gì ẩn sau bàn phím và hai nút cùng kích cỡ, nút an toàn trước; 204 kết thúc ở Chào mừng với "Tài khoản đã được đóng." và khởi động lại app thì chưa đăng nhập, không hồ sơ đệm; câu trả lời bị mất nói rõ không ai biết và thử lại kết thúc ở Chào mừng, không phải "Phiên đăng nhập đã hết hạn"; lần thứ sáu nói "chưa đúng, hoặc … quá nhiều lần" và tài khoản vẫn còn; TalkBack đọc năm hậu quả như danh sách và nút xóa bị vô hiệu kèm dòng giải thích. | | | |
| 5.16 | Hiển thị bố cục của `Screen` và `Touchable`: vùng an toàn, vị trí mũi tên Back, tránh bàn phím, nhấn thu nhỏ 0,98. | Không gì bị cắt, Back với tới được; nhấn thu nhỏ mượt trên bộ điều khiển native; vùng chạm 48 dp. | | | |

## 6. Trợ năng

Kịch bản: `fresh`; bật TalkBack. Mục bố cục (6.22 đến 6.26) làm với cỡ chữ 2.0 và 360 dp.

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 6.1 | Thứ tự đọc và tiêu điểm: đi S01, S05 đến S08, Hôm nay (S09), một chi tiết (S10, S13, S18), Back; mở rồi đóng từng loại lớp phủ (hộp thoại S63 và S81, BottomSheet S43 và S53, chúc mừng S65, snackbar S57). | Mỗi màn đọc tiêu đề trước, nội dung từ trên xuống, nút chính cuối; sau điều hướng tiêu điểm tới tiêu đề của màn mới; sau khi lớp phủ đóng tiêu điểm quay về điều khiển đã mở nó (hoặc tiêu đề màn), không bao giờ về đầu một màn bị ẩn. | | | |
| 6.2 | Hôm nay, bảng nhiệm vụ, buổi tập, hộp xác nhận ở cửa hàng và nhật ký bằng TalkBack. | Mọi điều khiển đọc được theo thứ tự hợp lý. | | | |
| 6.3 | Hộp thoại và BottomSheet: TalkBack khi mở. | Tiêu đề được đọc đầu tiên; không với tới gì phía sau; Back đóng; nền mờ không có "Đóng" thứ hai không nhãn lấy tiêu điểm; các nút nền (backdrop) không đọc được. | | | |
| 6.4 | `TextField` và `SelectField`. | TalkBack đọc nhãn một lần (không hai); đọc "lỗi" cùng thông báo khi ô lấy tiêu điểm; lỗi mới hiện được đọc mà không dời tiêu điểm (`InlineError` bắt đầu ở độ mờ 0,01 để Android không bỏ sự kiện vùng cập nhật); combobox đọc là danh sách thả xuống. | | | |
| 6.5 | Snackbar có "Hoàn tác" khi TalkBack bật (RỦI RO LỖI). | TalkBack đọc "<thông báo>. Nút Hoàn tác." một lần, tiêu điểm đã nằm ở "Hoàn tác" (chạm đôi hoàn tác), snackbar còn đó khoảng 9 giây sau; không bị thanh tab hay vùng cử chỉ che. Nếu tiêu điểm không tới hoặc lời đọc bị cắt bởi việc dời tiêu điểm thì Hoàn tác không với tới được với người dùng trình đọc màn hình: đó là lỗi. | | | |
| 6.6 | `Switch`, `Checkbox`, `SegmentedControl`, `FilterChip`. | Mỗi cái đọc kèm trạng thái chọn và "Đang bật / Đang tắt"; mục tiêu tối thiểu 48 dp; hoạt ảnh của `Switch` (chạy trên bộ điều khiển JS) không giật. | | | |
| 6.7 | Trạng thái tải. | Vùng chứa đọc "Đang tải" như bận. | | | |
| 6.8 | Thanh tiến độ (`StatBar`, `ProgressBar`, `ProgressRing`), chip và huy hiệu cột mốc. | Đọc nhãn và giá trị (ví dụ "Sức sống, 26 phần trăm") mà không đọc số hai lần. | | | |
| 6.9 | Mầm (`Mam`). | Đọc "<giai đoạn>. <tâm trạng>" một lần và bỏ qua Mầm trang trí (`decorative`). | | | |
| 6.10 | Lớp chúc mừng (`OverlayCelebration`). | Tiêu đề đọc một lần và có tiêu điểm; không với tới gì phía sau; Back và X đóng; hai nút phản ứng trong lúc hoạt ảnh; thẻ cuộn được ở cỡ chữ 2.0; vùng thanh trạng thái được phủ. | | | |
| 6.11 | Hàng tuần S21: bảy ô. | Mỗi ô là MỘT phần tử đọc "Thứ Tư, 14/10: chưa hoàn thành việc chính" (ngày đóng băng "Thứ Ba, 13/10: Ngày dùng vé", hôm nay "hôm nay, ngày còn mở", ngày sau "chưa tới"); không ô nào là nút; TalkBack đi T2 đến CN mỗi lần vuốt một ô, đọc câu một lần (không đọc chữ thứ và ký hiệu riêng), không bao giờ nói "nút"; ngày đóng băng phân biệt bằng lời chứ không bằng màu xanh lơ. | | | |
| 6.12 | Bảng nhiệm vụ S10 và Kết thúc ngày S45. | S10: mỗi hàng đọc như một phần tử cùng trạng thái; nhiệm vụ ẩn bị khóa là phần tử thường "Nhiệm vụ ẩn. Mở vào buổi tối". S45: đọc "Ghi nhận kết thúc ngày. Mở từ 18:00" như nút bị vô hiệu; sau khi đánh dấu "Chúc bạn nghỉ ngon" được báo một lần (vùng cập nhật). | | | |
| 6.13 | Buổi tập (S19). | Vòng đếm là một thanh tiến độ "Thời gian còn lại mm:ss" với phần trăm làm giá trị (không có vùng cập nhật trên đồng hồ); khối tiêu đề là vùng cập nhật lịch sự ("Đang tập" và "Đang tạm dừng"); công tắc âm thanh bị vô hiệu, tên "Âm thanh. Bản này chưa có âm thanh, Đang tắt"; chùm S20 và Mầm ẩn khỏi trợ năng. TalkBack không đọc giờ mỗi giây; chạm vào vòng đọc giờ hiện tại; tạm dừng báo "Đang tạm dừng"; hộp thoại có tiêu điểm ở tiêu đề và "Tập tiếp" rồi "Kết thúc và lưu" với tới được theo thứ tự; công tắc âm thanh đọc là bị vô hiệu cùng lý do và không làm gì khi kích hoạt. | | | |
| 6.14 | Tổ đội S27 / S54. | TalkBack đọc từng hàng thành viên một lần (tên, cấp và số ngày, trạng thái), chỉ hàng có thể nhắc mới là nút; hộp xác nhận chuyển quyền và rời nhóm dưới Back. | | | |
| 6.15 | S29 (sheet nhắc). | Sheet mở như modal trên tab tổ đội (iOS dạng sheet, Android toàn màn); Back đóng sheet trước mọi thứ khác; danh sách chọn đọc như một nhóm cùng từng dòng và trạng thái, đọc "đã chọn" ở dòng đã chọn; "Đã gửi lời nhắc" được báo một lần; máy bay giấy của `nudge-sent` bay đi sau khi gửi và vắng khi giảm chuyển động. | | | |
| 6.16 | S74 (bị từ chối) và S30 (hộp thư). | Sau khi gửi bị từ chối (ví dụ Minh đã tắt nhắc) TalkBack báo lý do một lần, lịch sự, không dời tiêu điểm. Hộp thư: cuộn tới cuối một danh sách dài hơn một trang tải trang tiếp đúng một lần (cả khi TalkBack cuộn), hàng chưa đọc đọc "chưa đọc", danh sách giữ chỗ sau khi mở một mục rồi quay lại; không hàng trùng, một yêu cầu mỗi trang, không nhảy lên đầu sau khi làm mới đã-đọc. | | | |
| 6.17 | S32, S33, S77, S34 (nhật ký, vé). | Trang đã lưu đọc theo thứ tự câu trích, "Đã lưu", thẻ vé ("+1 vé giữ nhịp của tuần", "Đang có N / M vé", "Xem vé"), khối hỗ trợ sau khi khớp khủng hoảng, rồi "Về Hôm nay". Hàng biểu tượng vé đọc một lần "Bạn đang có N vé · tối đa M" (biểu tượng im lặng); ô chọn "Ngày sử dụng" nói ngày đã chọn; nút "Xem trước việc dùng vé" bị vô hiệu đọc kèm lý do bên cạnh; "còn dưới 1 giờ" hiện ở giờ cuối quanh 15:00; không gì cho chọn hôm qua sau 15:00. Hiệu ứng mờ của `journal-saved` và `ticket-granted` không giấu gì khỏi TalkBack và vắng khi giảm chuyển động; viền gạch 2 px vẽ đúng trên Android với góc bo. | | | |
| 6.18 | S56 (nguồn hỗ trợ). | TalkBack đọc mỗi hàng như một nút với nhãn đầy đủ. | | | |
| 6.19 | Điều khiển bị vô hiệu: S35 "Âm thanh. Bản này chưa có âm thanh" và S36 "Khoảng giờ nhắc thói quen" khi "Nhắc thói quen" tắt. | Công tắc đọc cùng lý do và bị vô hiệu; ô chọn đọc bị vô hiệu và gợi ý ("Bật "Nhắc thói quen" để chọn khoảng giờ.") đọc sau nó; bật nhắc thì ô chọn đọc được ngay. | | | |
| 6.20 | S61 và S43 (onboarding). | S61 là một trạng thái của bước hồ sơ, S43 là BottomSheet có tiêu đề nhận tiêu điểm khi hiện: cả hai đọc nhẹ nhàng từ tiêu đề trở xuống; hai nút hướng và "Kiểm tra lại hồ sơ" với tới được; không có gì báo con số hay lời nào về cơ thể. | | | |
| 6.21 | Tiêu đề từng bước onboarding. | TalkBack đọc "Bắt đầu từ bạn" / "Nhịp sống của bạn" / "Bạn muốn điều gì?" / "Lộ trình dành cho bạn" khi tới, cả đi tới và lùi; không chớp màn trống giữa các bước. Nội dung mờ và trượt 8 dp trong 320 ms, không hề khi giảm chuyển động (tùy chọn của app hoặc của hệ thống). "Đến Hôm nay" (S08) gửi `POST /onboarding` đúng một lần (nút hiện trạng thái bận), thành công thì cổng gốc thay onboarding bằng các tab mà không chớp S08 trống; sau "không có kết nối" thì "Thử lại" gửi cùng `Idempotency-Key`. | | | |
| 6.22 | Bố cục S09 và S47 (cỡ chữ 2.0, 360 dp). | Hàng tiêu đề có chuông 48 dp, dải cấp cạnh chip xu, thẻ (chữ cạnh Mầm 88 dp, dòng tâm trạng chạy hết chiều rộng để một bản ghi không đổi chiều cao thẻ), tám ô trong một hàng, hàng nhiệm vụ có chip thưởng và mũi tên; chip thưởng không bóp tiêu đề nhiệm vụ còn một chữ mỗi dòng; "xem hành trình" cạnh chip chuỗi (hàng 48 dp chồng hàng chip 8 dp trên và dưới) không cướp chạm của các hàng xung quanh; bốn khối và hai câu kết của S47 cuộn, Back về Hôm nay; không gì bị cắt hay chồng. | | | |
| 6.23 | Bố cục S17, S19, S20 và hộp thoại thoát. | Chip S17 xuống dòng; thẻ chính S19 lớn theo chữ; vòng cố định 160 dp với giờ 28 sp ("08:42" ở 2.0 vẫn vừa trong vòng); hộp thoại cuộn; "Tạm dừng" với tới được không cần cuộn trên màn cao 640 dp ở cỡ chữ 1.0; không gì bị cắt. | | | |
| 6.24 | Bố cục S21, S46, S51. | Bảy ô tuần (mỗi ô tối thiểu 40 dp) vừa một hàng ở 360 dp cỡ chữ 1.0 và xuống dòng sạch ở 2.0 (không chồng chú giải); ba huy hiệu mốc, hàng tiêu đề S46 lớn theo chữ; mũi tên trước / sau của S51 vẫn 48 dp. | | | |
| 6.25 | Bố cục S13, S14, S15 (thực đơn). | Hàng ô bữa (ảnh 64 dp, hai đến ba dòng, dấu tích, mũi tên), chip macro S14 và hàng S15 có tới bốn từ thẻ xuống dòng thay vì bị cắt; nút chính với tới được bằng cuộn. | | | |
| 6.26 | Bố cục các màn còn lại: gốc tab, S10, S18, S28, S35, S37, S44, S52, mọi sheet; S27 / S54 (hàng thành viên, ô mã mời, nút chuyển và rời); S53 (năm sheet dài nhất "Cách giữ nhịp mỗi ngày" và "Chính sách riêng tư"); `SegmentedControl` ("Theo hệ thống / Giảm / Đầy đủ") ở 1.3 và 360 dp; `SelectField`. | Không chữ nào bị cắt hay chồng; nút cao lên (không bao giờ cắt chữ); nội dung cuộn tới dòng cuối; nhãn tab vẫn đọc được (chỉ bị giới hạn ở 1.3 ở đó); mỗi sheet cuộn tới dòng cuối và Back đóng; ba phân đoạn nằm trong điều khiển, dấu chọn vẫn thấy. | | | |
| 6.27 | Vùng chạm 48 dp: chạm bằng đầu ngón tay gần mép mũi tên Back, X của sheet, liên kết chữ ("Quên mật khẩu?", "Đăng xuất" ở S05), chip, mắt ẩn / hiện mật khẩu, Hoàn tác ở hàng nhiệm vụ. | Mỗi cái phản ứng trong vùng 48 x 48 dp và không bao giờ kích hoạt hàng xóm; chạm trong dải mở rộng (`hitSlop`) vẫn tới đúng điều khiển chứ không tới cha. Ở S03 hàng hộp kiểm và hàng liên kết là hai hàng 48 dp riêng: chạm chữ liên kết mở sheet điều khoản và không bao giờ đổi hộp, chạm nhãn đổi hộp và không bao giờ mở sheet; ở cỡ chữ 2.0 hai hàng không chồng. | | | |
| 6.28 | Tương phản trên tấm nền thật: ngoài nắng và ở độ sáng thấp, chữ nhạt trên nền mềm, nút bị vô hiệu (độ mờ 50 %, dòng lý do bên cạnh), viền ô nhập (`fieldLine` #7F8CA1: 3,40:1 trên trắng, 3,17 đến 3,23:1 trên ba nền chủ đề), ba chủ đề (mặc định, forest, sky). | Mọi chữ đọc được; ô nhập rỗng nhìn rõ là ô; trạng thái bị vô hiệu hiểu được từ dòng lý do chứ không chỉ từ màu nhạt. | | | |
| 6.29 | Sheet điều khoản S03 (BottomSheet mở từ liên kết dưới hộp kiểm, chỉ gắn khi mở). | Sheet trượt lên trên biểu mẫu; tiêu điểm TalkBack vào tiêu đề; Back cứng đóng; biểu mẫu (giá trị đã gõ, hộp kiểm) như trước; chữ cuộn ở cỡ chữ 2.0. | | | |
| 6.30 | Thông báo thành công S55. | "Mật khẩu đã được đổi. Bạn đăng nhập lại nhé." hiện trên S02 đủ 4 giây và TalkBack đọc một lần; Back từ S02 về Chào mừng (chỉ có một S02 trong ngăn xếp). | | | |
| 6.31 | S53: dòng "Phiên bản ứng dụng: …". | Bằng `version` trong `package.json` và `versionName` trong `android/app/build.gradle` (0.1.0): so với Thông tin ứng dụng của Android. | | | |

## 7. Chuyển động

Kịch bản: `streak6`.

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 7.1 | Bật "Xóa hoạt ảnh" của hệ thống rồi mở Hôm nay (ngọn lửa, Mầm, số lăn), demo bài tập S82, vòng thở S19. | Không có chuyển động; mọi thông tin vẫn có (tư thế chính, vòng đứng yên với chữ giai đoạn vẫn đổi; ô nước chỉ đổi, "+10 XP" chỉ nằm trong snackbar, Mầm hiện mặt vui và "Mầm vui vì bạn vừa ghi nhận" 5 giây). Khung xương tải tĩnh. | | | |
| 7.2 | Bật / tắt "Xóa hoạt ảnh" từ cài đặt nhanh hoặc trang trợ năng khi app đang mở, rồi đổi lựa chọn riêng của app ở S79 (Đầy đủ / Giảm). | Bật: Mầm, ngọn lửa, khung xương và khung cử động dừng trong vòng một giây và hiện tư thế tĩnh (tư thế chính của bài; vòng đứng yên với chữ giai đoạn vẫn đổi); tắt: chạy lại mà không rời màn; không lớp phủ thưởng nào phát lại (lên cấp, chuỗi, tiến hóa, chùm kết quả buổi tập); lựa chọn ở S79 thắng công tắc hệ thống cả hai chiều. | | | |
| 7.3 | Khởi động nguội với "Giảm" ở S79 (cả khi không mạng); rồi "Đầy đủ" với "Xóa hoạt ảnh" của hệ thống bật; rồi "Theo hệ thống" khi công tắc hệ thống bật và tắt. | "Giảm": các khung đầu (S39 tải, Hôm nay: ngọn lửa, Mầm, số lăn) không chuyển động, trước khi `GET /settings` trả lời; "Đầy đủ": Mầm và ngọn lửa cử động cả khi hệ thống đòi ít hơn; "Theo hệ thống" theo hệ thống; đăng xuất rồi vào bằng người khác không thừa kế lựa chọn đã giữ. | | | |
| 7.4 | Công tắc S36 và S79: chạm "Nhận lời nhắc từ tổ đội", "Nhắc thói quen" và "Ẩn số ngày chuỗi" nhiều lần liên tiếp, cả khi tắt mạng. | Núm trượt (150 ms) không giật trong khi PATCH đang gửi; mỗi thay đổi bị từ chối trượt ngược lại và snackbar "Chưa lưu được thay đổi này…" hiện; với "Xóa hoạt ảnh" (hoặc "Giảm") núm nhảy không trượt. | | | |
| 7.5 | Vòng lặp dừng khi không còn thấy: bật Mầm, ngọn lửa, khung xương S82, vòng thở S19. Khóa màn hình chờ 30 giây rồi mở; bấm Home chờ rồi quay lại; mở một màn thứ hai phủ lên Hôm nay (Hành trình, Hộp thư) và xem số khung `adb shell dumpsys gfxinfo com.hoi_mau` hoặc thống kê pin trong lúc bị che. | Khi khóa, ở nền hoặc dưới màn che: bộ đếm khung ngừng tăng (không vòng nào còn vẽ); quay lại thì hình và ngọn lửa chạy lại và nhãn vòng thở bắt đầu lại ở "Hít vào"; kết quả buổi tập hay lớp phủ đã hiện trước đó không phát lại. Vòng lặp chạy từ khung đầu tiên trên màn thường (`AppState.currentState` đã là `active` khi màn đầu gắn vào, không phải `null` hay `unknown`) và cũng dừng khi hộp thoại hệ thống che app. | | | |
| 7.6 | Mầm: vòng nghỉ (3000 ms, 4 dp) và mệt (5000 ms), một lần `happy` / `cheer`. | Vòng mượt; dừng khi màn mất tiêu điểm (`active={false}`), khi app ở nền và khi bật "Giảm chuyển động" lúc đang hiện; tiếp tục sau đó; một `happy` / `cheer` đã chạy xong không phát lại khi quay về. | | | |
| 7.7 | Thanh tab: viên thuốc trượt 320 ms; xoay máy. | Một viên thuốc mềm trượt tới mục được chọn trong 320 ms (`translateX` ở bộ điều khiển native, vị trí từ `onLayout`); nhảy ngay khi giảm chuyển động; sau khi xoay máy nằm sau mục được chọn mà không hoạt ảnh. | | | |
| 7.8 | Hoạt ảnh S09: `water-check-in`, `reject-revert`, `xp-float`, `mam-happy`, `pending-pulse`. | Không cái nào giật khi danh sách cuộn; cú nhảy của Mầm không phát lại khi quay về tab hoặc app; ô nước đổ từ đáy (`transformOrigin: 'bottom'`) trên Android: giọt rơi 40 dp, ô đầy từ đáy sau 200 ms; từ chối xả trong 220 ms và thông báo mờ vào; "+10 XP" bay lên 24 dp bên cạnh số và mờ dần, ẩn khỏi trình đọc màn hình; một cú nhảy mỗi bản ghi đã xác nhận (bản ghi thứ hai trong lúc cú nhảy đầu còn chạy được phát lại). | | | |
| 7.9 | Lớp chúc mừng: halo, huy hiệu, huy chương, giai đoạn mới, số cấp (N−1 tới N, 200 ms), phụ đề 450 ms, dải cột mốc 600 ms, 24 hạt có thang và mờ. | Cùng thứ tự; halo không bao giờ chạm tiêu đề; không hình chữ nhật trắng sau huy hiệu cấp; số đếm không chớp; không rớt khung trên máy yếu; Back và giảm chuyển động (thẻ cuối hiện ngay); không đè lên luồng tập. | | | |
| 7.10 | Chip chuỗi, thanh, chip xu: ngọn lửa (`scaleY` và `rotate`, 2000 ms), thanh lấp đầy (`scaleX` từ tỉ lệ cũ, 450 ms), đếm XP và xu (600 ms). | Ngọn lửa lập lòe tại chỗ và dừng ở nền; thanh lớn từ độ dài trước mà không nhảy ở khung đầu; số đếm không giật. | | | |
| 7.11 | Chuyển động đổi bữa (S13 / S15). | Sau khi đổi, màn bữa trượt bữa mới vào (16 dp, trễ 120 ms) khi hiện lại; giảm chuyển động thì hiện ngay; không chớp bữa cũ, không nhảy nút. | | | |
| 7.12 | Chuyển động kết quả buổi tập (S20): `workout-complete`, `mam-cheer`, và S64. | Vòng phồng một lần (1, 1,06, 1) và 16 mảnh lửa và chanh bay ra 90 dp rồi mờ, 300 ms sau khi màn hiện; Mầm cổ vũ một lần; không phát lại khi quay về app hoặc màn; giảm chuyển động thì tĩnh; chùm không bị góc bo của thẻ cắt kỳ lạ (được phép ra ngoài thẻ), không rớt khung ở máy yếu; S64 không có chùm và Mầm ở nhịp nghỉ. | | | |
| 7.13 | Trạng thái tải (shimmer) và mọi đoạn trên khi giảm chuyển động. | Shimmer quét mượt trên bộ điều khiển native, ngừng khi app ở nền, tĩnh khi giảm chuyển động. | | | |

## 8. Chế độ tập trung và nhắc đứng dậy

Kịch bản: `fresh`, chọn bài 15 phút ở S17.

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 8.1 | Chạy một buổi 15 phút cạnh đồng hồ bấm giờ với màn hình bật; thêm một lần tạm dừng giữa chừng ở một lượt chạy khác. | Đếm ngược tới 00:00 trong vòng một giây so với đồng hồ bấm giờ (cả khi có một lần tạm dừng) và buổi tập tự kết thúc với "15:00" được ghi. Thời gian tập đọc từ `Date.now()` mỗi 250 ms, không đếm từ callback bộ hẹn giờ. | | | |
| 8.2 | Cuộn mạnh màn hình, kéo thanh thông báo 20 giây rồi quay lại. Đổi giờ máy bằng tay giữa buổi. | Đồng hồ hiện đúng giờ ngay (không tiếp tục từ chỗ vẽ lần cuối). Đổi giờ máy bằng tay thì đồng hồ dịch đúng bằng đó (dùng đồng hồ treo tường theo quyết định thiết kế): ghi lại điều xảy ra; đó không phải lỗi của bản dựng. | | | |
| 8.3 | Giữ màn hình sáng: đặt thời gian tắt màn hình 30 giây, chạy một buổi 2 phút, rồi một buổi 15 phút; tạm dừng và chờ lại; kết thúc buổi. | Màn hình luôn bật khi buổi đang chạy, ngủ bình thường khi tạm dừng, sau khi kết thúc và sau khi rời S19. `adb shell dumpsys window \| grep KEEP_SCREEN_ON` chỉ có cờ khi buổi đang chạy. | | | |
| 8.4 | Giữ màn hình sáng sau khi xoay hoặc đưa xuống nền. | Xoay máy trong buổi (MainActivity tự xử lý hướng, không dựng lại) rồi đưa app xuống nền và quay lại: màn hình vẫn sáng sau khi xoay và sau khi quay lại; không sập khi lời gọi tới lúc không có activity (app ở nền): đó là no-op. | | | |
| 8.5 | Khóa điện thoại, chuyển app, có cuộc gọi, mở và đóng danh sách gần đây trong buổi. | Mọi thứ tạm dừng buổi lúc đó; trở lại hiện "Đang tạm dừng" (S41) và không bao giờ tự chạy lại. Ví dụ: Home sau 1:00 tập, chờ 2 phút, quay lại: "Đang tạm dừng" còn 14:00, mười giây sau vẫn 14:00, "Tập tiếp" tiếp tục từ 14:00. Với màn khóa bằng nút nguồn, thời gian còn lại sau khi mở khóa phải là lúc khóa, không phải muộn hơn (việc tạm dừng được ghi trước khi app bị treo). Android có thể không báo `inactive` khi mở danh sách gần đây: khi đó không gì tạm dừng và cũng không mất gì. | | | |
| 8.6 | Hộp thoại S63: mở ở 06:18 đã tập, chờ 30 giây, "Tập tiếp". | Đồng hồ tiếp tục từ cùng giây; chữ "Bạn đã tập 06:18 trên 15:00" không đổi khi hộp mở; "Tập tiếp" khôi phục đúng trạng thái trước đó (chạy thành chạy, tạm dừng thành tạm dừng; rời app khi hộp mở thành tạm dừng). | | | |
| 8.7 | Kết thúc buổi dưới 50 %. | Cho kết quả một phần. | | | |
| 8.8 | Giết app giữa buổi; rồi "Kết thúc và lưu" khi không mạng và giết app. | Giết giữa buổi: không gì được ghi, không bản ghi chờ, bắt đầu lại được. Sau khi lưu không mạng rồi giết: lần khởi động sau hàng S38 báo 1 bản ghi đang chờ và tab Lộ trình nói "Có buổi tập đã lưu trên máy, đang chờ gửi"; có mạng lại thì được gửi một lần (một buổi trong lịch sử ngày). | | | |
| 8.9 | Màn hình khi ngoại tuyến sau khi lưu (S20) khi modal toàn màn mở. | Màn nói "Buổi tập đã lưu trên máy, đang chờ gửi", dù snackbar và hàng S38 có bị modal che hay không (trên Android chúng nằm trong cùng cửa sổ). | | | |
| 8.10 | Nhắc đứng dậy (đếm 60 phút chỉ khi `AppState` là `active`; ở nền tới 10 phút vẫn tính, lâu hơn thì đóng băng). | Khi điện thoại khóa hoặc app bị vuốt đi: không hiện gì và không bộ đếm nào chạy (Android treo bộ hẹn giờ JS; đếm ngược được tính lại từ đồng hồ khi quay lại); quay lại sau 5 phút thì lời nhắc tới khi đủ giờ, sau 11 phút trở lên thì thời gian còn lại như cũ; khi tới hạn: snackbar "Đến lúc đứng dậy vươn vai một chút" với "Mình vừa đứng dậy" 15 giây (30 giây khi có trình đọc màn hình), không bao giờ là thông báo của hệ điều hành; TalkBack báo lời nhắc và đặt tiêu điểm lên hành động. Snackbar chỉ có một ô: lời nhắc rơi vào cửa sổ 5 giây của một bản ghi vừa làm sẽ thay nó và làm mất Hoàn tác: ghi lại tần suất gặp trong khi dùng thật. | | | |
| 8.11 | Đếm ngược nhắc qua khởi động lại (khóa `standup:v1:<userId>`). | Vuốt app khỏi danh sách gần đây sau 20 phút ở tiền cảnh, mở lại 2 phút sau: lời nhắc tới khoảng 40 phút sau lần mở lại (không phải 60); đăng xuất rồi đăng nhập bằng người khác thì một giờ mới; khóa biến mất khỏi AsyncStorage sau khi đăng xuất. | | | |
| 8.12 | Lời nhắc và luồng tập: bắt đầu buổi tập ở phút 58 của giờ nhắc. | Không có "Đến lúc đứng dậy vươn vai một chút" trong buổi hay ở màn kết quả; lời nhắc đang hiện bị tắt khi buổi bắt đầu; lời nhắc tiếp theo tới 60 phút ở tiền cảnh sau khi rời màn kết quả. | | | |
| 8.13 | Hàng bảng nhiệm vụ S10: "Uống nước", "Đứng dậy một chút", nhiệm vụ ẩn, "Lần nhắc tới sau M phút". | Mỗi hàng đánh dấu được là một nút 48 dp có nhãn mang số đếm, thưởng mỗi phần và chỉ dẫn; "Lần nhắc tới sau M phút" làm mới mỗi 30 giây khi màn mở; snackbar S11 ("Đã ghi nhận · +10 XP", "Hoàn tác") nằm trên mép dưới màn (chi tiết không có thanh tab) và hành động với tới được; nhiệm vụ ẩn thành "Khép lại hôm nay trước 23:00" chỉ sau khi ngày được đọc lại sau 18:00 (mở lại màn hoặc quay lại app). | | | |
| 8.14 | S45 theo giờ: 17:59, 18:00, 22:59, 23:00 với điện thoại thật và server dev. | Cửa sổ do server quyết định theo giờ treo tường: 18:00 trở đi mở, 18:00 đến 22:59 có thưởng, 23:00 đến 02:59 không thưởng. Màn S45: thẻ đêm màu mực với mặt trăng chanh và Mầm nhắm mắt (tĩnh); nút bị vô hiệu với "Mở từ 18:00" trong nhãn và bên cạnh khi nhiệm vụ ẩn còn khóa. | | | |

## 9. Hàm native và hệ thống

Kịch bản: `rich`.

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 9.1 | Chia sẻ tệp JSON: S44 "Tải dữ liệu của tôi" khi app ở tiền cảnh (Android 10 trở lên). | Bảng chia sẻ hệ thống mở với một tệp đính kèm `.json` tên `hoi-mau-du-lieu-YYYY-MM-DD.json`; lưu vào Tệp hoặc gửi lên Drive cho tệp có nội dung giống hệt bản xuất (UTF-8, dấu tiếng Việt còn nguyên), phân tích được; chia sẻ lần hai chỉ để lại tệp mới nhất trong `cache/exports/` (`adb shell run-as com.hoi_mau ls cache/exports`, bản debug). | | | |
| 9.2 | Tệp xuất là riêng tư. | Tệp nằm trong bộ đệm của app, chỉ truy cập qua `content://com.hoi_mau.fileprovider/exports/<tên>` với quyền đọc một lần; `adb shell ls /data/data/com.hoi_mau/cache/exports` bị từ chối với người dùng shell; provider là `exported=false`; app khác không mở được URI nếu không có quyền; không có quyền mới trong `aapt2 dump permissions`. | | | |
| 9.3 | Chia sẻ khi xoay máy hoặc đưa xuống nền. | Xoay khi bảng chia sẻ mở, đưa app xuống nền khi bảng mở rồi quay lại: bảng ở lại hoặc đóng sạch, app không sập, chia sẻ lại được; nếu chia sẻ native hỏng thì dự phòng JS chia sẻ văn bản (tối đa 100 000 ký tự) hoặc nơi gọi hiện "không chia sẻ được". | | | |
| 9.4 | S44: chia sẻ khi vừa chuyển sang app khác lúc "Đang chuẩn bị bản sao…" còn hiện (chooser được mở từ module khi không có activity: Android chặn việc bắt đầu từ nền một cách im lặng và promise vẫn hoàn tất). | Tiền cảnh: bảng chia sẻ mở, nội dung là toàn bộ bản xuất. Sau khi bắt đầu từ nền: màn hiện "Đã tạo bản sao" cùng dòng nói cách yêu cầu lại, không bao giờ "đã lưu" hay "đã gửi"; hàng bận cho tới khi lời gọi chia sẻ trả về, chạm lần hai lúc đó không làm gì; bấm sáu lần trong một giờ thì lần thứ sáu hiện chữ 429 nhẹ nhàng. | | | |
| 9.5 | Dọn thư mục xuất: xuất dữ liệu một lần (S44, bảng chia sẻ), rồi đăng xuất; xuất lần nữa, rồi xóa tài khoản; mỗi lần xem bộ đệm của app (`adb shell run-as com.hoi_mau ls cache/exports`, bản debug). | Sau khi đăng xuất và sau khi xóa, thư mục không còn hoặc rỗng (module vẫn trả về khi nó không tồn tại); lần xuất sau tạo lại. | | | |
| 9.6 | S56: chạm "Gọi 115 · Cấp cứu" và "Gọi 111 · Tổng đài quốc gia bảo vệ trẻ em" trên điện thoại có SIM và trên máy không có ứng dụng gọi (máy tính bảng). | Ứng dụng gọi hệ thống mở với `tel:115` / `tel:111` đã điền và không gọi cho tới khi người dùng xác nhận; không có ứng dụng gọi thì dòng "Chưa mở được ứng dụng gọi điện…" hiện và màn giữ nguyên. | | | |
| 9.7 | Chia sẻ lời mời nhóm (S27 / S54, `Share.share`). | Bảng chia sẻ mở với lời mời ngắn và mã mời. | | | |
| 9.8 | Ảnh bữa ăn: ba ảnh stock (480 đến 680 KB mỗi ảnh) và đầu kế hoạch (S13). | Tải không trễ nhìn thấy trên máy yếu; `resizeMode="cover"` cắt ảnh bữa 16:9 như bản xem trước; không khung trống dài hơn chốc lát khi cuộn S13; không cảnh báo bộ nhớ. | | | |
| 9.9 | S15: nhóm chọn và sheet loại trừ với TalkBack. | Ba gợi ý đọc là hàng chọn một ("..., nút chọn, đã chọn / chưa chọn") và tám hộp kiểm của sheet đọc là hộp kiểm; tiêu đề sheet nhận tiêu điểm khi mở; mỗi hàng đọc tên, kcal, chênh lệch và thẻ một lần; Back đóng sheet trước màn. | | | |
| 9.10 | Dùng toàn bộ app một lượt rồi xem quyền của APK: `aapt2 dump permissions` trên `app-debug.apk`. | Danh sách quyền khớp dự kiến (internet và các quyền mà thư viện keychain thêm như USE_BIOMETRIC, USE_FINGERPRINT); không có quyền thông báo, máy ảnh hay âm thanh; không quyền mới nào do bảng chia sẻ thêm. | | | |

## 10. Mầm và SVG

Kịch bản: `rich`.

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 10.1 | Cả năm giai đoạn, ba tâm trạng và da cáo (fox) ở 40 dp và 220 dp. | Mỗi giai đoạn x tâm trạng giống ảnh trong `design/assets/mam/renders/*.png`; hoa và quầng của thể thần thoại không bị cắt; mũ cáo nằm trên đầu (cả trên hạt giống). Các phần tử `react-native-svg` dùng biến đổi chuỗi (`translate(..) scale(..)`, `rotate(a cx cy)`) trong khung nhìn 128. | | | |
| 10.2 | Màn thú S22 / S70: Mầm ở cỡ 176 trên màn thật, nhịp nghỉ và mệt. | Dừng khi mất tiêu điểm và khi app ở nền; TalkBack đọc chip giai đoạn, nhãn thanh và đầu tâm trạng theo thứ tự đó. | | | |
| 10.3 | S23 / S24 và S46. | `SegmentedControl`, thẻ vật phẩm hai cột và danh sách `RadioRow` ở cỡ chữ 2.0 và 360 dp (không cắt); TalkBack đọc tên, dòng loại và một hành động của mỗi thẻ. Sheet đặc quyền S46: tiêu điểm vào tiêu đề, Back đóng, hàng chọn chủ đề đọc đã chọn / bị vô hiệu. | | | |
| 10.4 | Demo cử động S82 (squat và "Thở vuông"): xem 3 vòng, bật "Xem chậm", tạm dừng, xoay, đưa xuống nền rồi quay lại. | Hình chuyển động mượt (ma trận mỗi nhóm khớp đặt bằng `setNativeProps({ matrix })` trên `G` của react-native-svg; một lần dựng lại React của hình có thể nhảy về tư thế đầu một khung); không giật trên máy yếu; vòng lặp dừng khi tạm dừng, ở nền và khi màn mất tiêu điểm; chế độ chậm hoạt động. | | | |

## 11. Thời gian

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 11.1 | Đặt đồng hồ máy lệch +10 phút rồi -10 phút (tắt ngày giờ tự động), ghi vài việc quanh 02:50 đến 03:10 giờ địa phương. | Bản ghi vẫn rơi vào đúng ngày logic (server quyết định ngày). | | | |
| 11.2 | Đổi múi giờ của máy. | Múi giờ của hồ sơ không đổi theo; giờ hiện ở S51 là giờ trong múi giờ của hồ sơ. | | | |

## 12. Hiệu năng

Ghi số cùng kiểu máy, phiên bản Android, loại bản dựng (bản phát hành nếu có; bản debug chậm hơn nhiều) và mạng. Số của server ở [backend](backend.md#hiệu-năng-checksperftestts-npm-run-serverperf) không phải số của điện thoại.

| # | Cách đo | Kết quả mong đợi | Số đo | Máy · Android | Ngày · người đo |
|---|---|---|---|---|---|
| 12.1 | Khởi động nguội: giết app, mở từ launcher, thời gian từ chạm tới khung đầu và tới lần dựng Hôm nay đầu có dữ liệu (đồng hồ bấm giờ hoặc `adb shell am start -W`, TotalTime), năm lần. Server trên máy này qua LAN hoặc `adb reverse`. | Báo trung vị và lần tệ nhất trong năm. Số của server (NFR-01: p95 dưới 300 ms) và của điện thoại ghi riêng, không so với nhau. | | | |
| 12.2 | Thời gian tới Hôm nay đầu có dữ liệu: người dùng có 30 ngày lịch sử (kịch bản `fresh` cộng vài ngày, hoặc bộ dữ liệu hiệu năng trong cơ sở dữ liệu dev); một lần trên Wi-Fi, một lần trên đường truyền chậm (tùy chọn nhà phát triển hoặc hotspot). | Hôm nay hiện trạng thái tải ngay (S39), không bao giờ màn trống; ghi số cả hai trường hợp. | | | |
| 12.3 | Độ trễ chạm tới phản hồi: chạm ô nước và đo tới khi ô đầy. | Ô đầy ngay trước khi bản ghi xuống đĩa; ghi số đo. | | | |
| 12.4 | Cuộn mượt: cuộn nhanh Hôm nay (danh sách nhiệm vụ với ngọn lửa và Mầm chuyển động), danh sách tổ đội (hàng thành viên S27, bảng xếp hạng S28 tới 50 hàng) và hộp thư; trên máy yếu và máy tầm trung; `adb shell dumpsys gfxinfo com.hoi_mau framestats` hoặc Perf Monitor. | Không giật nhìn thấy; báo tỉ lệ khung giật từ gfxinfo cho mỗi danh sách; hàng không nhảy khi cuộn. | | | |
| 12.5 | 60 fps trên máy RAM 3 GB trở xuống (bản phát hành): Hôm nay với ngọn lửa và Mầm khi cuộn, S82 và S19 (khung xương và vòng thở) trong một phút đầy đủ, khung tải trên đường chậm, ba lớp phủ (S65, S66, S69) với 24 hạt; đọc gfxinfo trước và sau. | Không giật nhìn thấy; khung giật dưới khoảng 5 % ở vòng lặp rảnh; vũ đạo lớp phủ kết thúc không đứng; `setNativeProps` mỗi khung của khung xương theo kịp (không lệch giữa hình và nhãn giai đoạn). | | | |
| 12.6 | Bộ nhớ sau buổi 45 phút: dùng app 45 phút (tick Hôm nay, một buổi tập có giữ sáng, tab tổ đội và bảng xếp hạng, hộp thư, cửa hàng, quay lại Hôm nay) và đọc `adb shell dumpsys meminfo com.hoi_mau` lúc đầu, ở 15, 30 và 45 phút. | Heap Java và heap native đi ngang, không dốc; TOTAL PSS ở 45 phút trong khoảng một phần ba so với con số ở 15 phút; không OOM, không ANR; ghi bốn con số. | | | |

## 13. Thông báo và âm thanh

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 13.1 | Dùng toàn bộ app một lượt (nhắc đứng dậy, nhắc thói quen, nhắc tổ đội, hết buổi tập), rồi `adb shell dumpsys notification --noredact \| grep com.hoi_mau` và vào Cài đặt > Ứng dụng > Thông báo. | App không bao giờ xin quyền thông báo và không bao giờ hiện thông báo của hệ điều hành; mọi lời nhắc chỉ là snackbar hoặc hàng trong app. | | | |
| 13.2 | Bật âm lượng phương tiện và nghe suốt mọi luồng (ghi nhận, hoàn tất buổi tập, lớp chúc mừng). | Không có âm thanh nào được phát; công tắc "Âm thanh" bị vô hiệu kèm lý do. | | | |

## 14. iOS

| # | Cách kiểm | Kết quả mong đợi | Kết quả | Máy · Android | Ngày · người kiểm |
|---|---|---|---|---|---|
| 14.1 | iOS chưa build (D-01), không có macOS. | Ghi "không thực hiện". Nếu sau này có bản iOS thì kiểm: font theo tên PostScript (iOS tìm font theo tên PostScript nên cùng chuỗi có thể rơi về font hệ thống), `accessibilityLiveRegion` không có tác dụng (lỗi và lời báo đọc bằng `announceForAccessibility`), VoiceOver đọc tiêu đề hộp thoại và sheet, `KeyboardAvoidingView` dạng `padding`, gợi ý mã một lần trên S55 khi mail mở, không vuốt xuống nào đóng buổi tập (`gestureEnabled: false`), hàng S38 và snackbar có thể bị modal che. | Không thực hiện | | |

## Kết quả và lỗi

Điền sau khi chạy xong. Mỗi lỗi một dòng: mục, mô tả, tệp sở hữu, trạng thái.

| Mục | Mô tả lỗi | Tệp sở hữu | Trạng thái |
|---|---|---|---|
| | | | |
